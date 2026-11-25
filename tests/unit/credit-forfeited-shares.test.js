// @vitest-environment node
// Failed stages in the ledger's share arithmetic (docs/settlement-replay.md, "Split arithmetic"): the shares are computed
// over every stage, then a forfeiting stage is credited 0 and the charge falls by exactly its share. Nothing is
// redistributed, and a forfeiting stage on the requester's own unit or account changes no amount. Also the rules a
// reservation takes and keeps: new split reservations take reploid.settlement-replay/v3, and a retried reservation keeps
// the rules it was made under.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import {
  accountSettlement, creditSettlementDeltas, settledCreditUnits, PROVIDER_RELIEF_TERMS, SETTLEMENT_RULES, SETTLEMENT_RULES_INTERIM, SETTLEMENT_RULES_V1,
  SETTLEMENT_RULES_V2, SETTLEMENT_RULE_SETS, UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V2, UNFINISHED_ANSWER_TERMS_V3, UNFINISHED_TERMS_OF_RULES
} from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { acceptSettlementTerms, signSettlementTerms } from '../../server/fleet/settlement-terms.js';
import { POLICY, T0, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const request = weights => ({ computerId: 'requester', providers: weights.map((weight, index) => ({ participantId: `stage-${index}`, weight })) });
const self = id => id;
const amounts = split => split.credits.map(row => row.amount);
const total = deltas => [...deltas.values()].reduce((sum, value) => sum + value, 0);

describe('settlement rules identifiers', () => {
  it('names v3 as the rules of new reservations and keeps every earlier id with its terms', () => {
    expect(SETTLEMENT_RULES).toBe('reploid.settlement-replay/v3');
    expect(SETTLEMENT_RULES_V2).toBe('reploid.settlement-replay/v2');
    expect(SETTLEMENT_RULE_SETS).toEqual(['reploid.settlement-replay/v1', 'reploid.settlement-replay/v1+acknowledged-prefix', 'reploid.settlement-replay/v2',
      'reploid.settlement-replay/v3']);
    expect(UNFINISHED_TERMS_OF_RULES).toEqual({ [SETTLEMENT_RULES_V1]: UNFINISHED_ANSWER_TERMS, [SETTLEMENT_RULES_INTERIM]: UNFINISHED_ANSWER_TERMS,
      [SETTLEMENT_RULES_V2]: UNFINISHED_ANSWER_TERMS_V2, [SETTLEMENT_RULES]: UNFINISHED_ANSWER_TERMS_V3 });
    // A stage owner's interruption claim is relief only under the earlier terms.
    expect(PROVIDER_RELIEF_TERMS).toEqual([UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V2]);
    expect(settledCreditUnits({ mode: 'partition', unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2, settlementRules: SETTLEMENT_RULES_V2 },
      { outputTokens: 3, interruptedStages: [1] }, 3)).toBe(0);
    // Under the failed-stage terms the units are the acknowledged outputs; the forfeit is taken from the shares.
    expect(settledCreditUnits({ mode: 'partition', unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3, settlementRules: SETTLEMENT_RULES },
      { outputTokens: 3, forfeitedStages: [{ partitionIndex: 1, cause: 'fault' }] }, 3)).toBe(9);
  });

  it('signs and accepts the failed-stage terms by default', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    expect(a.terms.unfinishedTerms).toBe(UNFINISHED_ANSWER_TERMS_V3);
    // A stage that settles under these terms refuses terms that name the earlier relief.
    const earlier = await runAttempt(parties, { tag: 'earlier', unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 });
    const { createAttemptEvidenceSigner } = await import('../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js');
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[0], now: () => T0 });
    await expect(acceptSettlementTerms({ signer, terms: earlier.terms, partitionIndex: 0 })).rejects.toThrow('unfinished-answer terms');
    const requester = createAttemptEvidenceSigner({ identity: parties.requester, now: () => T0 });
    const terms = await signSettlementTerms({ signer: requester, identity: a.identity, reservationId: 'reservation-default', policy: POLICY, maxOutputTokens: 8,
      weights: [1, 3], notBefore: T0, deadline: T0 + 30000 });
    expect(terms.unfinishedTerms).toBe(UNFINISHED_ANSWER_TERMS_V3);
    expect(await acceptSettlementTerms({ signer, terms, partitionIndex: 0 })).toMatchObject({ partitionIndex: 0 });
  });
});

describe('creditSettlementDeltas with forfeited stages', () => {
  it('drops the failed stage\'s credit and lowers the charge by exactly that share', () => {
    // 3 outputs at 3 credits: 9 units over weights 1, 3 and 2 are shares 1, 4 and 4.
    const whole = creditSettlementDeltas(request([1, 3, 2]), 9, self);
    expect(amounts(whole)).toEqual([1, 4, 4]);
    expect(whole.charge).toBe(9);
    const split = creditSettlementDeltas(request([1, 3, 2]), 9, self, [1]);
    expect(amounts(split)).toEqual([1, 0, 4]);
    expect(split.credits.map(row => row.participantId)).toEqual(['stage-0', 'stage-1', 'stage-2']);
    expect(split.charge).toBe(5);
    expect(split.ownComputeUnits).toBe(0);
    expect([...split.deltas]).toEqual([['requester', -5], ['stage-0', 1], ['stage-1', 0], ['stage-2', 4]]);
    expect(total(split.deltas)).toBe(0);
  });

  it('gives every other stage exactly what it would have had, whichever stage fails and however the remainder falls', () => {
    for (const [weights, units] of [[[1, 3, 2], 9], [[1, 1, 1], 10], [[1, 3], 15], [[5, 1, 1, 7], 101], [[1, 10, 10, 1], 18], [[2, 3], 1], [[1, 1], 0]]) {
      const whole = creditSettlementDeltas(request(weights), units, self);
      expect(amounts(whole).reduce((sum, value) => sum + value, 0)).toBe(units);
      const subsets = Array.from({ length: 1 << weights.length }, (_, mask) => weights.map((_, index) => index).filter(index => mask & (1 << index)));
      for (const forfeited of subsets) {
        const split = creditSettlementDeltas(request(weights), units, self, forfeited);
        expect(amounts(split)).toEqual(amounts(whole).map((amount, index) => (forfeited.includes(index) ? 0 : amount)));
        expect(split.charge).toBe(units - forfeited.reduce((sum, index) => sum + amounts(whole)[index], 0));
        expect(total(split.deltas)).toBe(0);
        expect(Object.is(split.deltas.get('requester'), -0)).toBe(false);
      }
    }
  });

  it('is unchanged without a list, and with an empty one', () => {
    for (const [weights, units] of [[[1, 3, 2], 9], [[1, 1, 1], 10], [[2, 3], 0]]) {
      const before = creditSettlementDeltas(request(weights), units, self);
      for (const list of [undefined, []]) {
        const now = creditSettlementDeltas(request(weights), units, self, list);
        expect({ ...now, deltas: [...now.deltas] }).toEqual({ ...before, deltas: [...before.deltas] });
      }
    }
  });

  it('changes nothing when the failed stage is on the requester\'s own unit', () => {
    // Requester-held edges: stages 0 and 3 are the requester's own. 9 units over 1, 10, 10 and 1 are 0, 4, 4 and 1.
    const own = id => (id === 'stage-0' || id === 'stage-3' ? 'requester' : id);
    const whole = creditSettlementDeltas(request([1, 10, 10, 1]), 9, own);
    expect(whole).toMatchObject({ charge: 8, ownComputeUnits: 1 });
    expect(amounts(whole)).toEqual([4, 4]);
    for (const forfeited of [[0], [3], [0, 3]]) {
      const split = creditSettlementDeltas(request([1, 10, 10, 1]), 9, own, forfeited);
      expect({ ...split, deltas: [...split.deltas] }).toEqual({ ...whole, deltas: [...whole.deltas] });
    }
    // An operator failing beside them loses only its own 4.
    const split = creditSettlementDeltas(request([1, 10, 10, 1]), 9, own, [1, 3]);
    expect(split).toMatchObject({ charge: 4, ownComputeUnits: 1 });
    expect(amounts(split)).toEqual([0, 4]);
    expect([...split.deltas]).toEqual([['requester', -4], ['stage-1', 0], ['stage-2', 4]]);
  });

  it('charges nothing when every outside stage fails, without a negative zero', () => {
    const split = creditSettlementDeltas(request([1, 3, 2]), 9, self, [0, 1, 2]);
    expect(split.charge).toBe(0);
    expect(amounts(split)).toEqual([0, 0, 0]);
    expect(Object.is(split.deltas.get('requester'), 0)).toBe(true);
  });
});

describe('accountSettlement with forfeited stages', () => {
  // Owner accounts: the requester's account also holds stage 0's computer; one operator holds stages 1 and 3.
  const places = { requester: { computerId: 'c-requester', accountId: 'owner-r' }, 'stage-0': { computerId: 'c-edge', accountId: 'owner-r' },
    'stage-1': { computerId: 'c-a', accountId: 'owner-a' }, 'stage-2': { computerId: 'c-b', accountId: 'owner-b' }, 'stage-3': { computerId: 'c-a2', accountId: 'owner-a' } };
  const placeOf = id => places[id];
  const accountRequest = { consumer: 'requester', computerId: 'c-requester', accountId: 'owner-r',
    providers: [1, 3, 2, 2].map((weight, index) => ({ participantId: `stage-${index}`, weight })) };

  it('posts the forfeit to owner accounts: no credit for the failed stage, the charge lower by its share', () => {
    // 24 units over weights 1, 3, 2 and 2 are shares 3, 9, 6 and 6; the requester's own stage 0 is never charged.
    const whole = accountSettlement(accountRequest, 24, placeOf);
    expect(whole).toMatchObject({ charge: 21, ownComputeUnits: 3 });
    expect(amounts(whole)).toEqual([9, 6, 6]);
    const split = accountSettlement(accountRequest, 24, placeOf, [1]);
    expect(split).toMatchObject({ charge: 12, ownComputeUnits: 3 });
    expect(split.credits).toEqual([{ participantId: 'stage-1', computerId: 'c-a', accountId: 'owner-a', amount: 0 },
      { participantId: 'stage-2', computerId: 'c-b', accountId: 'owner-b', amount: 6 }, { participantId: 'stage-3', computerId: 'c-a2', accountId: 'owner-a', amount: 6 }]);
    expect(split.entries).toEqual([{ accountId: 'owner-r', computerId: 'c-requester', delta: -12 }, { accountId: 'owner-a', computerId: 'c-a', delta: 0 },
      { accountId: 'owner-b', computerId: 'c-b', delta: 6 }, { accountId: 'owner-a', computerId: 'c-a2', delta: 6 }]);
    expect([...split.deltas]).toEqual([['owner-r', -12], ['owner-a', 6], ['owner-b', 6]]);
    expect(total(split.deltas)).toBe(0);
  });

  it('changes nothing when the requester\'s own-account stage fails, and is unchanged without a list', () => {
    const whole = accountSettlement(accountRequest, 24, placeOf);
    for (const list of [undefined, [], [0]]) {
      const now = accountSettlement(accountRequest, 24, placeOf, list);
      expect({ ...now, deltas: [...now.deltas] }).toEqual({ ...whole, deltas: [...whole.deltas] });
    }
    const none = accountSettlement(accountRequest, 24, placeOf, [0, 1, 2, 3]);
    expect(none).toMatchObject({ charge: 0, ownComputeUnits: 3 });
    expect(Object.is(none.entries[0].delta, 0)).toBe(true);
    expect(amounts(none)).toEqual([0, 0, 0]);
  });

  it('applies the same forfeit to a reservation made before owner accounts (per-computer arithmetic)', () => {
    const { accountId: _account, ...perComputer } = accountRequest;
    const whole = accountSettlement(perComputer, 24, placeOf);
    // Per computer, stage 0 is another computer than the requester's and is paid: shares 3, 9, 6 and 6.
    expect(whole).toMatchObject({ charge: 24, ownComputeUnits: 0 });
    const split = accountSettlement(perComputer, 24, placeOf, [3]);
    expect(split).toMatchObject({ charge: 18, ownComputeUnits: 0 });
    expect(amounts(split)).toEqual([3, 9, 6, 0]);
    expect(total(split.deltas)).toBe(0);
    expect(split.entries.find(row => row.computerId === 'c-a2')).toEqual({ accountId: 'owner-a', computerId: 'c-a2', delta: 0 });
  });

  it('posts what the settlement replay computes for the same failed stage', async () => {
    const parties = await createParties(3);
    // Three stages with weights 1, 3 and 2; the middle stage never closes after 3 acknowledged outputs.
    const a = await runAttempt(parties, { outputs: ['a', 'b', 'c', 'd', 'e', 'f'], weights: [1, 3, 2], vanishStage: 1, vanishAfterStep: 2 });
    const row = (await replaySettlement({ records: a.all(), policies: [POLICY], at: a.decidedAt })).reservations[0];
    expect(row).toMatchObject({ status: 'settled', debit: 5, chargedOutputs: 3, forfeited: [{ partitionIndex: 1, cause: 'no-close' }] });
    const split = creditSettlementDeltas({ computerId: a.terms.requesterId, providers: a.terms.shares.map(share => ({ participantId: share.participantId, weight: share.weight })) },
      row.chargedOutputs * POLICY.creditsPerOutputToken, self, row.forfeited.map(item => item.partitionIndex));
    expect(split.charge).toBe(row.debit);
    expect(split.credits.map(credit => ({ participantId: credit.participantId, amount: credit.amount }))).toEqual(row.credits);
  });
});

describe('the rules a reservation takes and keeps', () => {
  const opened = [];
  afterEach(async () => { for (const { ledger, directory } of opened.splice(0)) { try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } } });
  async function open(parties) {
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-reservation-rules-'));
    const computers = [parties.requester, ...parties.stages].map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
    const live = { clock: T0, file: path.join(directory, 'credits.sqlite') };
    live.ledger = await openFleetCredits({ file: live.file, computers, policy: POLICY, now: () => live.clock });
    opened.push({ ledger: live.ledger, directory });
    return live;
  }
  const inputOf = (parties, a) => ({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
    providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
    model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
    inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
  const hashOf = value => createHash('sha256').update(canonicalize(value)).digest('hex');
  /** A reservation as the ledger stored it under an earlier rules id (`rules` null: before any rules id). */
  async function plantEarlier(live, input, { unfinishedTerms, settlementRules }) {
    const reserved = { ...input, ...(unfinishedTerms ? { unfinishedTerms } : {}), ...(settlementRules ? { settlementRules } : {}) };
    const binding = { ...reserved, requestHash: hashOf(reserved), computerId: 'computer-0', accountId: 'owner-0', maximum: input.maxOutputTokens * POLICY.creditsPerOutputToken,
      policyVersion: POLICY.version, terminalCharge: null, admissionVersion: 1, createdAt: T0, deadline: T0 + POLICY.maxRequestMs };
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(live.file);
    try {
      database.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(binding.id, JSON.stringify(binding));
      database.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(binding.maximum, binding.accountId);
    } finally { database.close(); }
    return binding;
  }

  it('gives a new split reservation the v3 rules and failed-stage terms, and a retry finds it', async () => {
    const parties = await createParties(2), live = await open(parties);
    const a = await runAttempt(parties), input = inputOf(parties, a);
    const binding = live.ledger.reserve(structuredClone(input));
    expect(binding).toMatchObject({ settlementRules: 'reploid.settlement-replay/v3', unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3 });
    expect(binding.requestHash).toBe(hashOf({ ...input, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V3, settlementRules: SETTLEMENT_RULES }));
    expect(live.ledger.reserve(structuredClone(input))).toEqual(binding);
    expect(live.ledger.snapshot().accounts[0].held).toBe(binding.maximum);
    // The same reservation ID with other terms is still refused, and nobody sets the rules from outside.
    expect(() => live.ledger.reserve({ ...structuredClone(input), maxOutputTokens: input.maxOutputTokens - 1 })).toThrow('different terms');
    expect(() => live.ledger.reserve({ ...structuredClone(input), settlementRules: SETTLEMENT_RULES_V2 })).toThrow('set by the ledger');
    expect(() => live.ledger.reserve({ ...structuredClone(input), unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 })).toThrow('set by the ledger');
  });

  it.each([
    ['reploid.settlement-replay/v2', { unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2, settlementRules: 'reploid.settlement-replay/v2' }],
    ['reploid.settlement-replay/v1+acknowledged-prefix', { unfinishedTerms: UNFINISHED_ANSWER_TERMS, settlementRules: 'reploid.settlement-replay/v1+acknowledged-prefix' }],
    ['reploid.settlement-replay/v1', { unfinishedTerms: UNFINISHED_ANSWER_TERMS, settlementRules: 'reploid.settlement-replay/v1' }],
    ['the provider-loss-free terms before any rules id', { unfinishedTerms: UNFINISHED_ANSWER_TERMS }],
    ['no unfinished-answer terms at all', {}]
  ])('finds a retried reservation made under %s and leaves its rules alone', async (_name, earlier) => {
    const parties = await createParties(2), live = await open(parties);
    const a = await runAttempt(parties), input = inputOf(parties, a);
    const planted = await plantEarlier(live, input, earlier);
    const found = live.ledger.reserve(structuredClone(input));
    expect(found).toEqual(planted);
    expect(found.settlementRules).toBe(earlier.settlementRules);
    expect(found.unfinishedTerms).toBe(earlier.unfinishedTerms);
    // Nothing was reserved twice, and other terms under that ID are refused.
    expect(live.ledger.snapshot().accounts[0].held).toBe(planted.maximum);
    expect(() => live.ledger.reserve({ ...structuredClone(input), maxOutputTokens: input.maxOutputTokens - 1 })).toThrow('different terms');
  });
});
