// Independent settlement replay over real signatures: every outcome class, retries, late and forged records.
// Proves the replay's arithmetic and refusals over records the production signers produce; it does not prove
// that any computation was correct or that a physical run produced these records.
import { describe, expect, it } from 'vitest';

import { createAttemptEvidenceSigner, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { signSettlementTerms, termsDigest, verifySettlementTerms } from '../../server/fleet/settlement-terms.js';
import { POLICY, createClock, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const replay = (records, at) => replaySettlement({ records, policies: [POLICY], at });
const bodyOf = record => { const { publicJwk: _k, signature: _s, ...rest } = record; return rest; };

describe('settlement replay', () => {
  it('settles a completed attempt from signed records alone, splitting the debit by the signed weights', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3] });
    const { reservations, balances } = await replay(a.all(), a.closesAt + 1);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: 'settled', outputs: 5, debit: 15, unacknowledgedOutputs: 0 });
    expect(reservations[0].credits.map(c => c.amount)).toEqual([3, 12]);
    expect(balances[parties.requester.peerId]).toBe(-15);
    // Each party's own copy is enough: the requester's records plus each stage's records, presented separately.
    const split = await replay([...a.held.requester, ...a.held.stages[0], ...a.held.stages[1]].reverse(), a.closesAt + 1);
    expect(split.reservations[0]).toMatchObject({ status: 'settled', debit: 15 });
  });

  it('charges only acknowledged outputs when the requester stops acknowledging, and stages stop within the bound', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 20 }, (_, i) => `t${i}`), stopAckingAfter: 6 });
    expect(a.delivered - a.acknowledged).toBeLessThanOrEqual(MAX_UNACKNOWLEDGED_OUTPUTS + 1);
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', outputs: 6, debit: 18 });
  });

  it('expires a provider-lost attempt with no charge, but only once the release window has passed', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { vanishStage: 0, vanishAfterStep: 1 });
    expect((await replay(a.all(), a.closesAt - 1)).reservations[0].status).toBe('open');
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r).toMatchObject({ status: 'expired', debit: 0 });
    expect(r.credits.every(c => c.amount === 0)).toBe(true);
  });

  it('settles a dropped attempt and its fresh retry separately: one expired, one charged', async () => {
    const parties = await createParties(2), clock = createClock();
    const dropped = await runAttempt(parties, { tag: 'first', vanishStage: 1, vanishAfterStep: 0, clock });
    const retry = await runAttempt(parties, { tag: 'retry', clock });
    const out = await replay([...dropped.all(), ...retry.all(), ...retry.all()], Math.max(dropped.closesAt, retry.closesAt) + 1);
    expect(out.counts).toEqual({ expired: 1, settled: 1 });
    expect(out.balances[parties.requester.peerId]).toBe(-15);
  });

  it('reports a requester that signed two sets of terms as a conflict', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const signer = createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(a.terms.notBefore) });
    const other = await signSettlementTerms({ signer, identity: a.identity, reservationId: a.reservationId, policy: POLICY,
      maxOutputTokens: 64, weights: [3, 1], notBefore: Date.parse(a.terms.notBefore), deadline: Date.parse(a.terms.deadline) });
    const r = (await replay([...a.all(), other], a.closesAt + 1)).reservations[0];
    expect(r.status).toBe('conflict');
    expect(r.debit).toBeNull();
  });

  it('reports a final stage that signed two output chains for one count as a conflict', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const last = a.held.stages[1].find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.output?.count === a.acknowledged);
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[1], now: () => Date.parse(last.signedAt) });
    const twin = await signer.sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(last), output: { ...last.output, chain: 'sha256:' + 'c'.repeat(64) } });
    const r = (await replay([...a.all(), twin], a.closesAt + 1)).reservations[0];
    expect(r.status).toBe('conflict');
    expect(r.conflicts.some(c => c.kind === 'output-chain' || c.kind === 'stage-receipt')).toBe(true);
  });

  it('answers unknown, not expired, when a delivered answer lacks one stage\'s closing receipt', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const records = a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0 && row.status !== 'executing'));
    const r = (await replay(records, a.closesAt + 1)).reservations[0];
    expect(r.status).toBe('unknown');
    expect(r.debit).toBeNull();
  });

  it('answers unknown when a stage\'s acceptance of the terms is missing, and when no terms are presented', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const noAcceptance = a.all().filter(row => !(row.schema === 'reploid.settlement-acceptance/v1' && row.partitionIndex === 1));
    expect((await replay(noAcceptance, a.closesAt + 1)).reservations[0].status).toBe('unknown');
    const noTerms = a.all().filter(row => row.schema !== 'reploid.settlement-terms/v1');
    expect((await replay(noTerms, a.closesAt + 1)).reservations[0]).toMatchObject({ status: 'unknown', debit: null });
  });

  it('rejects an edited acknowledgment and never charges more than the signatures support', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const edited = a.all().map(row => (row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count === 5 ? { ...row, count: 50 } : row));
    const out = await replay(edited, a.closesAt + 1);
    expect(out.rejected.length).toBeGreaterThan(0);
    expect(out.reservations[0].debit).toBeLessThanOrEqual(15);
  });

  it('does not let evidence signed after the deadline raise the charge', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { lateAckDelayMs: 5000 });
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r.debit).toBe(0);
    expect(r.late.some(row => row.kind === 'acknowledgment' && row.count === 5)).toBe(true);
  });

  it('never charges past the signed output ceiling, whoever acknowledged the extra outputs', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { maxOutputTokens: 3 });
    expect(a.acknowledged).toBe(5);
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', outputs: 5, chargedOutputs: 3, debit: 9, beyondCeiling: 2 });
  });

  it('charges nothing when a stage closes a fully acknowledged, unfinished answer with a failed receipt', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 12 }, (_, i) => `t${i}`), stagesFailAfter: 6 });
    expect(a.acknowledged).toBe(6);
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', debit: 0, chargedOutputs: 0 });
    expect(r.credits.every(c => c.amount === 0)).toBe(true);
  });

  it('charges the acknowledged prefix when the requester signed its own stop', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 12 }, (_, i) => `t${i}`), requesterStopAfter: 6 });
    const r = (await replay(a.all(), a.closesAt + 1)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', debit: 18, chargedOutputs: 6 });
    // Without the requester's stop the same records read as a stage ending the answer early.
    const unsigned = a.all().filter(row => row.schema !== 'reploid.settlement-stop/v1');
    expect((await replay(unsigned, a.closesAt + 1)).reservations[0].debit).toBe(0);
  });

  it('recovers the settled outcome when an operator shows each party a different subset (split-brain withholding)', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    // The operator hides the final closing receipt from the requester's view and the acknowledgments from the stages' view.
    const requesterView = a.held.requester;
    const stageView = a.held.stages.flat().filter(row => row.schema !== OUTPUT_ACKNOWLEDGMENT_SCHEMA);
    expect(['unknown', 'open', 'expired']).toContain((await replay(requesterView, a.closesAt + 1)).reservations[0].status);
    expect((await replay(stageView, a.closesAt + 1)).reservations[0].debit ?? 0).toBe(0);
    const union = await replay([...requesterView, ...stageView, ...a.held.stages.flat()], a.closesAt + 1);
    expect(union.reservations[0]).toMatchObject({ status: 'settled', debit: 15 });
  });

  it('marks terms that name an unsupplied policy or break it as invalid', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    expect((await replaySettlement({ records: a.all(), policies: [{ ...POLICY, version: 'other' }], at: a.closesAt + 1 })).reservations[0].status).toBe('invalid');
    const checked = await verifySettlementTerms(a.terms);
    expect(checked.ok).toBe(true);
    expect(await termsDigest(checked.body)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
