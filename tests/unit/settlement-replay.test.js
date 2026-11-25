// @vitest-environment node
// Independent settlement replay over real signatures: every outcome class, retries, late and forged records.
// Proves the replay's arithmetic and refusals over records the production signers produce; it does not prove
// that any computation was correct or that a physical run produced these records.
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import {
  createAttemptEvidenceSigner, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, MAX_UNACKNOWLEDGED_OUTPUTS, verifyOutputAcknowledgment
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { SETTLEMENT_RULES, SETTLEMENT_RULES_V1, UNFINISHED_ANSWER_TERMS, settledCreditUnits } from '../../server/fleet/credit-shares.js';
import {
  SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA, acceptSettlementTerms, signSettlementTerms, termsDigest, verifySettlementAcceptance,
  verifySettlementStop, verifySettlementTerms
} from '../../server/fleet/settlement-terms.js';
import { POLICY, T0, createClock, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const replay = (records, at) => replaySettlement({ records, policies: [POLICY], at });

/**
 * A live ledger over the parties' enrolled keys, one owner account each. `admit(a)` reserves and dispatches the
 * attempt at T0; `collect(a, records)` hands the ledger, before the deadline, the latest receipt of each stage found
 * in `records` and the requester's latest acknowledged pair, as the live route retains them.
 */
async function openLiveLedger(parties, policy = POLICY) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-settlement-ledger-'));
  const people = [parties.requester, ...parties.stages];
  const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `owner-${index}`,
    providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
  const live = { clock: T0, accountOf, owners: computers.map(row => row.ownerId) };
  live.ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy, now: () => live.clock });
  live.closesAt = T0 + policy.maxRequestMs + policy.partitionUnclaimedReleaseMs;
  // The ledger decides a split hold once the clock passes the window's end plus the clock allowance.
  live.decidedAt = live.closesAt + policy.maxClockSkewMs + 1;
  live.admit = a => {
    live.clock = T0;
    live.ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
      providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
      inputDigest: 'sha256:' + 'd'.repeat(64), maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
    live.ledger.dispatch(a.reservationId, parties.requester.peerId);
    a.identity.route.stages.forEach((_, index) => live.ledger.admit(a.reservationId, index));
  };
  live.evidence = (a, records) => {
    const receipts = parties.stages.map((_, index) => records.filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === index)
      .sort((x, y) => x.sequence - y.sequence).at(-1)).filter(Boolean);
    const acknowledgment = records.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((x, y) => x.count - y.count).at(-1);
    const acknowledgedReceipt = records.find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === parties.stages.length - 1
      && row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain);
    const stop = records.find(row => row.schema === SETTLEMENT_STOP_SCHEMA);
    return { identity: a.identity, receipts, acknowledgment, ...(acknowledgment.count > 0 ? { acknowledgedReceipt } : {}), ...(stop ? { stop } : {}) };
  };
  /** As the live route does: each acknowledgment is collected when it is signed, then everything once the last record is. */
  live.collectAsSigned = async (a, records) => {
    for (const acknowledgment of records.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count > 0).sort((x, y) => x.count - y.count)) {
      const acknowledgedReceipt = records.find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === parties.stages.length - 1
        && row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain);
      live.clock = Date.parse(acknowledgment.signedAt) + 1;
      await live.ledger.collect(a.reservationId, { identity: a.identity, receipts: [], acknowledgment, acknowledgedReceipt });
    }
    live.clock = Math.max(...records.map(row => Date.parse(row.signedAt))) + 1;
    await live.ledger.fence(a.reservationId, parties.requester.peerId);
    return live.ledger.collect(a.reservationId, live.evidence(a, records));
  };
  live.collect = async (a, records) => {
    live.clock = Date.parse(a.terms.notBefore) + 25000;
    await live.ledger.fence(a.reservationId, parties.requester.peerId);
    return live.ledger.collect(a.reservationId, live.evidence(a, records));
  };
  live.balances = () => live.ledger.snapshot().accounts.map(row => [row.id, row.balance, row.held]);
  live.replay = (records, at) => replaySettlement({ records, policies: [policy], at, accountOf: id => accountOf.get(id) });
  live.close = async () => { live.ledger.close(); await rm(directory, { recursive: true, force: true }); };
  return live;
}

const withoutClosing = (a, index) => a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === index && row.status !== 'executing'));
const bodyOf = record => { const { publicJwk: _k, signature: _s, ...rest } = record; return rest; };

describe('settlement replay', () => {
  it('settles a completed attempt from signed records alone, splitting the debit by the signed weights', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3] });
    const { reservations, balances } = await replay(a.all(), a.decidedAt);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ status: 'settled', outputs: 5, debit: 15, unacknowledgedOutputs: 0 });
    expect(reservations[0].credits.map(c => c.amount)).toEqual([3, 12]);
    expect(balances[parties.requester.peerId]).toBe(-15);
    // Each party's own copy is enough: the requester's records plus each stage's records, presented separately.
    const split = await replay([...a.held.requester, ...a.held.stages[0], ...a.held.stages[1]].reverse(), a.decidedAt);
    expect(split.reservations[0]).toMatchObject({ status: 'settled', debit: 15 });
  });

  it('charges only acknowledged outputs when the requester stops acknowledging, and stages stop within the bound', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 20 }, (_, i) => `t${i}`), stopAckingAfter: 6 });
    expect(a.delivered - a.acknowledged).toBeLessThanOrEqual(MAX_UNACKNOWLEDGED_OUTPUTS + 1);
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', outputs: 6, debit: 18 });
  });

  it('expires a provider-lost attempt with no charge, but only once the release window has passed', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { vanishStage: 0, vanishAfterStep: 1 });
    expect((await replay(a.all(), a.closesAt - 1)).reservations[0].status).toBe('open');
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
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

  it('settles on the terms every stage accepted when the requester signs a second set, and records the equivocation', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const signer = createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(a.terms.notBefore) });
    const other = await signSettlementTerms({ signer, identity: a.identity, reservationId: a.reservationId, policy: POLICY,
      maxOutputTokens: 64, weights: [3, 1], maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS,
      notBefore: Date.parse(a.terms.notBefore), deadline: Date.parse(a.terms.deadline) });
    const r = (await replay([...a.all(), other], a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', debit: 15 });
    expect(r.credits.map(c => c.amount)).toEqual([3, 12]);
    expect(r.conflicts).toEqual([expect.objectContaining({ signer: parties.requester.peerId, kind: 'terms-equivocation', blocking: false,
      settledOn: await termsDigest(bodyOf(a.terms)) })]);
    // Only when the stages' acceptances name different sets is there nothing to settle on.
    const stageSigner = createAttemptEvidenceSigner({ identity: parties.stages[1], now: () => Date.parse(a.terms.notBefore) });
    const split = a.all().filter(row => !(row.schema === 'reploid.settlement-acceptance/v1' && row.partitionIndex === 1));
    split.push(await acceptSettlementTerms({ signer: stageSigner, terms: other, partitionIndex: 1 }));
    const c = (await replay([...split, other], a.decidedAt)).reservations[0];
    expect(c).toMatchObject({ status: 'conflict', debit: null });
    expect(c.conflicts.some(row => row.kind === 'terms-equivocation' && row.blocking)).toBe(true);
  });

  it('lists terms signed by anyone but the route\'s requester as foreign, never as a conflict', async () => {
    const parties = await createParties(2), stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
    const a = await runAttempt(parties);
    const signer = createAttemptEvidenceSigner({ identity: stranger, now: () => Date.parse(a.terms.notBefore) });
    // Terms for the stranger's own binding of the same route: its route hash differs, because the hash binds the requester.
    const own = await signSettlementTerms({ signer, identity: { ...a.identity, requesterId: stranger.peerId }, reservationId: a.reservationId,
      policy: POLICY, maxOutputTokens: 64, weights: [3, 1], maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS,
      notBefore: Date.parse(a.terms.notBefore), deadline: Date.parse(a.terms.deadline) });
    // Terms copying the requester's route hash under the stranger's own requester ID.
    const copied = await signer.sign(SETTLEMENT_TERMS_SCHEMA, { ...bodyOf(a.terms), requesterId: stranger.peerId, shares: [...a.terms.shares].reverse()
      .map((row, index) => ({ ...row, partitionIndex: index })) });
    for (const records of [[own, ...a.all()], [copied, ...a.all()], [own, copied, ...a.all()]]) {
      const out = await replay(records, a.decidedAt);
      const r = out.reservations.find(row => row.requesterId === parties.requester.peerId);
      const theirs = out.reservations.find(row => row.requesterId === stranger.peerId);
      expect(r).toMatchObject({ status: 'settled', debit: 15, foreign: [], conflicts: [] });
      // The stranger's terms form the stranger's own attempt. Terms on another route are foreign; terms that no
      // receipt or acknowledgment contradicts describe an attempt that never started, which expires at no charge.
      const foreign = records.includes(own) ? 1 : 0;
      expect(theirs).toMatchObject({ reservationId: a.reservationId, ...(records.includes(copied)
        ? { status: 'expired', debit: 0 } : { status: 'unknown', debit: null }) });
      expect(theirs.foreign.length).toBe(foreign);
      expect(theirs.foreign.every(row => row.signer === stranger.peerId)).toBe(true);
      expect((theirs.credits ?? []).every(c => c.amount === 0)).toBe(true);
      expect(out.balances[parties.requester.peerId]).toBe(-15);
      expect(out.balances[stranger.peerId] ?? 0).toBe(0);
    }
  });

  it('lists terms and acceptances signed after the deadline as late and ignores them', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const afterDeadline = () => Date.parse(a.terms.deadline) + POLICY.maxClockSkewMs + 5000;
    const lateRequester = createAttemptEvidenceSigner({ identity: parties.requester, now: afterDeadline });
    const lateTerms = await signSettlementTerms({ signer: lateRequester, identity: a.identity, reservationId: a.reservationId, policy: POLICY,
      maxOutputTokens: 64, weights: [1, 3], maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS,
      notBefore: Date.parse(a.terms.notBefore), deadline: Date.parse(a.terms.deadline) });
    const lateAcceptances = await Promise.all(parties.stages.map((stage, index) => acceptSettlementTerms({
      signer: createAttemptEvidenceSigner({ identity: stage, now: afterDeadline }), terms: lateTerms, partitionIndex: index })));
    const others = a.all().filter(row => !['reploid.settlement-terms/v1', 'reploid.settlement-acceptance/v1'].includes(row.schema));
    const r = (await replay([lateTerms, ...lateAcceptances, ...others], a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'unknown', debit: null });
    expect(r.late).toEqual([expect.objectContaining({ kind: 'terms' })]);
    // In-time terms with late acceptances: the acceptances are listed and the attempt cannot settle.
    const lateAccepted = await Promise.all(parties.stages.map((stage, index) => acceptSettlementTerms({
      signer: createAttemptEvidenceSigner({ identity: stage, now: afterDeadline }), terms: a.terms, partitionIndex: index })));
    const s = (await replay([a.terms, ...lateAccepted, ...others], a.decidedAt)).reservations[0];
    expect(s).toMatchObject({ status: 'unknown', debit: null });
    expect(s.late.filter(row => row.kind === 'acceptance').map(row => row.partitionIndex)).toEqual([0, 1]);
  });

  it('rejects terms, acceptances and stops whose key carries extra members, as acknowledgments are rejected', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 12 }, (_, i) => `t${i}`), requesterStopAfter: 6 });
    const stop = a.all().find(row => row.schema === SETTLEMENT_STOP_SCHEMA);
    const acceptance = a.all().find(row => row.schema === 'reploid.settlement-acceptance/v1');
    const ack = a.all().find(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA);
    const extra = row => ({ ...row, publicJwk: { ...row.publicJwk, alg: 'EdDSA' } });
    expect(await verifyOutputAcknowledgment(extra(ack))).toMatchObject({ ok: false });
    expect(await verifySettlementTerms(extra(a.terms))).toMatchObject({ ok: false });
    expect(await verifySettlementAcceptance(extra(acceptance))).toMatchObject({ ok: false });
    expect(await verifySettlementStop(extra(stop))).toMatchObject({ ok: false });
    expect(await verifySettlementTerms(a.terms)).toMatchObject({ ok: true });
  });

  it('signs K into the terms and reads it from there, not from a constant', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    expect(a.terms.maxUnacknowledgedOutputs).toBe(MAX_UNACKNOWLEDGED_OUTPUTS);
    const { maxUnacknowledgedOutputs: _k, ...missing } = bodyOf(a.terms);
    const signer = createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(a.terms.signedAt) });
    expect(await verifySettlementTerms(await signer.sign(SETTLEMENT_TERMS_SCHEMA, missing))).toMatchObject({ ok: false, problem: 'terms_malformed' });
    await expect(acceptSettlementTerms({ signer: createAttemptEvidenceSigner({ identity: parties.stages[0] }),
      terms: await signer.sign(SETTLEMENT_TERMS_SCHEMA, { ...missing, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS + 1 }), partitionIndex: 0 }))
      .rejects.toThrow('acknowledgment bound');
    // A stage that stopped K + 1 outputs ahead of the requester: under the terms' K the requester withheld, so the
    // acknowledged prefix is owed; under terms that signed a larger K the same gap reads as the stage ending early.
    const outputs = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const stall = await runAttempt(parties, { tag: 'k2', outputs, stopAckingAfter: 6 });
    expect((await replay(stall.all(), stall.decidedAt)).reservations[0]).toMatchObject({ debit: 18, chargedOutputs: 6 });
    // K reaches the verifier through the public policy the terms name: a policy that publishes K = 3 decides with 3,
    // whatever the verifier would assume for a policy that names none.
    const WIDE = { ...POLICY, version: 'wide-k', maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS + 1 };
    const wide = await runAttempt(parties, { tag: 'k3', outputs, stopAckingAfter: 6, policy: WIDE, maxUnacknowledgedOutputs: WIDE.maxUnacknowledgedOutputs });
    expect(wide.terms.maxUnacknowledgedOutputs).toBe(MAX_UNACKNOWLEDGED_OUTPUTS + 1);
    for (const assumed of [MAX_UNACKNOWLEDGED_OUTPUTS, MAX_UNACKNOWLEDGED_OUTPUTS + 1]) {
      const underWideK = await replaySettlement({ records: wide.all(), policies: [WIDE], at: wide.decidedAt, maxUnacknowledgedOutputs: assumed });
      expect(underWideK.reservations[0]).toMatchObject({ status: 'settled', debit: 0, chargedOutputs: 0 });
    }
    // The signer refuses terms whose K differs from their policy's, and a verifier answers invalid for them.
    await expect(runAttempt(parties, { tag: 'k-mismatch', policy: WIDE })).rejects.toThrow('acknowledgment bound their policy publishes');
    const resigned = await signer.sign(SETTLEMENT_TERMS_SCHEMA, { ...bodyOf(stall.terms), maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS + 1 });
    const mismatched = [resigned, ...stall.all().filter(row => row.schema !== SETTLEMENT_TERMS_SCHEMA)];
    expect((await replay(mismatched, stall.decidedAt)).reservations[0]).toMatchObject({ status: 'invalid', debit: null });
    // A policy without K falls back to the stages' receiver policy's value, which the replay takes as an input.
    const { maxUnacknowledgedOutputs: _published, ...older } = POLICY;
    const legacy = await runAttempt(parties, { tag: 'k-legacy', outputs, stopAckingAfter: 6, policy: older });
    expect((await replaySettlement({ records: legacy.all(), policies: [older], at: legacy.decidedAt })).reservations[0]).toMatchObject({ debit: 18 });
  });

  it('reports a final stage that signed two output chains for one count as a conflict', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const last = a.held.stages[1].find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.output?.count === a.acknowledged);
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[1], now: () => Date.parse(last.signedAt) });
    const twin = await signer.sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(last), output: { ...last.output, chain: 'sha256:' + 'c'.repeat(64) } });
    const r = (await replay([...a.all(), twin], a.decidedAt)).reservations[0];
    expect(r.status).toBe('conflict');
    expect(r.conflicts.some(c => c.kind === 'output-chain' || c.kind === 'stage-receipt')).toBe(true);
  });

  it('pays a delivered answer after the release window when one stage withholds its closing receipt but signed every step', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const a = await runAttempt(parties, { tag: 'veto', outputs });
    for (const index of [0, 1]) {
      const records = a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === index && row.status !== 'executing'));
      expect((await replay(records, a.closesAt - 1)).reservations[0]).toMatchObject({ status: 'open', debit: null });
      const r = (await replay(records, a.decidedAt)).reservations[0];
      expect(r).toMatchObject({ status: 'settled', debit: 120, outputs: 40, chargedOutputs: 40, closedAtLastStep: [index] });
      expect(r.credits.map(c => c.amount)).toEqual([30, 90]);
    }
    // A stage with no in-time receipt covering the whole answer stays undecided, whatever the time.
    const partial = a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0 && (row.status !== 'executing' || row.steps > 20)));
    for (const at of [a.closesAt - 1, a.decidedAt]) {
      expect((await replay(partial, at)).reservations[0]).toMatchObject({ status: 'unknown', debit: null });
    }
  });

  it('settles a withheld closing receipt in the live ledger at window expiry exactly as the replay does', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const live = await openLiveLedger(parties);
    try {
      let charged = 0;
      for (const index of [0, 1]) {
        const a = await runAttempt(parties, { tag: `live-veto-${index}`, outputs });
        const records = withoutClosing(a, index);
        live.admit(a);
        expect(await live.collect(a, records)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: 40, awaitingStages: [index] });
        // Before the window both still wait for the stage's closing receipt.
        live.clock = live.decidedAt - 1;
        expect(await live.ledger.recover(a.reservationId)).toMatchObject({ status: 'pending', awaitingStages: [index] });
        expect((await live.replay(records, a.decidedAt - 1)).reservations[0].status).toBe('open');
        live.clock = live.decidedAt;
        const outcome = await live.ledger.recover(a.reservationId);
        const r = (await live.replay(records, a.decidedAt)).reservations[0];
        expect(r).toMatchObject({ status: 'settled', debit: 120, closedAtLastStep: [index] });
        expect(outcome).toMatchObject({ charge: r.debit, outputTokens: 40, closedAtLastStep: [index], reason: 'closed-at-last-signed-step-after-window' });
        expect(outcome.credits.map(row => [row.participantId, row.amount])).toEqual(r.credits.map(row => [row.participantId, row.amount]));
        charged += outcome.charge;
        // Exactly once: further expiry passes, recovery, statements and snapshots post nothing more.
        const journal = live.ledger.snapshot().journal.length;
        expect(await live.ledger.recover(a.reservationId)).toEqual(outcome);
        live.ledger.statement('owner-0');
        expect(live.ledger.snapshot().journal).toHaveLength(journal);
      }
      expect(live.balances()).toEqual([['owner-0', -charged, 0], ['owner-1', 60, 0], ['owner-2', 180, 0]]);
    } finally {
      await live.close();
    }
  });

  it('expires provider-loss attempts in the live ledger with no charge, as the replay does', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const live = await openLiveLedger(parties);
    try {
      for (const [vanishStage, vanishAfterStep] of [[1, 9], [0, 9], [0, 1]]) {
        const lost = await runAttempt(parties, { tag: `live-loss-${vanishStage}-${vanishAfterStep}`, outputs, vanishStage, vanishAfterStep });
        expect(lost.acknowledged).toBeGreaterThan(0);
        live.admit(lost);
        await live.collect(lost, lost.all());
        live.clock = live.decidedAt;
        const outcome = await live.ledger.recover(lost.reservationId);
        const r = (await live.replay(lost.all(), lost.decidedAt)).reservations[0];
        expect(r).toMatchObject({ status: 'expired', debit: 0 });
        expect(outcome).toMatchObject({ status: 'expired', charge: 0, credits: [], reason: 'stage-unclaimed-after-window' });
        expect(outcome.closedAtLastStep).toBeUndefined();
      }
      expect(live.balances()).toEqual([['owner-0', 0, 0], ['owner-1', 0, 0], ['owner-2', 0, 0]]);
      expect(live.ledger.snapshot().journal).toHaveLength(0);
    } finally {
      await live.close();
    }
  });

  it('refuses to let a late claim reopen a hold the window settled or expired', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const live = await openLiveLedger(parties);
    try {
      const a = await runAttempt(parties, { tag: 'live-late', outputs });
      live.admit(a);
      await live.collect(a, withoutClosing(a, 0));
      live.clock = live.decidedAt + 1000;
      const outcome = await live.ledger.recover(a.reservationId);
      expect(outcome.closedAtLastStep).toEqual([0]);
      const before = { balances: live.balances(), journal: live.ledger.snapshot().journal.length };
      // The withheld closing receipt arrives after the window: the settled outcome stands and nothing moves.
      const full = live.evidence(a, a.all());
      expect(await live.ledger.collect(a.reservationId, full)).toEqual(outcome);
      expect(await live.ledger.settle(a.reservationId, full)).toEqual(outcome);
      // Evidence naming a stage that did close as closed at its last step is refused.
      await expect(live.ledger.settle(a.reservationId, { ...full, closedAtLastStep: [0, 1] })).rejects.toThrow();
      expect({ balances: live.balances(), journal: live.ledger.snapshot().journal.length }).toEqual(before);

      // A provider-loss hold that expired stays expired whatever arrives later.
      const lost = await runAttempt(parties, { tag: 'live-late-loss', outputs, vanishStage: 0, vanishAfterStep: 9 });
      live.admit(lost);
      await live.collect(lost, lost.all());
      live.clock = live.decidedAt + 1000;
      expect(await live.ledger.recover(lost.reservationId)).toMatchObject({ status: 'expired', charge: 0 });
      const lostEvidence = live.evidence(lost, lost.all());
      await expect(live.ledger.settle(lost.reservationId, lostEvidence)).rejects.toThrow('Claim window closed');
      await expect(live.ledger.settle(lost.reservationId, { ...lostEvidence, closedAtLastStep: [0] })).rejects.toThrow('Claim window closed');
      await expect(live.ledger.collect(lost.reservationId, lostEvidence)).rejects.toThrow('Claim window closed');
      expect({ balances: live.balances(), journal: live.ledger.snapshot().journal.length }).toEqual(before);
      // The statement verifier blocks the same late claims offline.
      const verdict = await verifyCreditStatement(live.ledger.statement('owner-0'), { lateClaims: [
        { requestId: a.reservationId, evidence: full, at: live.clock },
        { requestId: lost.reservationId, evidence: lostEvidence, at: live.clock }] });
      expect(verdict.lateClaims.map(row => row.reopenAllowed)).toEqual([false, false]);
    } finally {
      await live.close();
    }
  });

  it('accepts the window-settled entries in every account statement, and only at or after the window', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const live = await openLiveLedger(parties);
    try {
      for (const index of [0, 1]) {
        const a = await runAttempt(parties, { tag: `live-statement-${index}`, outputs });
        live.admit(a);
        await live.collect(a, withoutClosing(a, index));
      }
      const lost = await runAttempt(parties, { tag: 'live-statement-loss', outputs, vanishStage: 1, vanishAfterStep: 9 });
      live.admit(lost);
      await live.collect(lost, lost.all());
      live.clock = live.decidedAt;
      live.ledger.expire();
      for (const owner of live.owners) {
        const statement = live.ledger.statement(owner);
        const verdict = await verifyCreditStatement(statement);
        expect(verdict).toMatchObject({ ok: true, uncheckedCount: 0, verifiedCount: 2, expiredCount: 1, balanceMatches: true });
        expect(verdict.recomputedBalance).toBe(statement.balance);
      }
      const statement = live.ledger.statement('owner-0');
      expect(statement.balance).toBe(-240);
      // The same entry dated before the window, or listing a stage that did close, does not verify.
      const early = structuredClone(statement);
      early.entries[0].at = live.decidedAt - 1;
      expect((await verifyCreditStatement(early)).unchecked[0].reason).toMatch('release window');
      const widened = structuredClone(statement);
      widened.entries[0].evidence.closedAtLastStep = [0, 1];
      expect((await verifyCreditStatement(widened)).unchecked).toHaveLength(1);
    } finally {
      await live.close();
    }
  });

  it('never turns a provider loss into a charge through the unclosed-stage rule', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    // The final stage drops after 10 of 40 outputs, every one acknowledged, and never closes; or the first stage drops.
    for (const [vanishStage, vanishAfterStep] of [[1, 9], [0, 9], [0, 1]]) {
      const lost = await runAttempt(parties, { tag: `loss-${vanishStage}-${vanishAfterStep}`, outputs, vanishStage, vanishAfterStep });
      expect(lost.acknowledged).toBeGreaterThan(0);
      const r = (await replay(lost.all(), lost.decidedAt)).reservations[0];
      expect(r).toMatchObject({ status: 'expired', debit: 0 });
      expect(r.credits.every(c => c.amount === 0)).toBe(true);
    }
  });

  it('answers unknown when a stage\'s acceptance of the terms is missing, and when no terms are presented', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const noAcceptance = a.all().filter(row => !(row.schema === 'reploid.settlement-acceptance/v1' && row.partitionIndex === 1));
    expect((await replay(noAcceptance, a.decidedAt)).reservations[0].status).toBe('unknown');
    const noTerms = a.all().filter(row => row.schema !== 'reploid.settlement-terms/v1');
    expect((await replay(noTerms, a.decidedAt)).reservations[0]).toMatchObject({ status: 'unknown', debit: null });
  });

  it('rejects an edited acknowledgment and never charges more than the signatures support', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    const edited = a.all().map(row => (row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count === 5 ? { ...row, count: 50 } : row));
    const out = await replay(edited, a.decidedAt);
    expect(out.rejected.length).toBeGreaterThan(0);
    expect(out.reservations[0].debit).toBeLessThanOrEqual(15);
  });

  it('does not let evidence signed after the deadline raise the charge', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { lateAckDelayMs: 5000 });
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
    // The last acknowledgment is late, so only the four signed in time are charged; the stages' closes, also after
    // the deadline but inside the release window, count.
    expect(r).toMatchObject({ status: 'settled', debit: 12, outputs: 4 });
    expect(r.late.some(row => row.kind === 'acknowledgment' && row.count === 5)).toBe(true);
  });

  it('never charges past the signed output ceiling, whoever acknowledged the extra outputs', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { maxOutputTokens: 3 });
    expect(a.acknowledged).toBe(5);
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', outputs: 5, chargedOutputs: 3, debit: 9, beyondCeiling: 2 });
  });

  it('charges nothing when a stage closes a fully acknowledged, unfinished answer with a failed receipt', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 12 }, (_, i) => `t${i}`), stagesFailAfter: 6 });
    expect(a.acknowledged).toBe(6);
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', debit: 0, chargedOutputs: 0 });
    expect(r.credits.every(c => c.amount === 0)).toBe(true);
  });

  it('charges the acknowledged prefix when the requester signed its own stop', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { outputs: Array.from({ length: 12 }, (_, i) => `t${i}`), requesterStopAfter: 6 });
    const r = (await replay(a.all(), a.decidedAt)).reservations[0];
    expect(r).toMatchObject({ status: 'settled', debit: 18, chargedOutputs: 6 });
    // Without the requester's stop the same records read as a stage ending the answer early.
    const unsigned = a.all().filter(row => row.schema !== 'reploid.settlement-stop/v1');
    expect((await replay(unsigned, a.decidedAt)).reservations[0].debit).toBe(0);
  });

  it('recovers the settled outcome when an operator shows each party a different subset (split-brain withholding)', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    // The operator hides the final closing receipt from the requester's view and the acknowledgments from the stages' view.
    const requesterView = a.held.requester;
    const stageView = a.held.stages.flat().filter(row => row.schema !== OUTPUT_ACKNOWLEDGMENT_SCHEMA);
    expect(['unknown', 'open', 'expired']).toContain((await replay(requesterView, a.decidedAt)).reservations[0].status);
    expect((await replay(stageView, a.decidedAt)).reservations[0].debit ?? 0).toBe(0);
    const union = await replay([...requesterView, ...stageView, ...a.held.stages.flat()], a.decidedAt);
    expect(union.reservations[0]).toMatchObject({ status: 'settled', debit: 15 });
  });

  it('marks terms that name an unsupplied policy or break it as invalid', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    expect((await replaySettlement({ records: a.all(), policies: [{ ...POLICY, version: 'other' }], at: a.decidedAt })).reservations[0].status).toBe('invalid');
    const checked = await verifySettlementTerms(a.terms);
    expect(checked.ok).toBe(true);
    expect(await termsDigest(checked.body)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('charges a finished answer whose last one or two acknowledgments the requester withholds', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    for (const [acked, debit] of [[40, 120], [39, 117], [38, 114], [37, 111]]) {
      const a = await runAttempt(parties, { tag: `w${acked}`, outputs, stopAckingAfter: acked });
      expect(a.delivered).toBe(40);
      const r = (await replay(a.all(), a.decidedAt)).reservations[0];
      expect(r).toMatchObject({ status: 'settled', outputs: acked, debit, chargedOutputs: acked, unacknowledgedOutputs: 40 - acked });
    }
  });

  it('matches the live ledger\'s charge and credits for the same signed records', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-settlement-replay-'));
    const people = [parties.requester, ...parties.stages];
    const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
    const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
    let clock = T0;
    const ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => clock });
    try {
      for (const acked of [40, 39, 38, 37, 10]) {
        clock = T0;
        const a = await runAttempt(parties, { tag: `l${acked}`, outputs, stopAckingAfter: acked });
        ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
          providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
          model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
          inputDigest: 'sha256:' + 'd'.repeat(64), maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
        ledger.dispatch(a.reservationId, parties.requester.peerId);
        clock = Date.parse(a.terms.notBefore) + 25000;
        // The evidence the ledger settles on: each stage's closing receipt and the requester's latest acknowledged pair.
        const closing = a.held.stages.map(rows => rows.filter(row => row.schema === STAGE_RECEIPT_SCHEMA).at(-1));
        const acknowledgments = a.held.requester.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA);
        const acknowledgment = acknowledgments.at(-1);
        const acknowledgedReceipt = a.held.requester.find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.output?.count === acknowledgment.count);
        const live = await ledger.settle(a.reservationId, { identity: a.identity, receipts: closing, acknowledgment, acknowledgedReceipt });
        const r = (await replaySettlement({ records: a.all(), policies: [POLICY], at: a.decidedAt, accountOf: id => accountOf.get(id) })).reservations[0];
        expect(r.status).toBe('settled');
        expect(r.debit).toBe(live.charge);
        expect(r.credits.map(row => [row.participantId, row.amount])).toEqual(live.credits.map(row => [row.participantId, row.amount]));
        expect(live.charge).toBe(acked * POLICY.creditsPerOutputToken);
      }
    } finally {
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('charges a requester that signs a second acknowledgment with another chain, and names it, not the stage', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const a = await runAttempt(parties, { tag: 'self', outputs });
    const acks = [...new Set(a.all().filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA))].sort((x, y) => x.count - y.count);
    const fake = 'sha256:' + 'e'.repeat(64);
    const resign = (row, extra = {}) => createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(extra.signedAt ?? row.signedAt) })
      .sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(row), chain: fake, ...extra });
    const byCount = count => acks.find(row => row.count === count);
    for (const extra of [await resign(byCount(40)), await resign(byCount(1)), await resign(byCount(1), { signedAt: a.terms.notBefore }), await resign(byCount(0))]) {
      const r = (await replay([...a.all(), extra], a.decidedAt)).reservations[0];
      expect(r).toMatchObject({ status: 'settled', debit: 120, outputs: 40 });
      expect(r.credits.map(c => c.amount)).toEqual([30, 90]);
      expect(r.conflicts).toEqual([expect.objectContaining({ signer: parties.requester.peerId, kind: 'acknowledgment-equivocation', count: extra.count,
        blocking: false, chains: [fake] })]);
    }
    // With no acknowledgment of a count matching the final stage's chain, the records cannot show who lied: blocking,
    // and listed against neither signer alone.
    const without = a.all().filter(row => !(row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count === 40));
    const c = (await replay([...without, await resign(byCount(40))], a.decidedAt)).reservations[0];
    expect(c).toMatchObject({ status: 'conflict', debit: null });
    expect(c.conflicts).toEqual([{ signer: null, signers: [parties.stages[1].peerId, parties.requester.peerId], kind: 'output-chain', blocking: true, count: 40 }]);
  });

  it('matches the live ledger when the requester has signed a second acknowledgment with another chain', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-settlement-replay-'));
    const people = [parties.requester, ...parties.stages];
    const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
    const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
    let clock = T0;
    const ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => clock });
    try {
      const a = await runAttempt(parties, { tag: 'self-ledger', outputs });
      ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
        providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
        model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
        inputDigest: 'sha256:' + 'd'.repeat(64), maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
      ledger.dispatch(a.reservationId, parties.requester.peerId);
      clock = Date.parse(a.terms.notBefore) + 25000;
      const closing = a.held.stages.map(rows => rows.filter(row => row.schema === STAGE_RECEIPT_SCHEMA).at(-1));
      const acknowledgment = a.held.requester.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).at(-1);
      const acknowledgedReceipt = a.held.requester.find(row => row.schema === STAGE_RECEIPT_SCHEMA && row.output?.count === acknowledgment.count);
      const live = await ledger.settle(a.reservationId, { identity: a.identity, receipts: closing, acknowledgment, acknowledgedReceipt });
      const second = await createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(acknowledgment.signedAt) })
        .sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(acknowledgment), chain: 'sha256:' + 'e'.repeat(64) });
      const r = (await replaySettlement({ records: [...a.all(), second], policies: [POLICY], at: a.decidedAt, accountOf: id => accountOf.get(id) })).reservations[0];
      expect(live.charge).toBe(120);
      expect(r).toMatchObject({ status: 'settled', debit: live.charge });
      expect(r.credits.map(row => [row.participantId, row.amount])).toEqual(live.credits.map(row => [row.participantId, row.amount]));
    } finally {
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps a stranger\'s records under a known reservation ID in the stranger\'s own attempt', async () => {
    const parties = await createParties(2), stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
    const outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const a = await runAttempt(parties, { tag: 'squat', outputs });
    const binding = a.all().find(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count === 0);
    const sign = body => createAttemptEvidenceSigner({ identity: stranger, now: () => Date.parse(body.signedAt) }).sign(body.schema, body);
    const terms = await sign({ ...bodyOf(a.terms), requesterId: stranger.peerId, shares: [{ partitionIndex: 0, participantId: stranger.peerId, weight: 1 }] });
    const acceptance = await sign({ schema: 'reploid.settlement-acceptance/v1', termsDigest: await termsDigest(bodyOf(terms)), reservationId: terms.reservationId,
      attemptId: terms.attemptId, participantId: stranger.peerId, partitionIndex: 0, signedAt: terms.signedAt });
    const own = await sign({ ...bodyOf(binding), requesterId: stranger.peerId });
    const out = await replay([...a.all(), terms, acceptance, own], a.decidedAt);
    expect(out.reservations).toHaveLength(2);
    const real = out.reservations.find(row => row.requesterId === parties.requester.peerId);
    const theirs = out.reservations.find(row => row.requesterId === stranger.peerId);
    expect(real).toMatchObject({ reservationId: a.reservationId, status: 'settled', debit: 120, conflicts: [], foreign: [] });
    expect(real.credits.map(c => c.amount)).toEqual([30, 90]);
    expect(theirs.reservationId).toBe(a.reservationId);
    expect((theirs.credits ?? []).every(c => c.participantId === stranger.peerId)).toBe(true);
    expect(out.balances).toEqual({ [parties.requester.peerId]: -120, [parties.stages[0].peerId]: 30, [parties.stages[1].peerId]: 90,
      ...(theirs.status === 'expired' ? { [stranger.peerId]: 0 } : {}) });
  });
});

/** The live ledger's deadline is the signed one: the requester signs `deadline = notBefore + maxRequestMs`. */
const SAME_DEADLINE = Object.freeze({ ...POLICY, maxRequestMs: 30000 });
const amounts = rows => rows.map(row => [row.participantId, row.amount]);

describe('the live ledger posts what the replay computes', () => {
  // The known difference, pending the owner's decision (docs/settlement-replay.md): the replay makes an unfinished
  // answer that the stages closed, with no requester stop, free; the ledger charges the acknowledged prefix, as it did
  // before the replay's rules, so a requester cannot read what it wants, stop asking and pay nothing.
  it('charges the acknowledged prefix when the stages close an unfinished answer and no stop was signed, where the replay charges nothing', async () => {
    const parties = await createParties(2), live = await openLiveLedger(parties, SAME_DEADLINE);
    const outputs = Array.from({ length: 40 }, (_, i) => ` w${i}`);
    try {
      // [tag, attempt options, records presented, the ledger's charge and credits, the replay's charge]
      const cases = [['failed', { stagesFailAfter: 3 }, a => a.all(), 9, [2, 7], 0],
        ['stopped', { requesterStopAfter: 3 }, a => a.all(), 9, [2, 7], 9],
        // The same stopped answer without the requester's signed stop.
        ['unsigned', { requesterStopAfter: 3 }, a => a.all().filter(row => row.schema !== SETTLEMENT_STOP_SCHEMA), 9, [2, 7], 0],
        // The walk-away: 39 of 40 outputs delivered and acknowledged, then the requester stops asking and the stages
        // close as failed. Signing a stop would cost 117; walking away costs the same.
        ['walk-away', { outputs, stagesFailAfter: 39 }, a => a.all(), 117, [29, 88], 0],
        ['walk-away-stop', { outputs, requesterStopAfter: 39 }, a => a.all(), 117, [29, 88], 117]];
      for (const [tag, options, recordsOf, charge, credits, replayed] of cases) {
        const a = await runAttempt(parties, { tag: `ended-${tag}`, policy: SAME_DEADLINE, ...options }), records = recordsOf(a);
        expect(a.acknowledged).toBe(charge / 3);
        live.admit(a);
        await live.collectAsSigned(a, records);
        live.clock = live.decidedAt;
        const outcome = await live.ledger.recover(a.reservationId), r = (await live.replay(records, a.decidedAt)).reservations[0];
        expect(outcome.charge).toBe(charge);
        expect(outcome.credits.map(row => row.amount)).toEqual(credits);
        expect(r).toMatchObject({ status: 'settled', debit: replayed });
        if (replayed === 0) {
          expect(outcome.reason).toBe('unfinished-answer-closed-without-requester-stop');
          expect(r).toMatchObject({ outputs: charge / 3, chargedOutputs: 0 });
        } else expect(amounts(outcome.credits)).toEqual(amounts(r.credits));
      }
    } finally { await live.close(); }
  });

  it('keeps charging nothing for a stage-ended answer reserved under the first replay rules', () => {
    const request = { mode: 'partition', unfinishedTerms: UNFINISHED_ANSWER_TERMS };
    const observed = { outputTokens: 39, stageEnded: true };
    expect(settledCreditUnits({ ...request, settlementRules: SETTLEMENT_RULES_V1 }, observed, 3)).toBe(0);
    expect(settledCreditUnits({ ...request, settlementRules: SETTLEMENT_RULES }, observed, 3)).toBe(117);
  });

  it('charges the outputs acknowledged in time when the last output, its acknowledgment and the closes come inside the release window', async () => {
    const parties = await createParties(2), live = await openLiveLedger(parties, SAME_DEADLINE);
    try {
      // The fifth step itself runs 5 s past the deadline: its step times, acknowledgment and the closes are all late.
      const base = createClock(); let steps = 0;
      const clock = { now: base.now, set: base.set, advance: ms => (++steps === 5 ? (base.set(T0 + 30000 + 5000), base.now()) : base.advance(ms)) };
      const a = await runAttempt(parties, { tag: 'late-step', policy: SAME_DEADLINE, clock });
      live.admit(a);
      await live.collectAsSigned(a, a.all());
      live.clock = live.decidedAt;
      const outcome = await live.ledger.recover(a.reservationId), r = (await live.replay(a.all(), a.decidedAt)).reservations[0];
      expect(r).toMatchObject({ status: 'settled', debit: 12, outputs: 4 });
      expect(outcome).toMatchObject({ charge: 12, outputTokens: 4 });
      expect(amounts(outcome.credits)).toEqual(amounts(r.credits));
    } finally { await live.close(); }
  });

  it('charges an answer that ran past the signed ceiling up to the ceiling, and records the overrun', async () => {
    const parties = await createParties(2), live = await openLiveLedger(parties, SAME_DEADLINE);
    try {
      for (const [tag, recordsOf] of [['all', a => a.all()], ['veto', a => withoutClosing(a, 0)]]) {
        const a = await runAttempt(parties, { tag: `ceiling-${tag}`, policy: SAME_DEADLINE, maxOutputTokens: 3 }), records = recordsOf(a);
        expect(a.acknowledged).toBe(5);
        live.admit(a);
        await live.collectAsSigned(a, records);
        live.clock = live.decidedAt;
        const outcome = await live.ledger.recover(a.reservationId), r = (await live.replay(records, a.decidedAt)).reservations[0];
        expect(r).toMatchObject({ status: 'settled', debit: 9, chargedOutputs: 3, beyondCeiling: 2 });
        expect(outcome).toMatchObject({ charge: 9, outputTokens: 3, beyondCeiling: 2 });
        expect(amounts(outcome.credits)).toEqual(amounts(r.credits));
      }
    } finally { await live.close(); }
  });

  it('names a delivered answer that one stage has no receipt covering as the replay\'s unknown, and moves nothing', async () => {
    const parties = await createParties(2), live = await openLiveLedger(parties, SAME_DEADLINE);
    try {
      const a = await runAttempt(parties, { tag: 'uncovered', policy: SAME_DEADLINE });
      const records = a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0));
      live.admit(a);
      await live.collectAsSigned(a, records);
      live.clock = live.decidedAt;
      const outcome = await live.ledger.recover(a.reservationId);
      expect((await live.replay(records, a.decidedAt)).reservations[0]).toMatchObject({ status: 'unknown' });
      expect(outcome).toMatchObject({ status: 'expired', charge: 0, credits: [], reason: 'unknown-delivered-answer-without-covering-receipt' });
    } finally { await live.close(); }
  });
});

describe('row members as docs/settlement-replay.md states them', () => {
  it('lists a stage on the requester\'s own account in `credits` with amount 0, in stage order', async () => {
    const parties = await createParties(2), a = await runAttempt(parties, { tag: 'own-stage' });
    const own = new Map([[parties.stages[0].peerId, parties.requester.peerId]]);
    const r = (await replaySettlement({ records: a.all(), policies: [POLICY], at: a.decidedAt, accountOf: id => own.get(id) ?? id })).reservations[0];
    expect(r.credits).toEqual([{ participantId: parties.stages[0].peerId, amount: 0 }, { participantId: parties.stages[1].peerId, amount: r.debit }]);
  });

  it('gives each distinct pair of contradictory stage receipts one entry, against the earlier receipt it contradicts', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 8 }, (_, i) => ` t${i}`);
    const a = await runAttempt(parties, { tag: 'receipt-pairs', outputs });
    const own = a.all().filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0).sort((x, y) => x.sequence - y.sequence);
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[0], now: () => Date.parse(own[0].signedAt) });
    const resign = (row, change) => signer.sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(row), ...change });
    const conflicts = async extra => (await replay([...a.all(), ...extra], a.decidedAt)).reservations[0].conflicts
      .filter(row => row.kind === 'stage-receipt').map(row => row.sequences);
    const closing = own.at(-1), at = sequence => own.find(row => row.sequence === sequence);
    expect(own.map(row => [row.sequence, row.steps])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 8]]);
    // Two receipts after the close: each is listed against the close.
    expect(await conflicts([await resign(closing, { sequence: 10 }), await resign(closing, { sequence: 11 })])).toEqual([[9, 10], [9, 11]]);
    // A second body at one sequence.
    expect(await conflicts([await resign(at(3), { tokens: { ...at(3).tokens, processed: at(3).tokens.processed + 1 } })])).toEqual([[3, 3]]);
    // Steps that go backwards at 5 and stay below sequence 4's at 6: both are listed against 4.
    const backwards = [await resign(at(5), { steps: 1 }), await resign(at(6), { steps: 2 })];
    const records = [...a.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0 && [5, 6].includes(row.sequence))), ...backwards];
    const r = (await replay(records, a.decidedAt)).reservations[0];
    expect(r.conflicts.filter(row => row.kind === 'stage-receipt').map(row => row.sequences)).toEqual([[4, 5], [4, 6]]);
  });

  it('keeps `closedAtLastStep` on a row a later step decides', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const a = await runAttempt(parties, { tag: 'closed-then-unknown', outputs });
    const records = withoutClosing(a, 0).filter(row => !(row.schema === 'reploid.settlement-acceptance/v1' && row.partitionIndex === 1));
    expect((await replay(records, a.decidedAt)).reservations[0]).toMatchObject({ status: 'unknown', closedAtLastStep: [0] });
  });

  it('lists in `counts` only the outcomes some row has', async () => {
    const parties = await createParties(2), a = await runAttempt(parties, { tag: 'counts' });
    expect((await replay(a.all(), a.decidedAt)).counts).toEqual({ settled: 1 });
  });

  it('decides an unclosed attempt only after deadline + release window + clock allowance', async () => {
    const parties = await createParties(2), outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const lost = await runAttempt(parties, { tag: 'decision-time', outputs, vanishStage: 0, vanishAfterStep: 9 });
    const at = lost.closesAt + POLICY.maxClockSkewMs;
    expect((await replay(lost.all(), at)).reservations[0].status).toBe('open');
    expect((await replay(lost.all(), at + 1)).reservations[0].status).toBe('expired');
  });
});
