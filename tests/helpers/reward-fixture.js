// Shared contribution-reward test fixture. Test-only values; no product decisions.
import { expect } from 'vitest';

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
export const LEDGER_POLICY = Object.freeze({
  accountingVersion: 'test-accounting/1',
  contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID, documentRevision: 'test-document-revision' },
  unit: { name: 'credit', minorUnitsPerCredit: 1 },
  rounding: 'ceil',
  lotConsumptionOrder: ['community_access', 'earned', 'subsidized', 'donated', 'purchased'],
  transfers: { enabled: false }
});
export const REWARD_POLICY = Object.freeze({
  rewardPolicyVersion: 'test-reward-policy/1',
  validatorId: 'validator_test_demanded_inference',
  enabledCategories: ['demanded_inference', 'verified_delivery', 'contracted_storage', 'prepared_readiness'],
  collusion: { rejectLinkKinds: ['shared_payment_instrument'] }
});
export const ISSUANCE_POLICY = Object.freeze({
  policyId: 'test-issuance-limits/1',
  accountingVersion: 'test-accounting/1',
  bases: {
    settled_demand: { provenance: ['purchased', 'donated', 'community_access', 'earned'], share: { numerator: 1, denominator: 2 } },
    funded_reservation: { funderKinds: ['operator', 'community'] }
  },
  categoryBases: {
    demanded_inference: ['settled_demand'],
    verified_delivery: ['settled_demand'],
    contracted_storage: ['settled_demand', 'funded_reservation'],
    prepared_readiness: ['funded_reservation', 'settled_demand']
  },
  capacity: { coverage: { numerator: 1, denominator: 1 }, evidenceMaxAgeMs: 10 * 60_000 }
});
export const OWNER_GRANT = { granted: true, ownership: 'personal', grantedBy: 'owner_test' };
export const OWNER_POLICY = validateNativeOwnerPolicy({
  schema: NATIVE_OWNER_POLICY_SCHEMA,
  authorization: { equipment: OWNER_GRANT, network: OWNER_GRANT },
  sampleIntervalMs: 5000
}, { custody });
export const OWNER_DIGEST = nativeOwnerPolicyDigest(OWNER_POLICY);
export const ownerAuthorization = { policy: OWNER_POLICY, digest: OWNER_DIGEST };
export const MODEL = Object.freeze({ modelId: 'model_test', modelIdentity: `sha256:${'a'.repeat(64)}`, planId: `sha256:${'b'.repeat(64)}` });

export const START = Date.parse('2026-10-14T00:00:00.000Z');
export const MIN = 60_000;
// Mutable fixture state, reset before every test by openFixture().
export const fx = {
  nowMs: START, keySeq: 0, participants: new Map(), certificates: new Map(), links: [], capacity: null, randoms: [], prober: null
};
export const clock = () => new Date(fx.nowMs).toISOString();
export const at = (offsetMs) => new Date(fx.nowMs + offsetMs).toISOString();
export const advance = (ms) => { fx.nowMs += ms; };

// Authenticated identity port double: participant -> account, account links, and a stand-in
// for certificates in which a participant's persistent identity certifies a custody key.
export const identity = {
  participantAccount: async (participantId) => fx.participants.get(participantId) ?? null,
  verifyCustodyKey: async ({ certificate }) => fx.certificates.get(certificate?.certificateId) ?? null,
  accountLinks: async (left, right) => fx.links
    .filter((link) => (link.a === left && link.b === right) || (link.a === right && link.b === left))
    .map(({ kind, evidenceId }) => ({ kind, evidenceId }))
};
// Admitted-capacity evidence double; the execution owner would supply it.
export const readAdmittedCapacity = async () => fx.capacity && {
  schema: CAPACITY_EVIDENCE_SCHEMA,
  evidenceId: fx.capacity.evidenceId,
  accountingVersion: 'test-accounting/1',
  serviceCredits: fx.capacity.serviceCredits,
  observedAt: fx.capacity.observedAt ?? clock()
};
// Challenge targets: queued choices, else the first candidate.
export const random = (bound) => (fx.randoms.length ? fx.randoms.shift() : 0) % bound;
// Readiness prober seam; each test installs fx.prober.
export const readinessProber = {
  connect: (input) => fx.prober.connect(input),
  prepare: (input) => fx.prober.prepare(input),
  verify: (input) => fx.prober.verify(input)
};
// Purchases are outside reward policy; this double stands in for their decision owner.
export const otherProvenance = async ({ provenance }) => ({ allowed: true, decisionId: `test-funding:${provenance}` });
export const composition = {
  rewardPolicy: REWARD_POLICY, issuancePolicy: ISSUANCE_POLICY, identity, readAdmittedCapacity, otherProvenance, readinessProber, clock, random
};

export const once = (faults, point) => () => {
  const fault = faults[point];
  faults[point] = null;
  if (fault) fault();
};

// Each harness owns durable ledger and reward state; open() models a (re)started process.
export const harnesses = {
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

export const fund = (ledger, accountId, amount, purchaseId = `purchase:${accountId}:${amount}`) => ledger.issueCredits({
  accountId,
  provenance: 'purchased',
  amount,
  source: { processor: 'test-processor', purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: 1999, currency: 'USD' } },
  idempotencyKey: `issue:${purchaseId}`
});

export const quoteInput = ({ quoteId, accountId, service = {} }) => ({
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

export const settle = (ledger, work, outcome = 'full') => ledger.settleReservation({
  reservationId: work.reservationId,
  billableEventId: `bill:${work.reservationId}`,
  outcome,
  attemptId: work.attemptId,
  metering: { output: 40 },
  completedAt: clock(),
  idempotencyKey: `settle:${work.reservationId}`
});

/** A requester quote, acceptance and bound attempt; settled (charge 30) unless `outcome` is null. */
export const demand = async (ledger, { quoteId, accountId = 'acct_req', recipients = ['peer_c0', 'peer_c1'], outcome = 'full', service } = {}) => {
  const quote = await ledger.createQuote({ ...quoteInput({ quoteId, accountId, service }), idempotencyKey: `quote:${quoteId}` });
  const { reservationId } = await ledger.acceptQuote({
    quoteId, accountId, quoteHash: quote.quoteHash, deviceId: 'phone', idempotencyKey: `accept:${quoteId}`
  });
  const work = { reservationId, attemptId: `att_${quoteId}` };
  await ledger.bindAttempt({ reservationId, attemptId: work.attemptId, recipients, idempotencyKey: `bind:${quoteId}` });
  if (outcome) await settle(ledger, work, outcome);
  return work;
};

export const routeIdentity = ({ attemptId, requesterId, stages }) => ({
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
export const routeReceipt = (route, { phase = 'completed', cleanup = 'settled' } = {}) => ({
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
export const routeSummary = (route, options = {}) => ({
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
export const routeExecution = (route, options = {}) => ({
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
export const admissionRecord = (route, index, overrides = {}) => ({
  identity: route, participantId: route.route.stages[index].participantId, index, phase: 'settled',
  reservedAt: START, settlingAt: START, settledAt: START, failure: null,
  resources: { attemptSlots: 1, scope: 'application-attempt-limits' }, ...overrides
});

export const claimInput = ({
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
    idempotencyKey: key ?? `validate:${(fx.keySeq += 1)}`
  };
};

export const offerInput = ({ offerId, accountId = 'acct_c1', participantId = 'peer_c1', category = 'demanded_inference', reward = {}, ...overrides } = {}) => ({
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

export const offerAndAccept = async (rewards, options) => {
  const offer = await rewards.createOffer({ ...offerInput(options), idempotencyKey: `offer:${options.offerId}` });
  const acceptance = await rewards.acceptOffer({
    offerId: offer.offerId, accountId: offer.accountId, offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: `accept-offer:${offer.offerId}`
  });
  return { offer, acceptance };
};

export const codes = (validation) => validation.reasons.map((reason) => reason.code);
export const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code });
export const declinedWith = (promise, reason) => expect(promise).rejects.toMatchObject({ code: 'issuance_not_authorized', details: { reason } });
export const throwsWith = (operation, code) => {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
};
export const journalShape = async (ledger, accountId) => (await ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);

export const ACCOUNTS = Object.freeze([
  ['acct_req', 'uid_req'], ['acct_c0', 'uid_c0'], ['acct_c1', 'uid_c1'], ['acct_alt', 'uid_c1'], ['acct_linked', 'uid_linked'],
  ['acct_acq', 'uid_acq'], ['acct_acq2', 'uid_acq2'], ['acct_operator', 'uid_operator']
]);

/** Reset fixture state, open a harness of `kind`, open the test accounts and fund the requester. */
export async function openFixture(kind) {
  fx.nowMs = START;
  fx.keySeq = 0;
  fx.participants = new Map([
    ['peer_req', 'acct_req'], ['peer_c0', 'acct_c0'], ['peer_c1', 'acct_c1'], ['peer_c1_phone', 'acct_c1'],
    ['peer_alt', 'acct_alt'], ['peer_linked', 'acct_linked'], ['peer_acq', 'acct_acq'], ['peer_acq2', 'acct_acq2']
  ]);
  fx.certificates = new Map();
  fx.prober = { connect: async () => { throw new Error('no prober installed'); } };
  fx.links = [];
  fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
  fx.randoms = [];
  const harness = harnesses[kind]();
  const { ledger, rewards } = harness.open();
  for (const [accountId, ownerId] of ACCOUNTS) await ledger.openAccount({ accountId, ownerId });
  await fund(ledger, 'acct_req', 1000);
  return { harness, ledger, rewards };
}
