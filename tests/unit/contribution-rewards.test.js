import { beforeEach, describe, expect, it } from 'vitest';

import custody from '../../self/config/chat-files.json' with { type: 'json' };
import { PRODUCT_ECONOMICS_CONTRACT_ID } from '../../server/ledger/domain.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { NATIVE_OWNER_POLICY_SCHEMA, nativeOwnerPolicyDigest, validateNativeOwnerPolicy } from '../../server/native-owner/policy.js';
import { CAPACITY_EVIDENCE_SCHEMA, validateIssuancePolicy, validateRewardPolicy } from '../../server/rewards/domain.js';
import { composeContributionRewards } from '../../server/rewards/engine.js';
import { REWARD_STORE_OPERATIONS, validateRewardStoreContract } from '../../server/rewards/store-contract.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend, createMemoryRewardState } from '../../server/rewards/stores.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

// Test-only fixtures. None of these values is a product price, reward amount,
// demand share, capacity coverage or eligibility decision.
const LEDGER_POLICY = Object.freeze({
  accountingVersion: 'test-accounting/1',
  contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID, documentRevision: 'test-document-revision' },
  unit: { name: 'credit', minorUnitsPerCredit: 1 },
  rounding: 'ceil',
  lotConsumptionOrder: ['community_access', 'earned', 'donated', 'purchased'],
  transfers: { enabled: false }
});
const REWARD_POLICY = Object.freeze({
  rewardPolicyVersion: 'test-reward-policy/1',
  validatorId: 'validator_test_demanded_inference',
  enabledCategories: ['demanded_inference'],
  collusion: { rejectLinkKinds: ['shared_payment_instrument'] }
});
const ISSUANCE_POLICY = Object.freeze({
  policyId: 'test-issuance-limits/1',
  accountingVersion: 'test-accounting/1',
  demand: { provenance: ['purchased', 'donated', 'community_access', 'earned'], share: { numerator: 1, denominator: 2 } },
  capacity: { coverage: { numerator: 1, denominator: 1 }, evidenceMaxAgeMs: 10 * 60_000 }
});
const OWNER_GRANT = { granted: true, ownership: 'personal', grantedBy: 'owner_test' };
const OWNER_POLICY = validateNativeOwnerPolicy({
  schema: NATIVE_OWNER_POLICY_SCHEMA,
  authorization: { equipment: OWNER_GRANT, network: OWNER_GRANT },
  sampleIntervalMs: 5000
}, { custody });
const OWNER_DIGEST = nativeOwnerPolicyDigest(OWNER_POLICY);
const ownerAuthorization = { policy: OWNER_POLICY, digest: OWNER_DIGEST };
const MODEL = Object.freeze({ modelId: 'model_test', modelIdentity: `sha256:${'a'.repeat(64)}`, planId: `sha256:${'b'.repeat(64)}` });

const START = Date.parse('2026-10-14T00:00:00.000Z');
const MIN = 60_000;
let nowMs = START;
const clock = () => new Date(nowMs).toISOString();
const at = (offsetMs) => new Date(nowMs + offsetMs).toISOString();
const advance = (ms) => { nowMs += ms; };

// Authenticated identity port double: participant -> account and account links.
let participants;
let links;
const identity = {
  participantAccount: async (participantId) => participants.get(participantId) ?? null,
  accountLinks: async (left, right) => links
    .filter((link) => (link.a === left && link.b === right) || (link.a === right && link.b === left))
    .map(({ kind, evidenceId }) => ({ kind, evidenceId }))
};
// Admitted-capacity evidence double; the execution owner would supply it.
let capacity;
const readAdmittedCapacity = async () => capacity && {
  schema: CAPACITY_EVIDENCE_SCHEMA,
  evidenceId: capacity.evidenceId,
  accountingVersion: 'test-accounting/1',
  serviceCredits: capacity.serviceCredits,
  observedAt: capacity.observedAt ?? clock()
};
// Purchases are outside reward policy; this double stands in for their decision owner.
const otherProvenance = async ({ provenance }) => ({ allowed: true, decisionId: `test-funding:${provenance}` });
const composition = { rewardPolicy: REWARD_POLICY, issuancePolicy: ISSUANCE_POLICY, identity, readAdmittedCapacity, otherProvenance, clock };

const once = (faults, point) => () => {
  const fault = faults[point];
  faults[point] = null;
  if (fault) fault();
};

// Each harness owns durable ledger and reward state; open() models a (re)started process.
const harnesses = {
  memory: () => {
    const ledgerState = createMemoryLedgerState();
    const rewardState = createMemoryRewardState();
    const faults = { ledger: { beforeCommit: null, afterCommit: null }, reward: { beforeCommit: null, afterCommit: null } };
    const hooks = (target) => ({ beforeCommit: once(target, 'beforeCommit'), afterCommit: once(target, 'afterCommit') });
    return {
      faults,
      open: (overrides = {}) => composeContributionRewards({
        ...composition,
        backend: createMemoryRewardBackend({ state: rewardState, hooks: hooks(faults.reward) }),
        createLedger: ({ issuanceAuthority }) => createMemoryLedgerStore({
          state: ledgerState, hooks: hooks(faults.ledger), policy: LEDGER_POLICY, clock, issuanceAuthority
        }),
        ...overrides
      })
    };
  },
  firestore: () => {
    const ledgerDb = createFakeFirestore();
    const rewardDb = createFakeFirestore();
    return {
      faults: { ledger: ledgerDb.faults, reward: rewardDb.faults },
      open: (overrides = {}) => composeContributionRewards({
        ...composition,
        backend: createFirestoreRewardBackend({ firestore: rewardDb, collectionPrefix: 'test' }),
        createLedger: ({ issuanceAuthority }) => createFirestoreLedgerStore({
          firestore: ledgerDb, collectionPrefix: 'test', policy: LEDGER_POLICY, clock, issuanceAuthority
        }),
        ...overrides
      })
    };
  }
};

const fund = (ledger, accountId, amount, purchaseId = `purchase:${accountId}:${amount}`) => ledger.issueCredits({
  accountId,
  provenance: 'purchased',
  amount,
  source: { processor: 'test-processor', purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: 1999, currency: 'USD' } },
  idempotencyKey: `issue:${purchaseId}`
});

const quoteInput = ({ quoteId, accountId, service = {} }) => ({
  quoteId,
  accountId,
  service: {
    serviceRecordId: 'svc_chat_test',
    model: { modelId: MODEL.modelId, checkpoint: 'sha256:checkpoint', deployedRepresentation: 'q4k-test', tokenizer: 'tok_test', adapters: [] },
    runtime: { runtimeId: 'doppler@test' },
    operation: 'chat.completion',
    limits: {
      context: { max: 4096, unit: 'token', exceedance: 'reject' },
      output: { max: 100, unit: 'token', exceedance: 'stop_and_report' }
    },
    qualityPolicyVersion: 'quality-policy-test/1',
    recipientScope: { policyId: 'remote-permission-test' },
    disclosureScope: { scopeId: 'thread-disclosure-test' },
    queueClass: 'standard',
    deadline: at(3 * MIN),
    ...service
  },
  pricing: { basis: { kind: 'test_per_output_token' }, maxCharge: 60 },
  terms: {
    validUntil: at(MIN),
    reservationPeriodMs: 10 * MIN,
    queue: { behavior: 'fifo_bounded', maxWaitMs: 30_000 },
    execution: { maxAttempts: 2, maxDurationMs: 120_000 },
    refund: { policyId: 'refund-terms-test' },
    qualityReview: { procedureId: 'quality-review-test' },
    settlement: {
      full: { kind: 'metered', base: 10, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
      reduced: null,
      partialDelivery: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
      cancellationQueued: { kind: 'fixed', amount: 0 },
      cancellationDispatched: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
      timeout: { kind: 'fixed', amount: 0 },
      providerFailure: { kind: 'fixed', amount: 0 },
      failedQuality: { kind: 'fixed', amount: 0 }
    }
  }
});

const settle = (ledger, work, outcome = 'full') => ledger.settleReservation({
  reservationId: work.reservationId,
  billableEventId: `bill:${work.reservationId}`,
  outcome,
  attemptId: work.attemptId,
  metering: { output: 40 },
  completedAt: clock(),
  idempotencyKey: `settle:${work.reservationId}`
});

/** A requester quote, acceptance and bound attempt; settled (charge 30) unless `outcome` is null. */
const demand = async (ledger, { quoteId, accountId = 'acct_req', recipients = ['peer_c0', 'peer_c1'], outcome = 'full', service } = {}) => {
  const quote = await ledger.createQuote({ ...quoteInput({ quoteId, accountId, service }), idempotencyKey: `quote:${quoteId}` });
  const { reservationId } = await ledger.acceptQuote({
    quoteId, accountId, quoteHash: quote.quoteHash, deviceId: 'phone', idempotencyKey: `accept:${quoteId}`
  });
  const work = { reservationId, attemptId: `att_${quoteId}` };
  await ledger.bindAttempt({ reservationId, attemptId: work.attemptId, recipients, idempotencyKey: `bind:${quoteId}` });
  if (outcome) await settle(ledger, work, outcome);
  return work;
};

const routeIdentity = ({ attemptId, requesterId, stages }) => ({
  schema: 'reploid.partition-attempt/v2',
  threadId: `thread_${attemptId}`,
  attemptId,
  requesterId,
  placementGeneration: 0,
  route: {
    schema: 'reploid.partition-route/v1',
    ...MODEL,
    stages: stages.map((participantId, index) => ({
      index, participantId, transportId: `transport_${participantId}`, residentId: `resident_${participantId}`, executionId: `execution_${participantId}`
    })),
    activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 }
  }
});

// The requester runner's settlement receipt (partition-route-execution.js shape).
const routeReceipt = (route, { phase = 'completed', cleanup = 'settled' } = {}) => ({
  identity: route,
  phase,
  reservations: route.route.stages.map((stage) => ({
    identity: route, participantId: stage.participantId, index: stage.index, phase: 'reserved',
    reservedAt: START, settlingAt: null, settledAt: null, failure: null, partitionIndex: stage.index, status: 'reserved'
  })),
  cleanup: route.route.stages.map((stage) => ({ partitionIndex: stage.index, status: cleanup, error: null })),
  cleanupSettledAt: phase === 'completed' ? START : null,
  failure: phase === 'completed' ? null : 'stage failed'
});

// partition-summary.js `reploid.mesh.partition-summary/v2` projection.
const routeSummary = (route, options = {}) => ({
  schema: 'reploid.mesh.partition-summary/v2',
  identity: route,
  activationBytes: 1024,
  stopReason: 'eos-token',
  settlement: routeReceipt(route, options),
  stepSummary: {
    count: 3,
    stages: route.route.stages.map((stage) => ({ partitionIndex: stage.index, steps: 3, stepMs: { count: 3, total: 36 } })),
    detail: 'aggregate; no per-step trace transferred'
  }
});

// The raw `reploid.mesh.partition-execution/v3` record the runner returns.
const routeExecution = (route, options = {}) => ({
  schema: 'reploid.mesh.partition-execution/v3',
  identity: route,
  activationBytes: 1024,
  stopReason: 'eos-token',
  steps: [0, 1, 2].map((step) => ({
    step, tokenPosition: step, inputTokenCount: step ? 1 : 5, maxTokens: 3, generationDigest: `sha256:${'c'.repeat(64)}`, tokenId: 7,
    stages: route.route.stages.map((stage) => ({ partitionIndex: stage.index, elapsedMs: 4, metrics: null }))
  })),
  settlement: routeReceipt(route, options)
});

// The contributor resident's own reservation record (partition-reservations.js shape).
const admissionRecord = (route, index, overrides = {}) => ({
  identity: route, participantId: route.route.stages[index].participantId, index, phase: 'settled',
  reservedAt: START, settlingAt: START, settledAt: START, failure: null,
  resources: { attemptSlots: 1, scope: 'application-attempt-limits' }, ...overrides
});

let keySeq = 0;
const claimInput = ({
  offerId = 'offer_c1', work, stageIndex = 1, stages = ['peer_c0', 'peer_c1'], requesterId = 'peer_req',
  receipt = {}, raw = false, admission = {}, ownerPolicyDigest = OWNER_DIGEST, execution, key
} = {}) => {
  const route = routeIdentity({ attemptId: work.attemptId, requesterId, stages });
  return {
    offerId,
    reservationId: work.reservationId,
    attemptId: work.attemptId,
    stageIndex,
    execution: execution ?? (raw ? routeExecution(route, receipt) : routeSummary(route, receipt)),
    contribution: { ownerPolicyDigest, admission: admissionRecord(route, stageIndex, admission) },
    idempotencyKey: key ?? `validate:${(keySeq += 1)}`
  };
};

const offerInput = ({ offerId, accountId = 'acct_c1', participantId = 'peer_c1', category = 'demanded_inference', reward = {}, ...overrides } = {}) => ({
  offerId,
  accountId,
  work: { category, participantId, model: { ...MODEL } },
  reward: {
    basis: { kind: 'test_share_of_settled_charge' },
    formula: { kind: 'metered', base: 0, rates: [{ meter: 'settledCharge', numerator: 1, denominator: 3 }] },
    maxReward: 50,
    ...reward
  },
  resourceBounds: { context: { max: 4096, unit: 'token' }, output: { max: 100, unit: 'token' } },
  duration: { startsAt: clock(), endsAt: at(60 * MIN) },
  validUntil: at(5 * MIN),
  paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
  failureCompensation: { kind: 'none' },
  ...overrides
});

const offerAndAccept = async (rewards, options) => {
  const offer = await rewards.createOffer({ ...offerInput(options), idempotencyKey: `offer:${options.offerId}` });
  const acceptance = await rewards.acceptOffer({
    offerId: offer.offerId, accountId: offer.accountId, offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: `accept-offer:${offer.offerId}`
  });
  return { offer, acceptance };
};

const codes = (validation) => validation.reasons.map((reason) => reason.code);
const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code });
const declinedWith = (promise, reason) => expect(promise).rejects.toMatchObject({ code: 'issuance_not_authorized', details: { reason } });
const throwsWith = (operation, code) => {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
};
const journalShape = async (ledger, accountId) => (await ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);

describe.each(Object.keys(harnesses))('contribution rewards (%s store)', (kind) => {
  let harness;
  let ledger;
  let rewards;

  beforeEach(async () => {
    nowMs = START;
    keySeq = 0;
    participants = new Map([
      ['peer_req', 'acct_req'], ['peer_c0', 'acct_c0'], ['peer_c1', 'acct_c1'], ['peer_c1_phone', 'acct_c1'],
      ['peer_alt', 'acct_alt'], ['peer_linked', 'acct_linked']
    ]);
    links = [];
    capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
    harness = harnesses[kind]();
    ({ ledger, rewards } = harness.open());
    for (const [accountId, ownerId] of [
      ['acct_req', 'uid_req'], ['acct_c0', 'uid_c0'], ['acct_c1', 'uid_c1'], ['acct_alt', 'uid_c1'], ['acct_linked', 'uid_linked']
    ]) await ledger.openAccount({ accountId, ownerId });
    await fund(ledger, 'acct_req', 1000);
  });

  it('implements the reward store contract', () => {
    expect(validateRewardStoreContract(rewards)).toEqual({ ok: true, missing: [] });
    expect(REWARD_STORE_OPERATIONS).toContain('validateWork');
  });

  it('issues one earned lot with provenance for validated demanded inference under an accepted offer', async () => {
    const { offer, acceptance } = await offerAndAccept(rewards, { offerId: 'offer_c1' });
    expect(offer).toMatchObject({
      status: 'offered', category: 'demanded_inference', ledgerCategory: 'computation',
      contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID }, accountingVersion: 'test-accounting/1', rounding: 'ceil',
      work: { participantId: 'peer_c1', model: MODEL },
      reward: { basis: { kind: 'test_share_of_settled_charge' }, maxReward: 50 },
      resourceBounds: { output: { max: 100, unit: 'token' } },
      paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
      failureCompensation: { kind: 'none' },
      validation: {
        validatorId: 'validator_test_demanded_inference',
        conditions: expect.arrayContaining([expect.stringMatching(/^requester_quote_accepted/), expect.stringMatching(/^not_self_dealing/)]),
        collusion: { alwaysRejected: ['same_account', 'same_owner', 'same_participant'], rejectLinkKinds: ['shared_payment_instrument'] }
      }
    });
    expect(offer.offerHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(acceptance).toMatchObject({ offerId: 'offer_c1', offerHash: offer.offerHash, ownerPolicyDigest: OWNER_DIGEST });
    expect(await rewards.getOffer('offer_c1')).toMatchObject({
      status: 'accepted', acceptance: { ownerPolicyDigest: OWNER_DIGEST, equipment: { ownership: 'personal' }, network: { granted: true } }
    });

    const work = await demand(ledger, { quoteId: 'q1' });
    const validation = await rewards.validateWork(claimInput({ work }));
    expect(validation).toMatchObject({
      outcome: 'accepted', reasons: [], issuanceStatus: 'pending', workId: expect.stringMatching(/^dinf_/),
      reward: { amount: 10, uncapped: 10, capped: false, meters: { settledCharge: 30, output: 40 } },
      evidence: {
        requester: { accountId: 'acct_req' },
        settlement: { outcome: 'full', charge: 30, billableEventId: `bill:${work.reservationId}`, recipients: ['peer_c0', 'peer_c1'] },
        route: { requesterId: 'peer_req', modelId: MODEL.modelId, stageCount: 2 },
        contribution: { participantId: 'peer_c1', stageIndex: 1, ownerPolicyDigest: OWNER_DIGEST }
      }
    });

    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(issued).toMatchObject({ status: 'issued', accountId: 'acct_c1', amount: 10, decisionId: `issuance:${validation.validationId}` });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'earned', quantity: 10, accountId: 'acct_c1',
      source: {
        category: 'computation', rewardCategory: 'demanded_inference', workId: validation.workId, outcome: 'accepted',
        offerId: 'offer_c1', offerHash: offer.offerHash, validationId: validation.validationId, validatorId: 'validator_test_demanded_inference',
        reservationId: work.reservationId, settlementId: `stl:${work.reservationId}`, billableEventId: `bill:${work.reservationId}`,
        attemptId: work.attemptId, stageIndex: 1, participantId: 'peer_c1', ownerPolicyDigest: OWNER_DIGEST
      },
      issuance: { decisionId: issued.decisionId, limitId: 'test-issuance-limits/1' }
    });
    expect(await rewards.issueReward({ validationId: validation.validationId })).toEqual(issued);
    expect(await rewards.getValidation(validation.validationId)).toMatchObject({ issuanceStatus: 'issued', issuance: { lotId: issued.lotId } });
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await ledger.getAccount('acct_c1')).toMatchObject({ available: 10, byProvenance: { earned: { issued: 10 } } });
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 10, allowances: 1 });
    expect(await rewards.listIssuanceDecisions()).toEqual([expect.objectContaining({
      allowed: true, decisionId: issued.decisionId, figures: expect.objectContaining({ measuredDemand: 30, demandLimit: 15, authorizedAfter: 10 })
    })]);
  });

  it('rejects duplicate and replayed rewards: one reward per stage share of a settled attempt', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    await offerAndAccept(rewards, { offerId: 'offer_c1_second' });
    const work = await demand(ledger, { quoteId: 'q1' });
    const input = claimInput({ work, key: 'validate:first' });
    const first = await rewards.validateWork(input);
    expect(await rewards.validateWork(input)).toEqual(first);

    const replay = await rewards.validateWork({ ...input, idempotencyKey: 'validate:replayed' });
    expect(replay).toMatchObject({
      outcome: 'rejected', workId: null, reward: null, issuanceStatus: 'not_eligible',
      reasons: [expect.objectContaining({ code: 'duplicate_reward', details: { validationId: first.validationId } })]
    });
    expect(codes(await rewards.validateWork({ ...input, offerId: 'offer_c1_second', idempotencyKey: 'validate:second-offer' })))
      .toEqual(['duplicate_reward']);
    await rejectsWith(rewards.validateWork({ ...input, stageIndex: 0 }), 'idempotency_conflict');

    const issued = await rewards.issueReward({ validationId: first.validationId });
    await rejectsWith(rewards.issueReward({ validationId: replay.validationId }), 'validation_rejected');
    const { source } = await ledger.getLot(issued.lotId);
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10, source, idempotencyKey: 'issue:replayed-reward'
    }), 'duplicate_issuance_source');
    await declinedWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10, source: { ...source, workId: 'dinf_other' }, idempotencyKey: 'issue:other-work'
    }), 'issuance_request_mismatch');
    await declinedWith(ledger.issueCredits({
      accountId: 'acct_c1', provenance: 'earned', amount: 10,
      source: { ...source, workId: 'dinf_forged', validationId: 'val_forged' }, idempotencyKey: 'issue:forged'
    }), 'validation_not_found');

    const second = await demand(ledger, { quoteId: 'q2' });
    const racing = await Promise.all(['a', 'b', 'c'].map((suffix) => rewards.validateWork(claimInput({ work: second, key: `race:${suffix}` }))));
    expect(racing.filter((validation) => validation.outcome === 'accepted')).toHaveLength(1);
    expect(racing.filter((validation) => validation.outcome === 'rejected').flatMap(codes)).toEqual(['duplicate_reward', 'duplicate_reward']);
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 10 });
  });

  it('rejects fabricated work that no accepted requester quote and completed settlement backs', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const settled = await demand(ledger, { quoteId: 'q_settled' });
    const validate = (options) => rewards.validateWork(claimInput(options));

    // A consistent route summary and admission record (peer agreement) with no ledger settlement.
    const invented = await validate({ work: { reservationId: 'rsv:q_invented', attemptId: 'att_invented' } });
    expect(codes(invented)).toEqual(['no_matching_settlement']);
    expect(codes(await validate({ work: await demand(ledger, { quoteId: 'q_open', outcome: null }) }))).toEqual(['work_not_settled']);
    expect(codes(await validate({ work: await demand(ledger, { quoteId: 'q_failed', outcome: 'provider_failure' }) }))).toEqual(['work_not_completed']);
    expect(codes(await validate({ work: { ...settled, attemptId: 'att_unsettled' } }))).toEqual(['attempt_not_settled']);
    const unbound = await demand(ledger, { quoteId: 'q_unbound', recipients: ['peer_c0', 'peer_x'] });
    expect(codes(await validate({ work: unbound }))).toEqual(['contributor_not_bound', 'route_mismatch']);
    expect(codes(await validate({ work: settled, stages: ['peer_c1', 'peer_c0'] }))).toEqual(['route_mismatch', 'contributor_admission_invalid']);
    expect(codes(await validate({ work: settled, stageIndex: 0 }))).toEqual(expect.arrayContaining(['route_mismatch', 'contributor_admission_invalid']));
    expect(codes(await validate({ work: settled, receipt: { phase: 'failed' } }))).toEqual(['stage_not_executed']);
    expect(codes(await validate({ work: settled, receipt: { cleanup: 'unknown' } }))).toEqual(['stage_not_executed']);
    expect(codes(await validate({ work: settled, admission: { phase: 'reserved', settledAt: null } }))).toEqual(['contributor_admission_invalid']);
    expect(codes(await validate({ work: settled, requesterId: 'peer_c0' }))).toEqual(['requester_identity_mismatch']);
    expect(codes(await validate({ work: settled, ownerPolicyDigest: `sha256:${'d'.repeat(64)}` }))).toEqual(['owner_policy_mismatch']);
    expect(codes(await validate({ work: settled, execution: { schema: 'reploid.mesh.partition-summary/v2', identity: {} } }))).toEqual(['execution_invalid']);

    expect(await rewards.getValidation(invented.validationId)).toMatchObject({ outcome: 'rejected', issuanceStatus: 'not_eligible' });
    await rejectsWith(rewards.issueReward({ validationId: invented.validationId }), 'validation_rejected');
    expect(await journalShape(ledger, 'acct_c1')).toEqual([]);
    // Rejections take no claim: the honest claim for the same stage share still validates.
    expect(await validate({ work: settled })).toMatchObject({ outcome: 'accepted' });
  });

  it('rejects self-generated and linked demand under an explicit, configurable collusion rule', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const validate = (options) => rewards.validateWork(claimInput(options));
    for (const accountId of ['acct_c1', 'acct_alt', 'acct_linked']) await fund(ledger, accountId, 500);

    const own = await demand(ledger, { quoteId: 'q_own', accountId: 'acct_c1' });
    expect(await validate({ work: own, requesterId: 'peer_c1_phone' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }]
    });
    const sameOwner = await demand(ledger, { quoteId: 'q_same_owner', accountId: 'acct_alt' });
    expect(await validate({ work: sameOwner, requesterId: 'peer_alt' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('share an owner') }]
    });
    const ownStage = await demand(ledger, { quoteId: 'q_own_stage' });
    expect(codes(await validate({ work: ownStage, requesterId: 'peer_c1' }))).toEqual(['requester_identity_mismatch', 'self_dealing']);

    links.push({ a: 'acct_c1', b: 'acct_linked', kind: 'shared_payment_instrument', evidenceId: 'link:payment' });
    const linked = await demand(ledger, { quoteId: 'q_linked', accountId: 'acct_linked' });
    expect(await validate({ work: linked, requesterId: 'peer_linked' })).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'collusive_demand', details: { kinds: ['shared_payment_instrument'] } }]
    });

    // A link kind the policy does not name is retained as evidence but does not disqualify...
    links.push({ a: 'acct_req', b: 'acct_c1', kind: 'shared_household_network', evidenceId: 'link:network' });
    const household = await demand(ledger, { quoteId: 'q_household' });
    expect(await validate({ work: household })).toMatchObject({
      outcome: 'accepted', evidence: { links: [{ kind: 'shared_household_network', evidenceId: 'link:network' }] }
    });
    // ...until an explicit policy names it.
    const strict = harness.open({
      rewardPolicy: { ...REWARD_POLICY, rewardPolicyVersion: 'test-reward-policy/strict', collusion: { rejectLinkKinds: ['shared_household_network'] } }
    });
    await offerAndAccept(strict.rewards, { offerId: 'offer_c1_strict' });
    const strictWork = await demand(strict.ledger, { quoteId: 'q_household_strict' });
    expect(codes(await strict.rewards.validateWork(claimInput({ offerId: 'offer_c1_strict', work: strictWork }))))
      .toEqual(['collusive_demand']);
    expect((await ledger.getAccount('acct_c1')).byProvenance.earned.issued).toBe(0);
  });

  it('caps earned issuance by measured settled demand and fresh admitted capacity', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c0', accountId: 'acct_c0', participantId: 'peer_c0' });
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const first = await demand(ledger, { quoteId: 'q1' });
    const stage1 = await rewards.validateWork(claimInput({ work: first }));
    const stage0 = await rewards.validateWork(claimInput({ offerId: 'offer_c0', work: first, stageIndex: 0, raw: true }));
    expect([stage0.outcome, stage1.outcome]).toEqual(['accepted', 'accepted']);

    // Net settled spending is 30; a one-half demand share admits 15 earned credits in total.
    await rewards.issueReward({ validationId: stage1.validationId });
    await declinedWith(rewards.issueReward({ validationId: stage0.validationId }), 'demand_limit');
    expect(await rewards.getValidation(stage0.validationId)).toMatchObject({ issuanceStatus: 'pending' });
    expect(await rewards.listIssuanceDecisions()).toContainEqual(expect.objectContaining({
      allowed: false, reason: 'demand_limit', validationId: stage0.validationId,
      figures: expect.objectContaining({ measuredDemand: 30, demandLimit: 15, authorizedBefore: 10, authorizedAfter: 20 })
    }));
    await demand(ledger, { quoteId: 'q2', recipients: ['peer_c0', 'peer_x'] });
    expect(await rewards.resumeIssuance()).toEqual([expect.objectContaining({ validationId: stage0.validationId, status: 'issued' })]);

    // Outstanding obligations after issuance stay within admitted capacity coverage.
    const third = await demand(ledger, { quoteId: 'q3' });
    const pending = await rewards.validateWork(claimInput({ work: third }));
    const { outstanding } = await ledger.getSolvencySnapshot();
    capacity.serviceCredits = outstanding.total + 9;
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_limit');
    capacity.serviceCredits = outstanding.total + 10;
    capacity.observedAt = at(-11 * MIN);
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_evidence_stale');
    const fresh = capacity;
    capacity = null;
    await declinedWith(rewards.issueReward({ validationId: pending.validationId }), 'capacity_evidence_unavailable');
    capacity = { ...fresh, observedAt: null };
    expect(await rewards.issueReward({ validationId: pending.validationId })).toMatchObject({ status: 'issued', amount: 10 });

    // Concurrent issuance cannot overrun a limit: room for exactly one more 10-credit reward.
    const fourth = await demand(ledger, { quoteId: 'q4' });
    const fifth = await demand(ledger, { quoteId: 'q5' });
    const racing = [
      await rewards.validateWork(claimInput({ offerId: 'offer_c0', work: fourth, stageIndex: 0 })),
      await rewards.validateWork(claimInput({ work: fourth })),
      await rewards.validateWork(claimInput({ work: fifth }))
    ];
    capacity.serviceCredits = (await ledger.getSolvencySnapshot()).outstanding.total + 10;
    const outcomes = await Promise.allSettled(racing.map(({ validationId }) => rewards.issueReward({ validationId })));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason.details.reason))
      .toEqual(['capacity_limit', 'capacity_limit']);
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 40, allowances: 4 });
    expect((await ledger.getSolvencySnapshot()).issued.byProvenance.earned).toBe(40);

    // Other provenance needs its own decision owner; the reward authority does not allow it.
    const undelegated = harness.open({ otherProvenance: null });
    await declinedWith(fund(undelegated.ledger, 'acct_req', 5, 'purchase:undelegated'), 'provenance_not_governed');
  });

  it('keeps delivery, contracted storage and prepared availability disabled, and online time earns nothing', async () => {
    for (const category of ['verified_delivery', 'contracted_storage', 'prepared_availability']) {
      await expect(rewards.createOffer({ ...offerInput({ offerId: `offer_${category}`, category }), idempotencyKey: `offer:${category}` }))
        .rejects.toMatchObject({ code: 'reward_category_disabled', message: expect.stringContaining('pending the user\'s reward eligibility decision') });
    }
    for (const category of ['online_time', 'presence']) {
      await rejectsWith(rewards.createOffer({ ...offerInput({ offerId: `offer_${category}`, category }), idempotencyKey: `offer:${category}` }), 'presence_earns_nothing');
    }
    await expect(rewards.createOffer({
      ...offerInput({ offerId: 'offer_uptime', reward: { formula: { kind: 'metered', base: 0, rates: [{ meter: 'onlineSeconds', numerator: 1, denominator: 60 }] } } }),
      idempotencyKey: 'offer:uptime'
    })).rejects.toMatchObject({ code: 'invalid_offer', details: { errors: [expect.stringContaining('reward.formula.rates[0].meter must be one of settledCharge')] } });
    await rejectsWith(rewards.createOffer({
      ...offerInput({ offerId: 'offer_compensated', failureCompensation: { kind: 'fixed', amount: 1 } }), idempotencyKey: 'offer:compensated'
    }), 'failure_compensation_unsupported');

    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, enabledCategories: ['demanded_inference', 'contracted_storage'] }), 'reward_category_disabled');
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, enabledCategories: ['prepared_availability'] }), 'reward_category_disabled');
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, enabledCategories: ['online_time'] }), 'presence_earns_nothing');
    throwsWith(() => validateRewardPolicy({ ...REWARD_POLICY, collusion: undefined }), 'invalid_policy');
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, demand: undefined }), 'invalid_policy');
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, capacity: { coverage: { numerator: 1, denominator: 0 }, evidenceMaxAgeMs: 1 } }), 'invalid_policy');

    // A policy that enables no category disables demanded inference as well.
    const disabled = harness.open({ rewardPolicy: { ...REWARD_POLICY, rewardPolicyVersion: 'test-reward-policy/none', enabledCategories: [] } });
    await rejectsWith(disabled.rewards.createOffer({ ...offerInput({ offerId: 'offer_none' }), idempotencyKey: 'offer:none' }), 'reward_category_disabled');
  });

  it('expires offers and rejects work outside the accepted offer terms', async () => {
    const offer = await rewards.createOffer({ ...offerInput({ offerId: 'offer_late' }), idempotencyKey: 'offer:late' });
    const acceptLate = (overrides = {}) => rewards.acceptOffer({
      offerId: 'offer_late', accountId: 'acct_c1', offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: 'accept:late', ...overrides
    });
    await rejectsWith(acceptLate({ offerHash: 'sha256:altered', idempotencyKey: 'accept:altered' }), 'offer_terms_mismatch');
    await rejectsWith(acceptLate({ accountId: 'acct_c0', idempotencyKey: 'accept:other-account' }), 'participant_not_owned');
    await rejectsWith(acceptLate({ ownerAuthorization: undefined, idempotencyKey: 'accept:no-owner' }), 'owner_authorization_required');
    await rejectsWith(acceptLate({ ownerAuthorization: { ...ownerAuthorization, digest: `sha256:${'e'.repeat(64)}` }, idempotencyKey: 'accept:digest' }), 'owner_authorization_required');
    const ungranted = { ...OWNER_POLICY, authorization: { ...OWNER_POLICY.authorization, network: { ...OWNER_GRANT, granted: false } } };
    await rejectsWith(acceptLate({ ownerAuthorization: { policy: ungranted, digest: OWNER_DIGEST }, idempotencyKey: 'accept:ungranted' }), 'owner_authorization_required');
    advance(5 * MIN);
    await rejectsWith(acceptLate(), 'offer_expired');
    expect(await rewards.getOffer('offer_late')).toMatchObject({ status: 'offered', acceptance: null });

    // Work bound before acceptance cannot earn, even inside the offer's duration.
    const pendingOffer = await rewards.createOffer({ ...offerInput({ offerId: 'offer_c1' }), idempotencyKey: 'offer:c1' });
    const early = await demand(ledger, { quoteId: 'q_early', outcome: null });
    advance(1000);
    await rewards.acceptOffer({
      offerId: 'offer_c1', accountId: 'acct_c1', offerHash: pendingOffer.offerHash, ownerAuthorization, idempotencyKey: 'accept:c1'
    });
    await settle(ledger, early);
    expect(codes(await rewards.validateWork(claimInput({ work: early })))).toEqual(['work_precedes_offer']);

    // Work settled after the offer's duration.
    await offerAndAccept(rewards, { offerId: 'offer_short', duration: { startsAt: clock(), endsAt: at(2 * MIN) }, validUntil: at(MIN) });
    const late = await demand(ledger, { quoteId: 'q_late', outcome: null });
    advance(2.5 * MIN);
    await settle(ledger, late);
    expect(codes(await rewards.validateWork(claimInput({ offerId: 'offer_short', work: late })))).toEqual(['work_outside_offer_window']);

    // A claim after the claim window, and requested limits beyond the offer's resource bounds.
    await offerAndAccept(rewards, { offerId: 'offer_bounded', resourceBounds: { context: { max: 4096, unit: 'token' }, output: { max: 50, unit: 'token' } } });
    const stale = await demand(ledger, { quoteId: 'q_stale' });
    const oversized = await demand(ledger, { quoteId: 'q_oversized' });
    expect(codes(await rewards.validateWork(claimInput({ offerId: 'offer_bounded', work: oversized })))).toEqual(['work_exceeds_offer_bounds']);
    advance(31 * MIN);
    expect(codes(await rewards.validateWork(claimInput({ work: stale })))).toEqual(['claim_window_closed']);
    await rejectsWith(rewards.validateWork(claimInput({ offerId: 'offer_late', work: stale })), 'offer_not_accepted');
  });

  it('recovers restarts and crashes without lost or duplicated rewards', async () => {
    await offerAndAccept(rewards, { offerId: 'offer_c0', accountId: 'acct_c0', participantId: 'peer_c0' });
    await offerAndAccept(rewards, { offerId: 'offer_c1' });
    const work = await demand(ledger, { quoteId: 'q1' });
    await demand(ledger, { quoteId: 'q2' });

    // A crash before the validation commits retains nothing; the claim can be resubmitted.
    const stage1Claim = claimInput({ work, key: 'validate:stage1' });
    harness.faults.reward.beforeCommit = () => { throw new Error('simulated crash before reward commit'); };
    await expect(rewards.validateWork(stage1Claim)).rejects.toThrow('simulated crash before reward commit');
    const restarted = harness.open();
    const stage1 = await restarted.rewards.validateWork(stage1Claim);
    expect(stage1.outcome).toBe('accepted');

    // The ledger issued the lot, then the process died before the validation recorded it.
    harness.faults.ledger.afterCommit = () => { throw new Error('simulated crash after ledger commit'); };
    await expect(restarted.rewards.issueReward({ validationId: stage1.validationId })).rejects.toThrow('simulated crash after ledger commit');
    expect(await restarted.rewards.getValidation(stage1.validationId)).toMatchObject({ issuanceStatus: 'pending' });

    // The authority allowed issuance, then the ledger commit was lost.
    const stage0 = await restarted.rewards.validateWork(claimInput({ offerId: 'offer_c0', work, stageIndex: 0 }));
    harness.faults.ledger.beforeCommit = () => { throw new Error('simulated crash before ledger commit'); };
    await expect(restarted.rewards.issueReward({ validationId: stage0.validationId })).rejects.toThrow('simulated crash before ledger commit');

    const recovered = harness.open();
    const resumed = await recovered.rewards.resumeIssuance();
    expect(resumed.map((entry) => [entry.validationId, entry.status]).sort()).toEqual(
      [[stage0.validationId, 'issued'], [stage1.validationId, 'issued']].sort()
    );
    expect(await recovered.rewards.resumeIssuance()).toEqual([]);
    expect(await recovered.rewards.validateWork(stage1Claim)).toEqual(stage1);
    expect(await recovered.rewards.issueReward({ validationId: stage1.validationId })).toMatchObject({ status: 'issued', amount: 10 });
    expect(await journalShape(recovered.ledger, 'acct_c1')).toEqual([['issue', 10]]);
    expect(await journalShape(recovered.ledger, 'acct_c0')).toEqual([['issue', 10]]);
    expect(await recovered.rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 20, allowances: 2 });
    expect((await recovered.ledger.getSolvencySnapshot()).issued.byProvenance.earned).toBe(20);
    expect(await recovered.ledger.auditAccount('acct_c1')).toMatchObject({ consistent: true });
  });
});
