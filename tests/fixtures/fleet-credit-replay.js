// Reverify retained physical signatures and replay their economic effects in a fresh database. No GPU or network.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openFleetCredits } from '../../server/fleet/credits.js';

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
        ledger.reserve(input);
        ledger.dispatch(input.id, input.consumer);
        now = request.outcome.settledAt;
        const corrupted = structuredClone(request.evidence);
        const signed = input.mode === 'whole-model' ? corrupted : corrupted.acknowledgment;
        const field = input.mode === 'whole-model' ? 'providerSignature' : 'signature';
        signed[field] = (signed[field][0] === 'A' ? 'B' : 'A') + signed[field].slice(1);
        await assert.rejects(ledger.settle(input.id, corrupted), 'Corrupted signature was accepted');
        const result = await ledger.settle(input.id, request.evidence);
        assert.deepEqual(result, request.outcome);
        const before = ledger.snapshot();
        assert.deepEqual(await ledger.settle(input.id, request.evidence), result);
        assert.deepEqual(ledger.snapshot(), before, 'Replay changed balances');
      }
      const amounts = snapshot => snapshot.accounts.map(({ id, balance, held }) => ({ id, balance, held }));
      assert.deepEqual(amounts(ledger.snapshot()), amounts(report.balances));
      console.log(JSON.stringify({ file, verifiedRequests: report.requests.length, conserved: true, duplicateSettlement: 'unchanged' }));
    } finally { ledger.close(); }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
