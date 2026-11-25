// @vitest-environment node
// Failed stages (docs/settlement-replay.md, "Failed stages"): under the terms
// `reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1` a stage that fails, by its own signed fault
// or by having no closing receipt once the release window has passed, forfeits its own share and nothing else. Each
// attack below is replayed under the earlier terms too, where it took the whole answer for nothing. The records are
// signed here with test keys; this replays no physical trade.
import { describe, expect, it } from 'vitest';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { UNFINISHED_ANSWER_TERMS_V2, UNFINISHED_ANSWER_TERMS_V3 } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { SETTLEMENT_FAULT_SCHEMA, signStageFault, verifySettlementFault } from '../../server/fleet/settlement-terms.js';
import { POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const bodyOf = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };
const replay = async (records, at, accountOf = null) => (await replaySettlement({ records, policies: [POLICY], at, ...(accountOf ? { accountOf } : {}) }));
const row = async (records, at, accountOf = null) => (await replay(records, at, accountOf)).reservations[0];
const amounts = settled => settled.credits.map(credit => credit.amount);
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const signerOf = (identity, at) => createAttemptEvidenceSigner({ identity, now: () => at });
/** Stage `index` signs a fault for attempt `a`, three seconds into it unless another time is given. */
const faultBy = (parties, a, index, at = Date.parse(a.terms.signedAt) + 3000) => signStageFault({ signer: signerOf(parties.stages[index], at), terms: a.terms, partitionIndex: index });
const isReceiptOf = index => record => record.schema === STAGE_RECEIPT_SCHEMA && record.partitionIndex === index;
const isCloseOf = index => record => isReceiptOf(index)(record) && record.timing.closedAt !== null;
const without = (records, test) => records.filter(record => !test(record));
/** Three stages with weights 1, 3 and 2; the middle stage signs nothing after its third step and never closes. */
const middleStageVanishes = (parties, unfinishedTerms) => runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], vanishStage: 1, vanishAfterStep: 2, unfinishedTerms });
/** Requester-held edges: stages 0 and 3 sign the requester's own account, stages 1 and 2 their operators'. */
const EDGES = { requester: 'owner-requester', stages: ['owner-requester', 'owner-a', 'owner-b', 'owner-requester'] };
const edges = (parties, options) => runAttempt(parties, { outputs: SIX, weights: [1, 10, 10, 1], accounts: EDGES, ...options });

describe('a stage fault', () => {
  it('is a signed record of the stage the terms name, and nothing else passes', async () => {
    const parties = await createParties(3);
    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    const fault = await faultBy(parties, a, 1);
    expect(await verifySettlementFault(fault)).toMatchObject({ ok: true });
    expect(bodyOf(fault)).toMatchObject({ schema: SETTLEMENT_FAULT_SCHEMA, reservationId: a.reservationId, attemptId: a.terms.attemptId,
      routeHash: a.terms.routeHash, partitionIndex: 1, participantId: parties.stages[1].peerId });
    // A stage cannot sign a fault for another stage's share.
    await expect(signStageFault({ signer: signerOf(parties.stages[0], Date.now()), terms: a.terms, partitionIndex: 1 })).rejects.toThrow(/own share/);
    // An edited fault fails its signature; one with an extra member is malformed. Both are listed as rejected.
    const out = await replay([...a.all(), { ...fault, partitionIndex: 2 }, { ...fault, cause: 'power' }], a.decidedAt);
    expect(out.rejected.map(entry => entry.problem).sort()).toEqual(['fault_malformed', 'signature_invalid']);
  });
});

describe('an outside stage that fails forfeits its own share and nothing else', () => {
  it('attack: a stage withholds its close. Earlier terms gave the whole answer for nothing; these pay the stages that closed', async () => {
    const parties = await createParties(3);
    // The requester acknowledged 3 outputs: 9 units, shares 1, 4 and 4.
    const before = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V2);
    expect(before.acknowledged).toBe(3);
    const free = await row(before.all(), before.decidedAt);
    expect(free).toMatchObject({ status: 'expired', debit: 0 });
    expect(amounts(free)).toEqual([0, 0, 0]);
    expect(free.forfeited).toBeUndefined();

    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    // Until the release window has passed its close could still arrive.
    expect(await row(a.all(), a.deadline)).toMatchObject({ status: 'open', debit: null, forfeited: [] });
    const settled = await row(a.all(), a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 5, outputs: 3, chargedOutputs: 3, forfeited: [{ partitionIndex: 1, cause: 'no-close' }] });
    expect(amounts(settled)).toEqual([1, 0, 4]);
    expect((await replay(a.all(), a.decidedAt)).balances).toEqual({ [parties.requester.peerId]: -5, [parties.stages[0].peerId]: 1,
      [parties.stages[1].peerId]: 0, [parties.stages[2].peerId]: 4 });
  });

  it('a signed fault settles at once, without waiting out the window', async () => {
    const parties = await createParties(3);
    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    const fault = await faultBy(parties, a, 1);
    const settled = await row([...a.all(), fault], a.deadline);
    expect(settled).toMatchObject({ status: 'settled', debit: 5, forfeited: [{ partitionIndex: 1, cause: 'fault' }] });
    expect(amounts(settled)).toEqual([1, 0, 4]);
    // It closes only its own stage: another stage that has not closed is still waited for, then forfeits too.
    const alsoSilent = without([...a.all(), fault], isCloseOf(2));
    expect(await row(alsoSilent, a.deadline)).toMatchObject({ status: 'open', forfeited: [{ partitionIndex: 1, cause: 'fault' }] });
    const later = await row(alsoSilent, a.decidedAt);
    expect(later).toMatchObject({ status: 'settled', debit: 1, forfeited: [{ partitionIndex: 1, cause: 'fault' }, { partitionIndex: 2, cause: 'no-close' }] });
    expect(amounts(later)).toEqual([1, 0, 0]);
  });

  it('attack: a false fault. It costs its signer its own share and frees nobody else', async () => {
    const parties = await createParties(3);
    // Every stage closed after 3 acknowledged outputs, and stage 1 also signed a fault: it signed both.
    const a = await runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const honest = await row(a.all(), a.deadline);
    expect(honest).toMatchObject({ status: 'settled', debit: 9, forfeited: [] });
    expect(amounts(honest)).toEqual([1, 4, 4]);
    const settled = await row([...a.all(), await faultBy(parties, a, 1)], a.deadline);
    expect(settled).toMatchObject({ status: 'settled', debit: 5, forfeited: [{ partitionIndex: 1, cause: 'fault-and-close' }] });
    expect(amounts(settled)).toEqual([1, 0, 4]);
    expect(settled.conflicts).toEqual([{ signer: parties.stages[1].peerId, kind: 'fault-and-close', blocking: false, partitionIndex: 1 }]);
  });

  it('a late fault, a fault on another route and a fault under earlier terms count for nothing', async () => {
    const parties = await createParties(3);
    const a = await runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const late = await row([...a.all(), await faultBy(parties, a, 1, a.decidedAt)], a.decidedAt);
    expect(late).toMatchObject({ status: 'settled', debit: 9, forfeited: [], late: [{ kind: 'fault', partitionIndex: 1 }] });
    const offRoute = await signerOf(parties.stages[1], Date.parse(a.terms.signedAt) + 3000).sign(SETTLEMENT_FAULT_SCHEMA,
      { ...bodyOf(await faultBy(parties, a, 1)), routeHash: `sha256:${'c'.repeat(64)}` });
    expect(await verifySettlementFault(offRoute)).toMatchObject({ ok: true });
    expect(await row([...a.all(), offRoute], a.decidedAt)).toEqual(await row(a.all(), a.decidedAt));

    const earlier = await runAttempt(parties, { tag: 'r2', outputs: SIX, weights: [1, 3, 2], stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 });
    const withFault = await replay([...earlier.all(), await faultBy(parties, earlier, 1)], earlier.decidedAt);
    expect(withFault.rejected).toEqual([]);
    expect(withFault.reservations).toEqual((await replay(earlier.all(), earlier.decidedAt)).reservations);
    expect(withFault.reservations[0].forfeited).toBeUndefined();
  });

  it('every outside stage failing leaves nothing to pay', async () => {
    const parties = await createParties(3);
    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    const settled = await row(without(without(a.all(), isCloseOf(0)), isCloseOf(2)), a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 0, outputs: 3,
      forfeited: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 1, cause: 'no-close' }, { partitionIndex: 2, cause: 'no-close' }] });
    expect(amounts(settled)).toEqual([0, 0, 0]);
  });

  it('a failed stage that signed fewer steps than were acknowledged is no conflict: its share is not paid whatever it says', async () => {
    const parties = await createParties(3);
    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    // Its receipt for the third step never arrived.
    const records = without(a.all(), record => isReceiptOf(1)(record) && record.steps === 3);
    const settled = await row(records, a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 5, conflicts: [] });
    expect(amounts(settled)).toEqual([1, 0, 4]);
  });

  it('nothing acknowledged and a stage not closed is expired, as an attempt that never started is', async () => {
    const parties = await createParties(3);
    const a = await middleStageVanishes(parties, UNFINISHED_ANSWER_TERMS_V3);
    const never = a.all().filter(record => record.schema !== STAGE_RECEIPT_SCHEMA && record.schema !== OUTPUT_ACKNOWLEDGMENT_SCHEMA);
    expect(await row(never, a.deadline)).toMatchObject({ status: 'open' });
    const expired = await row(never, a.decidedAt);
    expect(expired).toMatchObject({ status: 'expired', debit: 0, outputs: 0 });
    expect(amounts(expired)).toEqual([0, 0, 0]);
  });
});

describe('a delivered answer', () => {
  it('pays the stages that closed when one stage presents no receipt covering it; earlier terms left it undecided', async () => {
    const parties = await createParties(3);
    const uncovered = a => without(a.all(), record => isReceiptOf(1)(record) && record.steps >= 5);
    const before = await runAttempt(parties, { weights: [1, 3, 2], unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 });
    expect(await row(uncovered(before), before.decidedAt)).toMatchObject({ status: 'unknown', debit: null });

    // 5 outputs acknowledged: 15 units, shares 2, 7 and 6.
    const a = await runAttempt(parties, { tag: 'r2', weights: [1, 3, 2], unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    expect(await row(uncovered(a), a.deadline)).toMatchObject({ status: 'open' });
    const settled = await row(uncovered(a), a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 8, outputs: 5, forfeited: [{ partitionIndex: 1, cause: 'no-close' }], closedAtLastStep: [] });
    expect(amounts(settled)).toEqual([2, 0, 6]);
  });

  it('still pays a stage whose receipts cover the whole answer and whose close alone is missing, unless it signed a fault', async () => {
    const parties = await createParties(3);
    const a = await runAttempt(parties, { weights: [1, 3, 2], unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const noClose = without(a.all(), isCloseOf(1));
    const paid = await row(noClose, a.decidedAt);
    expect(paid).toMatchObject({ status: 'settled', debit: 15, closedAtLastStep: [1], forfeited: [] });
    expect(amounts(paid)).toEqual([2, 7, 6]);
    const faulted = await row([...noClose, await faultBy(parties, a, 1)], a.deadline);
    expect(faulted).toMatchObject({ status: 'settled', debit: 8, closedAtLastStep: [], forfeited: [{ partitionIndex: 1, cause: 'fault' }] });
    expect(amounts(faulted)).toEqual([2, 0, 6]);
  });
});

describe('a stage on the requester\'s own account never gives relief', () => {
  it('attack: the requester withholds its own edge stage\'s close. Earlier terms made the answer free; these pay both operators in full', async () => {
    const parties = await createParties(4);
    // 3 outputs acknowledged: 9 units, shares 0, 4, 4 and 1; the requester's own shares are neither charged nor paid.
    const before = await edges(parties, { vanishStage: 3, vanishAfterStep: 2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 });
    const free = await row(before.all(), before.decidedAt);
    expect(free).toMatchObject({ status: 'expired', debit: 0 });
    expect(amounts(free)).toEqual([0, 0, 0, 0]);

    const a = await edges(parties, { tag: 'r2', vanishStage: 3, vanishAfterStep: 2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const settled = await row(a.all(), a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 8, outputs: 3, forfeited: [{ partitionIndex: 3, cause: 'no-close' }] });
    expect(amounts(settled)).toEqual([0, 4, 4, 0]);
    expect((await replay(a.all(), a.decidedAt)).balances).toEqual({ 'owner-a': 4, 'owner-b': 4, 'owner-requester': -8 });
  });

  it('attack: the requester\'s own stage signs a fault. Both operators are still paid in full', async () => {
    const parties = await createParties(4);
    const a = await edges(parties, { vanishStage: 0, vanishAfterStep: 2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const settled = await row([...a.all(), await faultBy(parties, a, 0)], a.deadline);
    expect(settled).toMatchObject({ status: 'settled', debit: 8, forfeited: [{ partitionIndex: 0, cause: 'fault' }] });
    expect(amounts(settled)).toEqual([0, 4, 4, 0]);
  });

  it('attack: an operator colludes with the requester and withholds its close. Only that operator goes unpaid', async () => {
    const parties = await createParties(4);
    const a = await edges(parties, { vanishStage: 1, vanishAfterStep: 2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const settled = await row(a.all(), a.decidedAt);
    expect(settled).toMatchObject({ status: 'settled', debit: 4, forfeited: [{ partitionIndex: 1, cause: 'no-close' }] });
    expect(amounts(settled)).toEqual([0, 0, 4, 0]);
  });
});

describe('what these terms do not stop', () => {
  it('a requester whose own final stage presents no receipt at all: no chain is committed, so nothing is acknowledged or charged', async () => {
    const parties = await createParties(4);
    const a = await edges(parties, { vanishStage: 3, vanishAfterStep: 2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    const hidden = await row(without(a.all(), isReceiptOf(3)), a.decidedAt);
    expect(hidden).toMatchObject({ status: 'expired', debit: 0, outputs: 0 });
    expect(amounts(hidden)).toEqual([0, 0, 0, 0]);
  });

  it('a requester whose own stage signs two receipts at one sequence: the attempt is a conflict and moves nothing', async () => {
    const parties = await createParties(4);
    const a = await edges(parties, { unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    expect(await row(a.all(), a.decidedAt)).toMatchObject({ status: 'settled', debit: 16 });
    const first = a.all().find(record => isReceiptOf(0)(record) && record.sequence === 1);
    const second = await signerOf(parties.stages[0], Date.parse(first.signedAt) + 1).sign(STAGE_RECEIPT_SCHEMA,
      { ...bodyOf(first), signedAt: new Date(Date.parse(first.signedAt) + 1).toISOString() });
    expect(await row([...a.all(), second], a.decidedAt)).toMatchObject({ status: 'conflict', debit: null,
      conflicts: [{ signer: parties.stages[0].peerId, kind: 'stage-receipt', blocking: true, partitionIndex: 0, sequences: [1, 1] }] });
  });
});
