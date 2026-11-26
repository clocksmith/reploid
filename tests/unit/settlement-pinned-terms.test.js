// @vitest-environment node
// A split reservation settles under the terms it was made with. The ledger pins the price and K (the acknowledgment
// bound, `maxUnacknowledgedOutputs`) with the reservation and reads them from there, never from a later policy or
// today's defaults; a reservation made before they were pinned settles under its ledger's policy exactly as before.
// The live ledger (server/fleet/credits.js) and the settlement replay (server/fleet/settlement-replay.js) interpret the
// signed terms separately; each case checks that they agree exactly, that each billable output is charged once and
// that no hold is left. The records are signed here with test keys; this is no physical trade.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { POLICY as SCENARIO_POLICY, T0, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const OWNERS = ['owner-a', 'owner-b', 'owner-c'];
const isAck = record => record.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA;
const isReceiptOf = index => record => record.schema === STAGE_RECEIPT_SCHEMA && record.partitionIndex === index;
const closeOf = (records, index) => records.filter(isReceiptOf(index)).find(row => row.status !== 'executing');

const opened = [];
afterEach(async () => { for (const { ledger, directory } of opened.splice(0)) { try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } } });

const policyWithK = k => Object.freeze({ ...SCENARIO_POLICY, version: `settlement-pinned-terms-k${k}`, maxRequestMs: 30000, maxUnacknowledgedOutputs: k });

async function openLedger(parties, policy) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-pinned-terms-'));
  const computers = [parties.requester, ...parties.stages].map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`,
    ownerId: index === 0 ? 'owner-requester' : OWNERS[index - 1], providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const live = { clock: T0, file: path.join(directory, 'credits.sqlite') };
  live.ledger = await openFleetCredits({ file: live.file, computers, policy, now: () => live.clock });
  opened.push({ ledger: live.ledger, directory });
  return live;
}

const reservation = (parties, a) => ({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
  providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
  model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
  inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });

/** Every stage hands in its close, then the requester its acknowledgments with their receipts, then the fence. */
async function settleTrade(live, parties, a, all) {
  live.clock = T0 + 1000;
  live.ledger.dispatch(a.reservationId, parties.requester.peerId);
  a.identity.route.stages.forEach((_, index) => live.ledger.admit(a.reservationId, index, null));
  live.clock = Date.parse(a.terms.notBefore) + 25000;
  for (const index of a.terms.shares.keys()) await live.ledger.collect(a.reservationId, { identity: a.identity, receipts: [closeOf(all, index)] });
  for (const acknowledgment of all.filter(record => isAck(record) && record.count > 0).sort((x, y) => x.count - y.count)) {
    const acknowledgedReceipt = all.find(record => isReceiptOf(a.terms.shares.length - 1)(record) && record.output?.count === acknowledgment.count
      && record.output.chain === acknowledgment.chain);
    await live.ledger.collect(a.reservationId, { identity: a.identity, receipts: [], acknowledgment, acknowledgedReceipt });
  }
  return live.ledger.fence(a.reservationId, parties.requester.peerId);
}

/** The gate: exact agreement with the replay over the same signed records, one charge per billable output, no stranded hold. */
async function expectGate(live, a, outcome, all, policy) {
  const row = (await replaySettlement({ records: all, policies: [policy], at: Date.parse(a.terms.deadline) })).reservations[0];
  expect(row.status).toBe('settled');
  // Exact agreement: the same debit, the same credit for every stage, the same charged outputs.
  expect(outcome.charge).toBe(row.debit);
  expect(a.terms.shares.map(share => outcome.credits.filter(item => item.participantId === share.participantId)
    .reduce((sum, item) => sum + item.amount, 0))).toEqual(row.credits.map(credit => credit.amount));
  expect(outcome.outputTokens).toBe(row.chargedOutputs);
  // One charge per billable output: the charge is exactly the charged outputs at the signed price, paid out in full.
  expect(outcome.charge + outcome.ownComputeUnits).toBe(row.chargedOutputs * a.terms.creditsPerOutputToken);
  expect(outcome.credits.reduce((sum, item) => sum + item.amount, 0)).toBe(outcome.charge);
  // Presenting the evidence again charges nothing more.
  const journal = live.ledger.snapshot().journal.length;
  expect(await live.ledger.settle(a.reservationId, live.ledger.request(a.reservationId).evidence)).toEqual(outcome);
  expect(live.ledger.snapshot().journal).toHaveLength(journal);
  // No stranded hold, and every owner statement verifies.
  for (const account of live.ledger.snapshot().accounts) expect(account.held).toBe(0);
  for (const owner of ['owner-requester', ...OWNERS]) {
    expect(await verifyCreditStatement(live.ledger.statement(owner))).toMatchObject({ ok: true, uncheckedCount: 0, balanceMatches: true });
  }
  return row;
}

describe('a split trade settles under the terms it was reserved with', () => {
  it('a new trade with K = 3: the reservation pins K and the price, and ledger and replay agree exactly', async () => {
    const policy = policyWithK(3), parties = await createParties(3), live = await openLedger(parties, policy);
    // The requester stops acknowledging after three outputs, so K decides how the unfinished answer is read.
    const a = await runAttempt(parties, { tag: 'k3', outputs: SIX, weights: [1, 3, 2], policy, maxUnacknowledgedOutputs: 3, stopAckingAfter: 3 });
    expect(a.terms.maxUnacknowledgedOutputs).toBe(3);
    const binding = live.ledger.reserve(reservation(parties, a));
    expect(binding).toMatchObject({ maxUnacknowledgedOutputs: 3, creditsPerOutputToken: policy.creditsPerOutputToken,
      settlementRules: 'reploid.settlement-replay/v3' });
    const all = [...new Set(a.all())];
    const outcome = await settleTrade(live, parties, a, all);
    expect(outcome.outputTokens).toBe(3);
    const row = await expectGate(live, a, outcome, all, policy);
    // An unfinished answer with no stop and no more than K outputs withheld: both read it as an unattributed disconnect.
    expect(Boolean(outcome.reason === 'unattributed-disconnect-acknowledged-prefix')).toBe(/no signed stop/.test(row.reason));
  });

  for (const k of [1, 2]) {
    it(`a reservation made before K was pinned (K = ${k}) settles exactly as it did`, async () => {
      const policy = policyWithK(k), parties = await createParties(3);
      const a = await runAttempt(parties, { tag: `k${k}`, outputs: SIX, weights: [1, 3, 2], policy, maxUnacknowledgedOutputs: k, stopAckingAfter: 3 });
      const all = [...new Set(a.all())];
      // As made now, with K and the price pinned.
      const pinned = await openLedger(parties, policy);
      const binding = pinned.ledger.reserve(reservation(parties, a));
      expect(binding.maxUnacknowledgedOutputs).toBe(k);
      const now = await settleTrade(pinned, parties, a, all);
      await expectGate(pinned, a, now, all, policy);
      // As stored before they were pinned: the same binding without them, planted in a fresh ledger with its hold.
      const earlier = await openLedger(parties, policy);
      const { maxUnacknowledgedOutputs: _k, creditsPerOutputToken: _price, ...old } = binding;
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(earlier.file);
      try {
        database.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(old.id, JSON.stringify(old));
        database.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(old.maximum, old.accountId);
      } finally { database.close(); }
      const then = await settleTrade(earlier, parties, a, all);
      const { settledAt: _a, ...nowOutcome } = now, { settledAt: _b, ...thenOutcome } = then;
      expect(thenOutcome).toEqual(nowOutcome);
      await expectGate(earlier, a, then, all, policy);
    });
  }
});
