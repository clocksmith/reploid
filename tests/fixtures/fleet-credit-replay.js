// Reverify retained physical signatures, admission fences, settlement and duplicate-settlement rejection in a fresh database. No GPU or network.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openFleetCredits } from '../../server/fleet/credits.js';

function flipSignature(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 8, 'Non-empty signature required');
  return (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
}

function corruptedVariants(mode, evidence) {
  const variants = [];
  if (mode === 'whole-model') {
    if (evidence.schema === 'reploid.generation-terminal/v1') {
      const copy = structuredClone(evidence);
      copy.signature = flipSignature(copy.signature);
      variants.push(copy);
    } else {
      for (const field of ['providerSignature', 'consumerSignature']) {
        const copy = structuredClone(evidence);
        copy[field] = flipSignature(copy[field]);
        variants.push(copy);
      }
    }
  } else {
    const ackCopy = structuredClone(evidence);
    ackCopy.acknowledgment.signature = flipSignature(ackCopy.acknowledgment.signature);
    variants.push(ackCopy);
    for (let index = 0; index < (evidence.receipts?.length || 0); index++) {
      const stageCopy = structuredClone(evidence);
      stageCopy.receipts[index].signature = flipSignature(stageCopy.receipts[index].signature);
      variants.push(stageCopy);
    }
  }
  return variants;
}

const amounts = snapshot => snapshot.accounts.map(({ id, balance, held }) => ({ id, balance, held }));
const assertConserved = rows => {
  assert.equal(rows.reduce((sum, row) => sum + row.balance, 0), 0, 'Credit balances are not zero-sum conserved');
  for (const row of rows) assert.equal(row.held, 0, `Account ${row.id} retained non-zero credit hold`);
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-receipt-replay-'));
try {
  for (const file of process.argv.slice(2)) {
    const report = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(report.cleanup, 'settled');
    let now = 0;
    const ledger = await openFleetCredits({ file: path.join(root, crypto.randomUUID() + '.sqlite'),
      computers: report.computers, policy: report.policy, now: () => now });
    try {
      for (const request of report.requests) {
        assert.equal(request.state, 'settled');
        assert.ok(request.evidence, 'Complete signed evidence required');
        now = request.binding.createdAt;
        const input = Object.fromEntries(['id', 'executionId', 'consumer', 'mode', 'model', 'inputDigest', 'maxOutputTokens', 'providers']
          .map(key => [key, request.binding[key]]));
        if (request.binding.route) input.route = request.binding.route;
        const reserved = ledger.reserve(input);
        assert.equal(reserved.maximum, request.binding.maximum);
        const heldDuringReserve = ledger.snapshot().accounts.find(row => row.id === request.binding.computerId);
        assert.equal(heldDuringReserve.held, request.binding.maximum, 'Reservation did not hold maximum credits');
        assert.throws(() => ledger.admit(input.id, 0), /Credit admission is closed/);
        ledger.dispatch(input.id, input.consumer);
        if (Array.isArray(request.admittedStages)) {
          for (const stage of request.admittedStages) ledger.admit(input.id, stage);
        }
        now = request.outcome.settledAt;
        for (const corrupted of corruptedVariants(input.mode, request.evidence)) {
          await assert.rejects(ledger.settle(input.id, corrupted), 'Corrupted signature was accepted');
        }
        const result = await ledger.settle(input.id, request.evidence);
        assert.deepEqual(result, request.outcome);
        const before = ledger.snapshot();
        assert.deepEqual(await ledger.settle(input.id, request.evidence), result);
        assert.deepEqual(ledger.snapshot(), before, 'Idempotent duplicate settlement changed balances');
        const conflicting = structuredClone(request.evidence);
        if (input.mode === 'whole-model' && conflicting.schema === 'reploid.generation-terminal/v1') {
          conflicting.status = conflicting.status === 'cancelled' ? 'failed' : 'cancelled';
        } else if (input.mode === 'whole-model') {
          conflicting.outputTokens = (conflicting.outputTokens || 0) + 1;
        } else {
          conflicting.acknowledgment.count = (conflicting.acknowledgment.count || 0) + 1;
        }
        await assert.rejects(ledger.settle(input.id, conflicting), 'Conflicting duplicate settlement was accepted');
        assert.throws(() => ledger.admit(input.id, 0), /Credit admission is closed/);
        assert.throws(() => ledger.dispatch(input.id, input.consumer), /Request cannot dispatch/);
        assert.throws(() => ledger.abandonBeforeDispatch(input.id, input.consumer), /Reservation already closed/);
        assert.deepEqual(ledger.snapshot(), before, 'Rejected post-settlement operations changed balances');
      }
      const replayed = amounts(ledger.snapshot());
      const finalBalances = amounts(report.balances);
      assertConserved(replayed);
      assertConserved(finalBalances);
      if (report.initialBalances) {
        const initialBalances = amounts(report.initialBalances);
        assertConserved(initialBalances);
        const expectedDeltas = finalBalances.map(after => {
          const prior = initialBalances.find(row => row.id === after.id);
          assert.ok(prior, `Missing initial balance for ${after.id}`);
          return { id: after.id, balance: after.balance - prior.balance, held: after.held };
        });
        assert.deepEqual(replayed, expectedDeltas);
      } else {
        assert.deepEqual(replayed, finalBalances);
      }
      console.log(JSON.stringify({
        file,
        verifiedRequests: report.requests.length,
        conserved: true,
        admissionVerified: true,
        duplicateSettlement: 'unchanged',
        conflictingSettlement: 'rejected'
      }));
    } finally { ledger.close(); }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
