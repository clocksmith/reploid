// @vitest-environment node
// The live ledger under the failed-stage rules (reploid.settlement-replay/v3). Most cases use requester-held edges: the
// first and the last stage run on the requester's own account and two outside operators run the middle. Nothing a
// stage on the requester's own account signs or withholds may reduce what the outside stages are paid, and an outside
// stage that fails forfeits only its own share (docs/settlement-replay.md, "Failed stages"). The last block replays
// every attack of that section's table against the live ledger. Every case drives a real ledger (server/fleet/credits.js) through its
// public interface and compares what it posts with the settlement replay over the same signed records. The records
// are signed here with test keys; this is no physical trade.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { FORFEIT_REASON, SETTLEMENT_RULES, UNFINISHED_ANSWER_TERMS_V3 } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { signStageFault } from '../../server/fleet/settlement-terms.js';
import { FLEET_SERVICE_REQUEST_SCHEMA } from '../../server/fleet/contract.js';
import { signAsParticipant } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { POLICY as SCENARIO_POLICY, T0, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

// The ledger's deadline is the signed one (30 s), and a stage may sit on the requester's account.
const POLICY = Object.freeze({ ...SCENARIO_POLICY, version: 'settlement-own-stage-ledger', maxRequestMs: 30000, allowSameOwner: true });
const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const FAKE_CHAIN = `sha256:${'e'.repeat(64)}`;
const bodyOf = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };
const signerOf = (identity, at) => createAttemptEvidenceSigner({ identity, now: () => at });
const isAck = record => record.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA;
const isReceiptOf = index => record => record.schema === STAGE_RECEIPT_SCHEMA && record.partitionIndex === index;
const receiptsOf = (records, index) => records.filter(isReceiptOf(index)).sort((a, b) => a.sequence - b.sequence);
const closeOf = (records, index) => receiptsOf(records, index).find(row => row.status !== 'executing');
const ackOf = (records, count) => records.find(record => isAck(record) && record.count === count);
const amounts = (outcome, a) => a.terms.shares.map(share => (outcome.credits ?? []).filter(row => row.participantId === share.participantId).reduce((sum, row) => sum + row.amount, 0));

const opened = [];
afterEach(async () => { for (const { ledger, directory } of opened.splice(0)) { try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } } });

/** A live ledger. `owners[i]` is the owner account of stage i; the requester's account is `owner-requester`. */
async function open(parties, owners) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-own-stage-ledger-'));
  const computers = [parties.requester, ...parties.stages].map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`,
    ownerId: index === 0 ? 'owner-requester' : owners[index - 1], providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
  const live = { clock: T0, owners: [...new Set(computers.map(row => row.ownerId))] };
  live.ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => live.clock });
  opened.push({ ledger: live.ledger, directory });
  live.decidedAt = T0 + POLICY.maxRequestMs + POLICY.partitionUnclaimedReleaseMs + POLICY.maxClockSkewMs + 1;
  /** `tokens[i]`, when given, admits stage i under that stage-owner process token (stage-owner.js), so it can claim. */
  live.admit = (a, tokens = {}) => {
    live.clock = T0;
    const binding = live.ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
      providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
      inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
    expect(binding).toMatchObject({ settlementRules: SETTLEMENT_RULES, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    live.ledger.dispatch(a.reservationId, parties.requester.peerId);
    a.identity.route.stages.forEach((_, index) => live.ledger.admit(a.reservationId, index, tokens[index] ?? null));
  };
  live.collect = (a, evidence, at = Date.parse(a.terms.notBefore) + 25000) => { live.clock = at; return live.ledger.collect(a.reservationId, { identity: a.identity, receipts: [], ...evidence }); };
  /** As a stage host does when it closes: the stage hands in its own closing receipt. */
  live.close = (a, records, index) => live.collect(a, { receipts: [closeOf(records, index)] });
  /** As the live requester does: each acknowledgment with the receipt it acknowledged, then a fence. */
  live.acknowledgments = async (a, records) => {
    for (const acknowledgment of records.filter(record => isAck(record) && record.count > 0).sort((x, y) => x.count - y.count)) {
      const acknowledgedReceipt = records.find(record => isReceiptOf(a.terms.shares.length - 1)(record) && record.output?.count === acknowledgment.count
        && record.output.chain === acknowledgment.chain);
      await live.collect(a, { acknowledgment, acknowledgedReceipt });
    }
  };
  live.fence = a => live.ledger.fence(a.reservationId, parties.requester.peerId);
  live.acknowledge = async (a, records) => { await live.acknowledgments(a, records); return live.fence(a); };
  live.decide = a => { live.clock = live.decidedAt; return live.ledger.recover(a.reservationId); };
  live.replay = async (records, at = live.decidedAt) => (await replaySettlement({ records, policies: [POLICY], at, accountOf: id => accountOf.get(id) })).reservations[0];
  live.balances = () => Object.fromEntries(live.ledger.snapshot().accounts.map(row => [row.id, row.balance]));
  /** Every owner's statement of this ledger verifies offline, and no hold is left. */
  live.statementsVerify = async () => {
    for (const owner of live.owners) {
      const statement = live.ledger.statement(owner), verdict = await verifyCreditStatement(statement);
      expect(verdict, JSON.stringify(verdict.unchecked)).toMatchObject({ ok: true, uncheckedCount: 0, balanceMatches: true });
      expect(statement.held).toBe(0);
    }
  };
  return live;
}

/** Requester-held edges: stages 0 and 3 on the requester's account, operators at 1 and 2; weights 1, 10, 10 and 1. */
const EDGE_OWNERS = ['owner-requester', 'owner-a', 'owner-b', 'owner-requester'];
const edges = (parties, options = {}) => runAttempt(parties, { outputs: SIX, weights: [1, 10, 10, 1], policy: POLICY, ...options });
const sameAsReplay = (outcome, row, a) => {
  expect(row.status).toBe('settled');
  expect(outcome.charge).toBe(row.debit);
  expect(amounts(outcome, a)).toEqual(row.credits.map(credit => credit.amount));
};

describe('the requester\'s own final stage keeps back every receipt (T1)', () => {
  it('charges the requester\'s own signed acknowledgments, handed in by an outside stage, and pays the outside stages', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    // The requester hands the ledger nothing: no acknowledgment, no receipt of either of its own stages. The two
    // operators closed and hand in their own closing receipts; one also hands in the requester's signed
    // acknowledgment it holds, without the final-stage receipt it acknowledged (it has none to hand in).
    await live.close(a, all, 1);
    await live.close(a, all, 2);
    const held = a.held.stages[1].filter(isAck).sort((x, y) => x.count - y.count).at(-1);
    expect(held.count).toBe(6);
    expect(await live.collect(a, { acknowledgment: held })).toMatchObject({ status: 'pending' });
    // Its own stages have neither closed nor been claimed, so the request is decided once the window has passed.
    live.clock = live.decidedAt - 1;
    expect(await live.ledger.recover(a.reservationId)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: 6, awaitingStages: [0, 3] });
    const outcome = await live.decide(a);
    // 6 outputs at 3 credits: 18 units over 1, 10, 10 and 1 are 0, 8, 8 and 2; the requester's own shares are not charged.
    expect(outcome).toMatchObject({ charge: 16, ownComputeUnits: 2, outputTokens: 6, reason: 'failed-stage-forfeits-own-share',
      forfeitedStages: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 3, cause: 'no-close' }] });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    expect(live.balances()).toEqual({ 'owner-a': 8, 'owner-b': 8, 'owner-requester': -16 });
    // The replay over the records the ledger was given: the operators' receipts and the acknowledgments one of them holds.
    const presented = all.filter(record => !isReceiptOf(0)(record) && !isReceiptOf(3)(record));
    const row = await live.replay(presented);
    expect(row).toMatchObject({ debit: 16, outputs: 6, chargedOutputs: 6, forfeited: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 3, cause: 'no-close' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
    // Presented again, the evidence it settled on changes nothing.
    const journal = live.ledger.snapshot().journal.length;
    expect(await live.ledger.settle(a.reservationId, live.ledger.request(a.reservationId).evidence)).toEqual(outcome);
    expect(live.ledger.snapshot().journal).toHaveLength(journal);
  });

  it('still verifies every acknowledgment against the requester\'s enrolled key and this request', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), other = await edges(parties, { tag: 'other' }), all = [...new Set(a.all())];
    live.admit(a);
    const real = ackOf(all, 6);
    // Signed by an operator's key under the requester's name, edited, or taken from another reservation: all refused.
    const forged = await signerOf(parties.stages[1], Date.parse(real.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, bodyOf(real));
    await expect(live.collect(a, { acknowledgment: forged })).rejects.toThrow('Matching requester acknowledgment required');
    await expect(live.collect(a, { acknowledgment: { ...real, count: 60 } })).rejects.toThrow('Matching requester acknowledgment required');
    await expect(live.collect(a, { acknowledgment: ackOf(other.all(), 6) })).rejects.toThrow('Matching requester acknowledgment required');
    // An acknowledgment signed after the deadline (plus the clock allowance) is never charged, whoever hands it in.
    const late = await signerOf(parties.requester, T0 + 40000).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(real), signedAt: new Date(T0 + 40000).toISOString() });
    await live.collect(a, { acknowledgment: late }, T0 + 41000);
    expect(await live.ledger.recover(a.reservationId)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: null });
    // A receipt handed in with the acknowledgment must still be the final stage's and carry its count and chain.
    await expect(live.collect(a, { acknowledgment: real, acknowledgedReceipt: receiptsOf(all, 3).find(row => row.output.count === 5) })).rejects.toThrow('Acknowledged output prefix differs');
  });

  it('leaves nothing acknowledged when an outside final stage keeps back its receipts: only the requester\'s own final stage is trusted with the count', async () => {
    const parties = await createParties(3), live = await open(parties, ['owner-a', 'owner-b', 'owner-c']);
    const a = await runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], policy: POLICY }), all = [...new Set(a.all())];
    live.admit(a);
    await live.close(a, all, 0);
    await live.close(a, all, 1);
    await expect(live.collect(a, { acknowledgment: ackOf(all, 6) })).rejects.toThrow('Acknowledgment needs its signed output prefix');
    const outcome = await live.decide(a);
    expect(outcome).toMatchObject({ status: 'expired', charge: 0, credits: [] });
    expect(await live.replay(all.filter(record => !isReceiptOf(2)(record)))).toMatchObject({ status: 'expired', debit: 0, outputs: 0 });
  });
});

describe('the requester\'s own stage contradicts itself (T2)', () => {
  /** A second, different receipt at the sequence of `first`: signed a millisecond later, and with `changes` when given. */
  const twinOf = (parties, index, first, changes = {}) => signerOf(parties.stages[index], Date.parse(first.signedAt) + 1).sign(STAGE_RECEIPT_SCHEMA,
    { ...bodyOf(first), signedAt: new Date(Date.parse(first.signedAt) + 1).toISOString(), ...changes });
  /** The same receipt reporting one more processed token: a difference in what the stage says it did. */
  const recount = receipt => ({ tokens: { ...receipt.tokens, processed: receipt.tokens.processed + 1 } });

  it('two different receipts at one sequence: the ledger keeps one receipt per stage, blocks nothing and pays the outside stages in full', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    const own = receiptsOf(all, 0), third = own.find(row => row.sequence === 3);
    // What the ledger does with a contradiction: it keeps only a stage's latest receipt. A second receipt at the
    // sequence it holds replaces a step receipt without complaint; one at an earlier sequence is ignored.
    await live.collect(a, { receipts: [third] });
    await live.collect(a, { receipts: [await twinOf(parties, 0, third)] });
    await live.collect(a, { receipts: [await twinOf(parties, 0, own[0])] });
    for (const index of [0, 1, 2, 3]) await live.close(a, all, index);
    // After the stage's close, a receipt at that sequence that says something else is refused, and what the ledger
    // holds is unchanged. One that differs only in its signing time is taken as the same close.
    await expect(live.collect(a, { receipts: [await twinOf(parties, 0, closeOf(all, 0), recount(closeOf(all, 0)))] })).rejects.toThrow('Conflicting stage closure');
    expect(await live.collect(a, { receipts: [await twinOf(parties, 0, closeOf(all, 0))] })).toMatchObject({ status: 'pending' });
    const outcome = await live.acknowledge(a, all);
    // 18 units: the operators get 8 and 8, and the requester is charged exactly that.
    expect(outcome).toMatchObject({ charge: 16, outputTokens: 6 });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    expect(outcome.forfeitedStages).toBeUndefined();
    // The replay, which is handed both receipts, fails the stage for its contradiction and pays the same amounts.
    const row = await live.replay([...all, await twinOf(parties, 0, own[0])], Date.parse(a.terms.deadline));
    expect(row).toMatchObject({ debit: 16, forfeited: [{ partitionIndex: 0, cause: 'contradiction' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('the same from its own final stage, and steps that go backwards: nothing is blocked and the outside stages are paid in full', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    // Its own first stage hands in a receipt with fewer steps than an earlier one, and then no close at all.
    const own = receiptsOf(all, 0);
    await live.collect(a, { receipts: [own.find(row => row.sequence === 4)] });
    const backwards = await signerOf(parties.stages[0], Date.parse(own[4].signedAt)).sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(own[4]), steps: 1 });
    expect(await live.collect(a, { receipts: [backwards] })).toMatchObject({ status: 'pending' });
    // Its own final stage hands in a second receipt at the sequence of its close.
    for (const index of [1, 2, 3]) await live.close(a, all, index);
    await expect(live.collect(a, { receipts: [await twinOf(parties, 3, closeOf(all, 3), recount(closeOf(all, 3)))] })).rejects.toThrow('Conflicting stage closure');
    expect(await live.acknowledge(a, all)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: 6, awaitingStages: [0] });
    const outcome = await live.decide(a);
    expect(outcome).toMatchObject({ charge: 16, outputTokens: 6, forfeitedStages: [{ partitionIndex: 0, cause: 'no-close' }] });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    const presented = [...all.filter(record => !(isReceiptOf(0)(record) && record.sequence >= 5)), backwards];
    const row = await live.replay(presented);
    expect(row).toMatchObject({ debit: 16, forfeited: [{ partitionIndex: 0, cause: 'contradiction' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('two receipts from its own final stage at its last sequence: an outside stage that never closed forfeits, as in the replay (Deco #109)', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    // Operator 1 closes. Operator 2 hands in only its last step receipt, which covers the whole answer, and never closes.
    // The requester's own final stage hands in its last step receipt and then a second, different one at that sequence.
    await live.close(a, all, 1);
    const lastStep = index => receiptsOf(all, index).filter(row => row.status === 'executing').at(-1);
    await live.collect(a, { receipts: [lastStep(2)] });
    const finalStep = lastStep(3), twin = await twinOf(parties, 3, finalStep, recount(finalStep));
    await live.collect(a, { receipts: [finalStep] });
    await live.collect(a, { receipts: [twin] });
    await live.acknowledgments(a, all);
    live.fence(a);
    const outcome = await live.decide(a);
    // The replay over the same records: its own final stage contradicted itself at the sequence that would show the
    // answer was delivered, so no stage is treated as closed at its last step and operator 2 forfeits.
    const presented = [...all.filter(record => !isReceiptOf(0)(record) && !(isReceiptOf(2)(record) && record.status !== 'executing')
      && !(isReceiptOf(3)(record) && record.status !== 'executing')), twin];
    const row = await live.replay(presented);
    expect(row).toMatchObject({ forfeited: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 2, cause: 'no-close' },
      { partitionIndex: 3, cause: 'contradiction' }] });
    expect(outcome.forfeitedStages.map(item => item.partitionIndex)).toEqual([0, 2, 3]);
    expect(amounts(outcome, a)).toEqual([0, 8, 0, 0]);
    sameAsReplay(outcome, row, a);
    // Presented again, the evidence it settled on (which carries the second receipt) verifies and changes nothing.
    expect(await live.ledger.settle(a.reservationId, live.ledger.request(a.reservationId).evidence)).toEqual(outcome);
    await live.statementsVerify();
  });

  it('its own final stage\'s close signed twice: the ledger keeps the replaced close as evidence and forfeits the unclosed outside stage', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    await live.close(a, all, 1);
    await live.collect(a, { receipts: [receiptsOf(all, 2).filter(row => row.status === 'executing').at(-1)] });
    // The same close signed a millisecond later: the ledger takes it as the same close and holds only one of the two.
    await live.close(a, all, 3);
    const twin = await twinOf(parties, 3, closeOf(all, 3));
    expect(await live.collect(a, { receipts: [twin] })).toMatchObject({ status: 'pending' });
    await live.acknowledgments(a, all);
    live.fence(a);
    const outcome = await live.decide(a);
    const presented = [...all.filter(record => !isReceiptOf(0)(record) && !(isReceiptOf(2)(record) && record.status !== 'executing')), twin];
    const row = await live.replay(presented);
    expect(row.forfeited.map(item => item.partitionIndex)).toEqual([0, 2, 3]);
    expect(outcome.forfeitedStages.map(item => item.partitionIndex)).toEqual([0, 2, 3]);
    expect(live.ledger.request(a.reservationId).evidence.finalStageTwin).toBeDefined();
    sameAsReplay(outcome, row, a);
    expect(await live.ledger.settle(a.reservationId, live.ledger.request(a.reservationId).evidence)).toEqual(outcome);
    await live.statementsVerify();
  });

  it('an outside stage\'s second receipt is refused the same way, and its own close still settles the request', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    for (const index of [0, 1, 2, 3]) await live.close(a, all, index);
    await expect(live.collect(a, { receipts: [await twinOf(parties, 1, closeOf(all, 1), recount(closeOf(all, 1)))] })).rejects.toThrow('Conflicting stage closure');
    const outcome = await live.acknowledge(a, all);
    expect(outcome).toMatchObject({ charge: 16, outputTokens: 6 });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    // The replay, handed both of the outside stage's receipts, calls the attempt a conflict and moves nothing: the
    // ledger never holds two receipts of one stage, so it does not see what the replay sees here.
    expect(await live.replay([...all, await twinOf(parties, 1, closeOf(all, 1), recount(closeOf(all, 1)))])).toMatchObject({ status: 'conflict', debit: null });
  });
});

describe('the requester\'s own first stage closes behind the acknowledged output (T3)', () => {
  it('does not test its steps: the outside stages are paid in full', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    // Its first stage signs a close with 2 steps; the requester acknowledged 6 outputs.
    const close = closeOf(all, 0);
    const shortClose = await signerOf(parties.stages[0], Date.parse(close.signedAt)).sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(close), sequence: 3, steps: 2 });
    await live.collect(a, { receipts: [shortClose] });
    for (const index of [1, 2, 3]) await live.close(a, all, index);
    const outcome = await live.acknowledge(a, all);
    expect(outcome).toMatchObject({ charge: 16, ownComputeUnits: 2, outputTokens: 6 });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    const row = await live.replay([...all.filter(record => !(isReceiptOf(0)(record) && record.sequence >= 3)), shortClose]);
    expect(row).toMatchObject({ debit: 16, outputs: 6, conflicts: [] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('still refuses to pay an outside stage that closed behind the acknowledged output, with an outside final stage', async () => {
    const parties = await createParties(3), live = await open(parties, ['owner-a', 'owner-b', 'owner-c']);
    const a = await runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], policy: POLICY }), all = [...new Set(a.all())];
    live.admit(a);
    const close = closeOf(all, 0);
    const shortClose = await signerOf(parties.stages[0], Date.parse(close.signedAt)).sign(STAGE_RECEIPT_SCHEMA, { ...bodyOf(close), sequence: 3, steps: 2 });
    await live.collect(a, { receipts: [shortClose] });
    for (const index of [1, 2]) await live.close(a, all, index);
    expect(await live.acknowledge(a, all)).toMatchObject({ status: 'pending', awaitingStages: [0] });
    // The replay calls it a conflict and moves nothing; the ledger releases the hold with nobody charged or paid.
    expect(await live.decide(a)).toMatchObject({ status: 'expired', charge: 0, credits: [] });
    expect(await live.replay([...all.filter(record => !(isReceiptOf(0)(record) && record.sequence >= 3)), shortClose])).toMatchObject({ status: 'conflict', debit: null });
  });
});

describe('the requester acknowledges more than the outside stages signed for (T4)', () => {
  it('charges up to the fewest steps a paid outside stage signed, and refuses nothing', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a);
    for (const index of [0, 1, 2, 3]) await live.close(a, all, index);
    await live.acknowledgments(a, all);
    // Its own final stage: the requester signs an acknowledgment of 50 outputs with a chain nobody committed.
    const last = ackOf(all, 6);
    const inflated = await signerOf(parties.requester, Date.parse(last.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(last), count: 50, chain: FAKE_CHAIN });
    expect(await live.collect(a, { acknowledgment: inflated })).toMatchObject({ status: 'pending' });
    const outcome = await live.fence(a);
    // The operators signed 6 steps each: 6 outputs are charged, and the other 44 are recorded and never charged.
    expect(outcome).toMatchObject({ charge: 16, outputTokens: 6, beyondStageSteps: 44 });
    expect(outcome.beyondCeiling).toBeUndefined();
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    const row = await live.replay([...all, inflated]);
    expect(row).toMatchObject({ debit: 16, outputs: 50, chargedOutputs: 6, conflicts: [], unmatched: [], forfeited: [] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('stops at the outside stage that signed the fewest steps, and at the signed ceiling', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    // The operators stop after 3 steps (they close as failed); the requester's own final stage and its acknowledgments go on to say 5.
    const a = await edges(parties, { stagesFailAfter: 3 }), all = [...new Set(a.all())];
    live.admit(a);
    for (const index of [0, 1, 2, 3]) await live.close(a, all, index);
    const last = ackOf(all, 3);
    const more = await signerOf(parties.requester, Date.parse(last.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(last), count: 5, chain: FAKE_CHAIN });
    await live.acknowledgments(a, all);
    await live.collect(a, { acknowledgment: more });
    const outcome = await live.fence(a);
    // 3 outputs: 9 units over 1, 10, 10 and 1 are 0, 4, 4 and 1.
    expect(outcome).toMatchObject({ charge: 8, outputTokens: 3, beyondStageSteps: 2 });
    expect(amounts(outcome, a)).toEqual([0, 4, 4, 0]);
    sameAsReplay(outcome, await live.replay([...all, more]), a);
  });
});

describe('an acknowledgment whose chain differs from an outside final stage\'s (T5)', () => {
  it('is refused wherever it is handed in, is not charged, and blocks nothing: the highest agreeing count is charged', async () => {
    const parties = await createParties(3), live = await open(parties, ['owner-a', 'owner-b', 'owner-c']);
    const a = await runAttempt(parties, { weights: [1, 3, 2], policy: POLICY }), all = [...new Set(a.all())];
    live.admit(a);
    const last = ackOf(all, 5), agreed = all.filter(record => !(isAck(record) && record.count === 5));
    const disputed = await signerOf(parties.requester, Date.parse(last.signedAt)).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { ...bodyOf(last), chain: FAKE_CHAIN });
    for (const index of [0, 1, 2]) await live.close(a, all, index);
    // What the ledger does with it: it is refused with the receipt it claims to acknowledge, refused alone, and
    // refused as settlement evidence. The acknowledgments already held stay as they are.
    const finalReceipt = receiptsOf(all, 2).find(row => row.output.count === 5 && row.status === 'executing');
    await expect(live.collect(a, { acknowledgment: disputed, acknowledgedReceipt: finalReceipt })).rejects.toThrow('Acknowledged output prefix differs');
    await expect(live.collect(a, { acknowledgment: disputed })).rejects.toThrow('Acknowledgment needs its signed output prefix');
    live.clock = Date.parse(a.terms.notBefore) + 25000;
    await expect(live.ledger.settle(a.reservationId, { identity: a.identity, receipts: [0, 1, 2].map(index => closeOf(all, index)), acknowledgment: disputed }))
      .rejects.toThrow('Final output differs from requester acknowledgment');
    const outcome = await live.acknowledge(a, agreed);
    // 4 outputs with agreed chains: 12 units over 1, 3 and 2 are 2, 6 and 4.
    expect(outcome).toMatchObject({ charge: 12, outputTokens: 4 });
    expect(amounts(outcome, a)).toEqual([2, 6, 4]);
    const row = await live.replay([...agreed, disputed]);
    expect(row).toMatchObject({ debit: 12, outputs: 4, chargedOutputs: 4 });
    expect(row.conflicts).toEqual([{ signer: null, signers: [parties.stages[2].peerId, parties.requester.peerId], kind: 'output-chain', blocking: false, count: 5 }]);
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });
});

/** A stage-owner process token, as stage-owner.js journals one per admitted stage. */
const TOKEN = 'f'.repeat(64);
/**
 * Stage `index`'s owner reports its process gone, as stage-owner.js does after a restart: an interruption claim signed
 * by the stage's enrolled key, carrying its last signed step and its own signed fault for this attempt.
 */
async function claimFault(live, parties, a, records, index, at = Date.parse(a.terms.signedAt) + 3000, faultAt = at) {
  live.clock = at;
  const fault = await signStageFault({ signer: signerOf(parties.stages[index], faultAt), terms: a.terms, partitionIndex: index });
  const receipt = receiptsOf(records, index).filter(row => row.status === 'executing').at(-1) ?? null;
  const body = { schema: FLEET_SERVICE_REQUEST_SCHEMA, participantId: parties.stages[index].peerId, operation: 'closeStageOwner',
    payload: { id: a.reservationId, partitionIndex: index, owner: TOKEN, receipt, fault }, at, nonce: `fault-${index}` };
  const reply = await live.ledger.closeStageOwner({ ...body, signature: await signAsParticipant(parties.stages[index], FLEET_SERVICE_REQUEST_SCHEMA, body) });
  expect(reply.stageOwner).toBe('closed');
  return { fault, outcome: reply.outcome };
}
const OUTSIDE = ['owner-a', 'owner-b', 'owner-c'];
/** Three outside stages with weights 1, 3 and 2 over six outputs: 18 units, shares 3, 9 and 6. */
const threeOutside = (parties, options = {}) => runAttempt(parties, { outputs: SIX, weights: [1, 3, 2], policy: POLICY, ...options });
const closesBeforeWindow = (live, outcome) => expect(outcome.settledAt).toBeLessThan(live.decidedAt);

describe('every attack of the failed-stage rules, in the live ledger', () => {
  it('a colluding outside stage withholds its close: only that stage goes unpaid, and the requester pays the others', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    // Operator 1 stops signing after its third step and never closes, whether it failed or agreed with the requester.
    const a = await edges(parties, { vanishStage: 1, vanishAfterStep: 2 }), all = [...new Set(a.all())];
    live.admit(a);
    for (const index of [0, 2, 3]) await live.close(a, all, index);
    expect(await live.acknowledge(a, all)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: 3, awaitingStages: [1] });
    live.clock = live.decidedAt - 1;
    expect(await live.ledger.recover(a.reservationId)).toMatchObject({ status: 'pending', awaitingStages: [1] });
    const outcome = await live.decide(a);
    // 3 outputs at 3 credits: 9 units over 1, 10, 10 and 1 are 0, 4, 4 and 1; operator 1 forfeits its 4.
    expect(outcome).toMatchObject({ charge: 4, outputTokens: 3, reason: FORFEIT_REASON, forfeitedStages: [{ partitionIndex: 1, cause: 'no-close' }] });
    expect(amounts(outcome, a)).toEqual([0, 0, 4, 0]);
    expect(live.balances()).toEqual({ 'owner-a': 0, 'owner-b': 4, 'owner-requester': -4 });
    const row = await live.replay(all);
    expect(row).toMatchObject({ debit: 4, forfeited: [{ partitionIndex: 1, cause: 'no-close' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('the requester withholds its own edge stages\' closes: both operators are paid in full', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    // The requester's own final stage stops after its third step; its own first stage never hands in its close either.
    const a = await edges(parties, { vanishStage: 3, vanishAfterStep: 2 }), all = [...new Set(a.all())];
    live.admit(a);
    for (const index of [1, 2]) await live.close(a, all, index);
    expect(await live.acknowledge(a, all)).toMatchObject({ status: 'pending', acknowledgedOutputTokens: 3, awaitingStages: [0, 3] });
    const outcome = await live.decide(a);
    expect(outcome).toMatchObject({ charge: 8, outputTokens: 3, forfeitedStages: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 3, cause: 'no-close' }] });
    expect(amounts(outcome, a)).toEqual([0, 4, 4, 0]);
    expect(live.balances()).toEqual({ 'owner-a': 4, 'owner-b': 4, 'owner-requester': -8 });
    const presented = all.filter(record => !(isReceiptOf(0)(record) && record.status !== 'executing'));
    const row = await live.replay(presented);
    expect(row).toMatchObject({ debit: 8, forfeited: [{ partitionIndex: 0, cause: 'no-close' }, { partitionIndex: 3, cause: 'no-close' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('a signed false fault: a stage that did all its work claims it failed. It loses its own share and nobody else\'s amount changes', async () => {
    const parties = await createParties(3), live = await open(parties, OUTSIDE);
    const a = await threeOutside(parties), all = [...new Set(a.all())];
    const honest = await live.replay(all);
    expect(honest).toMatchObject({ status: 'settled', debit: 18 });
    expect(honest.credits.map(row => row.amount)).toEqual([3, 9, 6]);
    live.admit(a, { 1: TOKEN });
    // Stage 1's receipts cover the whole delivered answer, which alone would get it paid without a close; its fault
    // forfeits it. The others closed, so the request settles at once, without waiting out the window.
    for (const index of [0, 2]) await live.close(a, all, index);
    await live.acknowledgments(a, all);
    const { fault } = await claimFault(live, parties, a, all, 1);
    const outcome = await live.fence(a);
    expect(outcome).toMatchObject({ charge: 9, outputTokens: 6, reason: FORFEIT_REASON, forfeitedStages: [{ partitionIndex: 1, cause: 'fault' }] });
    expect(amounts(outcome, a)).toEqual([3, 0, 6]);
    closesBeforeWindow(live, outcome);
    const presented = [...all.filter(record => !(isReceiptOf(1)(record) && record.status !== 'executing')), fault];
    const row = await live.replay(presented, Date.parse(a.terms.deadline));
    expect(row).toMatchObject({ status: 'settled', debit: 9, forfeited: [{ partitionIndex: 1, cause: 'fault' }], closedAtLastStep: [] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('a double-signer: a stage signs a fault and a closing receipt for one attempt. It gets zero and is listed', async () => {
    const parties = await createParties(3), live = await open(parties, OUTSIDE);
    const a = await threeOutside(parties), all = [...new Set(a.all())];
    live.admit(a, { 1: TOKEN });
    await live.acknowledgments(a, all);
    const { fault } = await claimFault(live, parties, a, all, 1);
    // The same stage then hands in its closing receipt: the claim stands and the close earns it nothing.
    await live.close(a, all, 1);
    for (const index of [0, 2]) await live.close(a, all, index);
    const outcome = await live.fence(a);
    expect(outcome).toMatchObject({ charge: 9, reason: FORFEIT_REASON, forfeitedStages: [{ partitionIndex: 1, cause: 'fault-and-close' }] });
    expect(amounts(outcome, a)).toEqual([3, 0, 6]);
    const row = await live.replay([...all, fault], Date.parse(a.terms.deadline));
    expect(row).toMatchObject({ status: 'settled', debit: 9, forfeited: [{ partitionIndex: 1, cause: 'fault-and-close' }] });
    expect(row.conflicts).toEqual([{ signer: parties.stages[1].peerId, kind: 'fault-and-close', blocking: false, partitionIndex: 1 }]);
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('the requester\'s own stage signs a fault: both operators are still paid in full', async () => {
    const parties = await createParties(4), live = await open(parties, EDGE_OWNERS);
    const a = await edges(parties), all = [...new Set(a.all())];
    live.admit(a, { 0: TOKEN });
    for (const index of [1, 2, 3]) await live.close(a, all, index);
    await live.acknowledgments(a, all);
    const { fault } = await claimFault(live, parties, a, all, 0);
    const outcome = await live.fence(a);
    expect(outcome).toMatchObject({ charge: 16, outputTokens: 6, forfeitedStages: [{ partitionIndex: 0, cause: 'fault' }] });
    expect(amounts(outcome, a)).toEqual([0, 8, 8, 0]);
    const presented = [...all.filter(record => !(isReceiptOf(0)(record) && record.status !== 'executing')), fault];
    const row = await live.replay(presented, Date.parse(a.terms.deadline));
    expect(row).toMatchObject({ debit: 16, forfeited: [{ partitionIndex: 0, cause: 'fault' }] });
    sameAsReplay(outcome, row, a);
    await live.statementsVerify();
  });

  it('a fault dated after the release window is refused while the request is open, and the stage is decided like any that did not close', async () => {
    const parties = await createParties(3), live = await open(parties, OUTSIDE);
    const a = await threeOutside(parties, { vanishStage: 1, vanishAfterStep: 2 }), all = [...new Set(a.all())];
    live.admit(a, { 1: TOKEN });
    for (const index of [0, 2]) await live.close(a, all, index);
    await live.acknowledge(a, all);
    // The last instant before the ledger decides, with a fault dated just past the window (inside the clock allowance).
    await expect(claimFault(live, parties, a, all, 1, live.decidedAt - 1, live.decidedAt + 1)).rejects.toThrow('Stage fault is signed after the release window');
    const late = await signStageFault({ signer: signerOf(parties.stages[1], live.decidedAt + 1), terms: a.terms, partitionIndex: 1 });
    const outcome = await live.decide(a);
    expect(outcome).toMatchObject({ charge: 5, forfeitedStages: [{ partitionIndex: 1, cause: 'no-close' }] });
    // The replay lists the same fault as late and reaches the same amounts.
    const row = await live.replay([...all, late]);
    expect(row).toMatchObject({ forfeited: [{ partitionIndex: 1, cause: 'no-close' }], late: [{ kind: 'fault', partitionIndex: 1 }] });
    sameAsReplay(outcome, row, a);
  });
});
