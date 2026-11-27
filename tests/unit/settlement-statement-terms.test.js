// @vitest-environment node
// The coordinator's signed statement binds the agreed terms (docs/settlement-replay.md, "The coordinator's statement":
// `termsDigest`, the digest of the agreed terms' body). A requester may sign more than one set of terms for one
// reservation and attempt; the replay settles on the set every stage accepted (step 2) and lists the other as a
// non-blocking `terms-equivocation`. The statement used to bind whichever requester-signed terms of the attempt came
// first in the presented records, and the records-only check accepted any terms of the attempt with the stated digest,
// so a statement could name terms nobody accepted. A live ledger settles a two-term reservation here; the records are
// signed with test keys and no physical trade is involved.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { coordinatorFor } from '../../server/fleet/coordinator-key.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { issueSettlementStatement, signSettlementStatement, verifySettlementStatement } from '../../server/fleet/settlement-statement.js';
import { signSettlementTerms, termsDigest } from '../../server/fleet/settlement-terms.js';
import { buildRecordsExport } from '../../server/fleet/trade-records.js';
import { POLICY as SCENARIO_POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';
import { verifyRecords } from '../../scripts/settlement/verify-records.js';

const POLICY = Object.freeze({ ...SCENARIO_POLICY, version: 'settlement-statement-terms', maxRequestMs: 30000 });
const bodyOf = ({ publicJwk: _key, signature: _signature, ...body }) => body;
const isReceiptOf = index => record => record.schema === STAGE_RECEIPT_SCHEMA && record.partitionIndex === index;
const closeOf = (records, index) => records.filter(isReceiptOf(index)).find(row => row.status !== 'executing');

const opened = [];
afterEach(async () => { for (const { ledger, directory } of opened.splice(0)) { try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } } });

/** A finished two-stage answer settled by a live ledger, and a second set of terms the requester signed for the same attempt. */
async function settledWithSecondTerms() {
  const parties = await createParties(2), directory = await mkdtemp(path.join(tmpdir(), 'reploid-statement-terms-'));
  const computers = [parties.requester, ...parties.stages].map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`,
    ownerId: `owner-${index}`, providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  let clock = 0;
  const ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => clock });
  opened.push({ ledger, directory });
  const a = await runAttempt(parties, { policy: ledger.policy, weights: [1, 3] }), all = [...new Set(a.all())];
  const notBefore = Date.parse(a.terms.notBefore), deadline = Date.parse(a.terms.deadline);
  // The requester's second set: the same attempt and shares, a shorter deadline. No stage accepted it.
  const second = await signSettlementTerms({ signer: createAttemptEvidenceSigner({ identity: parties.requester, now: () => notBefore }), identity: a.identity,
    reservationId: a.reservationId, policy: ledger.policy, maxOutputTokens: a.terms.maxOutputTokens, weights: [1, 3], notBefore, deadline: deadline - 1000 });
  clock = notBefore;
  ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
    providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
    model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
    inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
  ledger.dispatch(a.reservationId, parties.requester.peerId);
  a.identity.route.stages.forEach((_, index) => ledger.admit(a.reservationId, index, null));
  clock = notBefore + 25000;
  for (const index of [0, 1]) await ledger.collect(a.reservationId, { identity: a.identity, receipts: [closeOf(all, index)] });
  const acknowledgment = all.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((x, y) => y.count - x.count)[0];
  await ledger.collect(a.reservationId, { identity: a.identity, receipts: [], acknowledgment, acknowledgedReceipt: closeOf(all, 1) });
  const outcome = await ledger.fence(a.reservationId, parties.requester.peerId);
  expect(outcome).toMatchObject({ charge: 15, outputTokens: 5 });
  return { a, all, second, ledger, at: a.decidedAt, parties };
}

describe('the coordinator\'s statement names the agreed terms when the requester signed two sets', () => {
  it('the ledger binds the set the stages accepted, whatever order the records come in', async () => {
    const { a, all, second, ledger, at } = await settledWithSecondTerms();
    const coordinator = await coordinatorFor(await createSigningIdentity({ algorithm: 'Ed25519' }));
    const agreed = await termsDigest(bodyOf(a.terms)), other = await termsDigest(bodyOf(second));
    expect(other).not.toBe(agreed);
    for (const records of [[second, ...all], [...all, second]]) {
      const statement = await issueSettlementStatement({ credits: ledger, signer: coordinator.signer, id: a.reservationId, records, now: () => at });
      expect((await verifySettlementStatement(statement)).body).toMatchObject({ termsDigest: agreed, status: 'settled', debit: 15 });
    }
  });

  it('the records-only check refuses a statement that names the set nobody accepted, and accepts the one that names the agreed set', async () => {
    const { a, all, second, ledger, at, parties } = await settledWithSecondTerms();
    const coordinator = await coordinatorFor(await createSigningIdentity({ algorithm: 'Ed25519' }));
    const records = { records: [second, ...all], reservationId: a.reservationId, requesterId: parties.requester.peerId, policy: ledger.policy };
    const trace = ledger.trace(a.reservationId);
    const judge = async statement => {
      const verdict = await verifyRecords({ trade: buildRecordsExport({ id: 'two-terms', label: 'Two terms, test keys', records, trace, statement }), at,
        coordinatorKey: coordinator.publicKey });
      return verdict.attempts[0].problems;
    };
    const issued = await issueSettlementStatement({ credits: ledger, signer: coordinator.signer, id: a.reservationId, records: records.records, now: () => at });
    expect(await judge(issued)).toEqual([]);
    // The same amounts and hold, signed over the second set's digest.
    const named = await signSettlementStatement({ signer: coordinator.signer, terms: second, settlementRules: 'reploid.settlement-replay/v3', status: 'settled',
      debit: 15, payouts: [{ account: 'owner-1', amount: 3 }, { account: 'owner-2', amount: 12 }], forfeited: [], hold: { placed: a.terms.maximum, remaining: 0 }, now: () => at });
    expect((await judge(named)).join('\n')).toMatch(/names terms that are not the agreed ones/);
  });
});
