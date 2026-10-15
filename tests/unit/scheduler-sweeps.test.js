import { MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/domain.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { CAPACITY_EVIDENCE_SCHEMA as COMMUNITY_CAPACITY_SCHEMA } from '../../server/community-access/domain.js';
import { createCommunityAccess, createFundingIssuanceAuthority } from '../../server/community-access/engine.js';
import { createFirestoreCommunityAccessBackend, createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { createPaymentStore, createPurchaseIssuanceAuthority } from '../../server/payments/engine.js';
import { createFirestorePaymentBackend, createMemoryPaymentBackend } from '../../server/payments/stores.js';
import { createTestPaymentProcessor } from '../../server/payments/test-processor.js';
import { composeContributionRewards } from '../../server/rewards/engine.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend } from '../../server/rewards/stores.js';
import { createScheduler } from '../../server/scheduler/engine.js';
import { composeScheduler, runScheduler, runSchedulerPass } from '../../server/scheduler/operator.js';
import { SCHEDULER_OPERATIONS, validateSchedulerContract } from '../../server/scheduler/store-contract.js';
import { createFirestoreSchedulerBackend, createMemorySchedulerBackend } from '../../server/scheduler/stores.js';
import { createSweepJobs } from '../../server/scheduler/sweeps.js';
import { conversionAuthority } from '../helpers/conversion-fixture.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import {
  LEDGER_POLICY, MIN, START, advance, at, clock, commit, composition, decidedBy, demand, fund, fx, otherProvenance, quoteInput, rejectsWith
} from '../helpers/reward-fixture.js';
import { balanceSnapshot, byJob, dyingBeforeFinish, expectBalancesKept } from '../helpers/scheduler-fixture.js';

// Test-only values. No interval, batch size, lease, price, rate or limit here is an operational or product decision.
const DAY = 24 * 60 * MIN;
const ACCESS_POLICY = Object.freeze({
  policyVersion: 'test-community/1',
  poolAccountId: 'pool_general',
  guarantee: { mode: 'none' },
  queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 10 * MIN },
  usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
  rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 4 } },
  capacity: { evidenceMaxAgeMs: 5 * MIN },
  // Test-only evidence terms Community Access quotes carry.
  evidence: { rulesId: EVIDENCE_RULES_ID, windowMs: 5 * MIN, clockSkewMs: 30_000, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS }
});
const PAYMENT_POLICY = Object.freeze({
  policyVersion: 'test-payments/1',
  processorId: 'test-processor',
  topUps: [{ topUpId: 'test-topup', price: { amountMinor: 500, currency: 'USD' } }],
  polling: { minAgeMs: MIN, reversalWatchMs: DAY }
});
const SWEEPS = ['ledger.settleDueEvidence', 'ledger.expireReservations', 'ledger.expireAllocations', 'rewards.resumeFunding', 'rewards.resumeIssuance',
  'community-access.resumeFunding', 'community-access.expireQueue', 'payments.pollPending', 'community-access.admitWaiting'];
const schedule = ({ batchLimit = 10, intervalMs = 5 * MIN, only = SWEEPS } = {}) => ({
  scheduleVersion: 'test-schedule/1',
  leaseMs: 2 * MIN,
  jobs: Object.fromEntries(only.map((jobId) => [jobId, { intervalMs, batchLimit }]))
});
const COMPONENTS = ['ledger', 'reward', 'community', 'payments', 'scheduler'];
const ACCOUNTS = [['acct_req', 'uid_req'], ['acct_c1', 'uid_c1'], ['acct_m1', 'uid_m1'], ['acct_m2', 'uid_m2'], ['acct_buyer', 'uid_buyer']];
const crash = (message) => () => { throw new Error(message); };
const fireOnce = (faults, point) => () => {
  const fault = faults[point];
  faults[point] = null;
  if (fault) fault();
};

// Durable state per component; every open() models a (re)started process over it.
const harnesses = {
  memory: () => {
    const states = Object.fromEntries(COMPONENTS.map((name) => [name, createMemoryLedgerState()]));
    const faults = Object.fromEntries(COMPONENTS.map((name) => [name, { beforeCommit: null, afterCommit: null }]));
    const hooks = (name) => ({ beforeCommit: fireOnce(faults[name], 'beforeCommit'), afterCommit: fireOnce(faults[name], 'afterCommit') });
    return {
      faults,
      ledger: (options) => createMemoryLedgerStore({ state: states.ledger, hooks: hooks('ledger'), policy: LEDGER_POLICY, clock, conversionAuthority, ...options }),
      reward: () => createMemoryRewardBackend({ state: states.reward, hooks: hooks('reward') }),
      community: () => createMemoryCommunityAccessBackend({ state: states.community, hooks: hooks('community') }),
      payments: () => createMemoryPaymentBackend({ state: states.payments, hooks: hooks('payments') }),
      scheduler: () => createMemorySchedulerBackend({ state: states.scheduler, hooks: hooks('scheduler') })
    };
  },
  firestore: () => {
    const dbs = Object.fromEntries(COMPONENTS.map((name) => [name, createFakeFirestore()]));
    return {
      faults: Object.fromEntries(COMPONENTS.map((name) => [name, dbs[name].faults])),
      ledger: (options) => createFirestoreLedgerStore({ firestore: dbs.ledger, collectionPrefix: 'test', policy: LEDGER_POLICY, clock, conversionAuthority, ...options }),
      reward: () => createFirestoreRewardBackend({ firestore: dbs.reward, collectionPrefix: 'test' }),
      community: () => createFirestoreCommunityAccessBackend({ firestore: dbs.community, collectionPrefix: 'test' }),
      payments: () => createFirestorePaymentBackend({ firestore: dbs.payments, collectionPrefix: 'test' }),
      scheduler: () => createFirestoreSchedulerBackend({ firestore: dbs.scheduler, collectionPrefix: 'test' })
    };
  }
};

const accountsPort = { participantAccount: async (participantId) => fx.participants.get(participantId) ?? null };
const readCommunityCapacity = async () => ({ schema: COMMUNITY_CAPACITY_SCHEMA, evidenceId: 'community-capacity:test', observedAt: clock(), admittedSlots: 1 });

/** One process: ledger, rewards, Community Access and payments over their own stores, with the sweep scheduler. */
const openServices = (harness, processor) => {
  const communityBackend = harness.community();
  const paymentBackend = harness.payments();
  const poolAuthority = createFundingIssuanceAuthority({ backend: communityBackend, policy: ACCESS_POLICY });
  const purchaseAuthority = createPurchaseIssuanceAuthority({ backend: paymentBackend });
  const rewardBackend = harness.reward();
  const { ledger, rewards } = composeContributionRewards({
    ...composition,
    backend: rewardBackend,
    createLedger: ({ issuanceAuthority }) => harness.ledger({ issuanceAuthority, fundingAuthority: composition.fundingAuthority }),
    otherProvenance: (request) => {
      if (request.provenance === 'community_access') return poolAuthority(request);
      if (request.provenance === 'purchased' && request.source?.checkoutId) return purchaseAuthority(request);
      return otherProvenance(request);
    }
  });
  const access = createCommunityAccess({
    backend: communityBackend, ledger, accounts: accountsPort, readCommunityCapacity, policy: ACCESS_POLICY, fundingAuthority: composition.fundingAuthority, clock
  });
  const payments = createPaymentStore({ backend: paymentBackend, ledger, processor, accounts: accountsPort, policy: PAYMENT_POLICY, clock });
  return { ledger, rewards, access, payments, rewardBackend };
};

// An accepted readiness validation awaiting issuance, with the fields allocation and issuance read.
const pendingValidation = (backend, validationId, amount) => backend.runTransaction(async (tx) => {
  tx.create('validations', validationId, {
    validationId, outcome: 'accepted', issuanceStatus: 'pending', category: 'prepared_readiness', ledgerCategory: 'readiness',
    validatorId: composition.rewardPolicy.validatorId, rewardPolicyVersion: composition.rewardPolicy.rewardPolicyVersion,
    workId: `rdy_${validationId}`, workRefs: {}, reward: { amount }, validatedAt: clock(),
    offer: { offerId: `offer_${validationId}`, offerHash: 'sha256:offer', accountId: 'acct_c1', participantId: 'peer_c1' }
  });
});

const poolFunding = (access, fundingId, commitmentId, quantity) => access.recordFunding({
  fundingId, commitmentId, quantity, poolAccountId: 'pool_general', authority: decidedBy(`decision:${fundingId}`)
});
const askAccess = (access, member, requestId) => access.requestAccess({
  requestId, participantId: `peer_${member}`, deviceId: `${member}-phone`,
  quote: (({ service, pricing, terms }) => ({ service, pricing, terms }))(quoteInput({ quoteId: requestId, accountId: 'pool_general' }))
});
const releases = async (ledger, accountId) => (await ledger.listJournal(accountId)).filter((entry) => entry.type === 'release').length;

describe.each(Object.keys(harnesses))('durable scheduler sweeps (%s store)', (kind) => {
  let harness;
  let processor;
  let services;
  const open = () => openServices(harness, processor);
  const scheduler = (runnerId, options = {}, backend = harness.scheduler()) => composeScheduler({
    backend, schedule: schedule(options), runnerId, services, clock
  });

  beforeEach(async () => {
    fx.nowMs = START;
    fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
    fx.participants = new Map([['peer_m1', 'acct_m1'], ['peer_m2', 'acct_m2'], ['peer_buyer', 'acct_buyer'], ['peer_c1', 'acct_c1']]);
    harness = harnesses[kind]();
    processor = createTestPaymentProcessor({ id: 'test-processor', clock, signatureToleranceMs: 5 * MIN, checkoutTtlMs: DAY });
    services = open();
    for (const [accountId, ownerId] of ACCOUNTS) await services.ledger.openAccount({ accountId, ownerId });
    await fund(services.ledger, 'acct_req', 1000);
  });

  it('implements the scheduler contract over an explicit schedule naming registered jobs only', async () => {
    const runner = scheduler('runner_a');
    expect(validateSchedulerContract(runner)).toEqual({ ok: true, missing: [] });
    expect(SCHEDULER_OPERATIONS).toContain('runOnce');
    expect(Object.keys(runner.schedule.jobs)).toEqual(SWEEPS);
    const jobs = createSweepJobs(services);
    expect(Object.keys(jobs).sort()).toEqual([...SWEEPS].sort());
    const build = (value) => () => createScheduler({ backend: harness.scheduler(), schedule: value, jobs, runnerId: 'runner_a', clock });
    expect(build(undefined)).toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
    expect(build({ ...schedule(), jobs: { 'ledger.expireEverything': { intervalMs: MIN, batchLimit: 1 } } }))
      .toThrow(expect.objectContaining({ code: 'invalid_schedule', details: { errors: [expect.stringContaining('names no registered job')] } }));
    expect(build({ ...schedule(), jobs: { 'ledger.expireReservations': { intervalMs: 0, batchLimit: 5000 } } }))
      .toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
    expect(build({ ...schedule(), leaseMs: undefined })).toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
  });

  it('runs every sweep as a recorded pass that expires only holds, allocations and queue entries, never balances', async () => {
    const { ledger, rewards, access, payments, rewardBackend } = services;
    // A hold whose reservation period will lapse.
    await demand(ledger, { quoteId: 'q_hold', accountId: 'acct_req', outcome: null });
    // Reward funding that expires with its commitment, and a validation waiting to draw on it.
    await commit(ledger, { commitmentId: 'c_reward', amount: 50, validForMs: 15 * MIN });
    await rewards.reserveFunding({
      fundingId: 'f_reward', commitmentId: 'c_reward', amount: 20, categories: ['prepared_readiness'], authority: decidedBy('decision:f_reward'), idempotencyKey: 'reserve:f_reward'
    });
    await pendingValidation(rewardBackend, 'val_1', 5);
    // Donated credit allocated but never issued before its commitment lapses.
    await commit(ledger, { commitmentId: 'c_donor', funderKind: 'donor', amount: 30, validForMs: 15 * MIN });
    const donation = await ledger.allocateFunding({
      commitmentId: 'c_donor', use: 'donated_credit', useRef: 'donation_1', credits: 30, accountId: 'acct_c1',
      authority: decidedBy('decision:donation_1'), funderKinds: ['donor'], idempotencyKey: 'allocate:donation_1'
    });
    // Community Access: one complete pool funding, one interrupted before the register commit, one admitted and one queued member.
    await commit(ledger, { commitmentId: 'c_pool', funderKind: 'donor', amount: 200, validForMs: 30 * DAY });
    await poolFunding(access, 'pool_a', 'c_pool', 150);
    harness.faults.ledger.beforeCommit = crash('simulated crash before the pool allocation');
    await expect(poolFunding(access, 'pool_b', 'c_pool', 50)).rejects.toThrow('simulated crash before the pool allocation');
    expect(await access.getFunding('pool_b')).toMatchObject({ status: 'allocating' });
    expect(await askAccess(access, 'm1', 'r_m1')).toMatchObject({ state: 'available' });
    expect(await askAccess(access, 'm2', 'r_m2')).toMatchObject({ state: 'queued' });
    // A paid purchase whose notification never arrived.
    const checkout = await payments.startCheckout({ participantId: 'peer_buyer', topUpId: 'test-topup', idempotencyKey: 'buy:1' });
    processor.pay(checkout.purchaseId);

    const accounts = ['acct_req', 'acct_c1', 'acct_m1', 'acct_m2', 'acct_buyer', 'pool_general'];
    const initial = await balanceSnapshot(ledger, accounts);
    const runner = scheduler('runner_a');

    advance(MIN);
    const first = byJob(await runner.runOnce());
    expect(Object.values(first).map((result) => result.status)).toEqual(SWEEPS.map(() => 'completed'));
    expect(first['rewards.resumeIssuance']).toMatchObject({ counts: { processed: 1, succeeded: 1, failed: 0 }, backlog: false });
    expect(first['community-access.resumeFunding']).toMatchObject({ counts: { processed: 1, succeeded: 1 } });
    expect(first['payments.pollPending']).toMatchObject({ counts: { processed: 1, succeeded: 1 } });
    expect(first['ledger.expireReservations']).toMatchObject({ counts: { processed: 0 } });
    expect(await access.getFunding('pool_b')).toMatchObject({ status: 'issued' });
    expect(await payments.getPayment(checkout.checkoutId)).toMatchObject({ phase: 'issued', credits: 500 });
    expect(await rewards.getValidation('val_1')).toMatchObject({ issuanceStatus: 'issued' });
    const afterFirst = await balanceSnapshot(ledger, accounts);
    expectBalancesKept(initial, afterFirst);

    // Nothing is due again until each job's interval passes.
    expect(Object.values(byJob(await runner.runOnce())).map((result) => result.status)).toEqual(SWEEPS.map(() => 'not_due'));

    advance(15 * MIN);
    const second = byJob(await runner.runOnce());
    // The Community Access hold carries evidence terms: with no evidence kept, its window decision releases it before expiry would.
    expect(second['ledger.settleDueEvidence']).toMatchObject({ status: 'completed', counts: { processed: 1 } });
    expect(second['ledger.expireReservations']).toMatchObject({ status: 'completed', counts: { processed: 1 } });
    expect(second['ledger.expireAllocations']).toMatchObject({ counts: { processed: 1 } });
    expect(second['rewards.resumeFunding']).toMatchObject({ counts: { processed: 1 } });
    expect(second['community-access.expireQueue']).toMatchObject({ counts: { processed: 1 } });
    expect(await ledger.getFundingAllocation(donation.allocationId)).toMatchObject({ status: 'expired', issuedCredits: 0, returnedCredits: 30 });
    expect(await rewards.getFunding('f_reward')).toMatchObject({ status: 'expired', consumedCredits: 5, returned: 15 });
    expect(await access.getRequest('r_m2')).toMatchObject({ state: 'unavailable', reason: 'queue_wait_exceeded' });
    const afterSecond = await balanceSnapshot(ledger, accounts);
    expectBalancesKept(afterFirst, afterSecond);
    expect(afterSecond.acct_req).toMatchObject({ held: 0, outstanding: afterFirst.acct_req.outstanding });
    expect(afterSecond.pool_general).toMatchObject({ held: 0, outstanding: afterFirst.pool_general.outstanding });
    // Issued, nonexpiring credit is intact: subsidized, purchased and pool lots keep every credit.
    expect(afterSecond.acct_c1.byProvenance.subsidized).toMatchObject({ issued: 5, available: 5 });
    expect(afterSecond.acct_buyer.byProvenance.purchased).toMatchObject({ issued: 500, available: 500 });

    // Repeat: the same work is never applied twice.
    advance(15 * MIN);
    const journals = await Promise.all(accounts.map((accountId) => ledger.listJournal(accountId)));
    const third = byJob(await runner.runOnce());
    expect(Object.values(third).map((result) => result.status)).toEqual(SWEEPS.map(() => 'completed'));
    for (const jobId of SWEEPS.filter((id) => id !== 'payments.pollPending')) expect(third[jobId].counts.processed).toBe(0);
    expect(await balanceSnapshot(ledger, accounts)).toEqual(afterSecond);
    expect(await Promise.all(accounts.map((accountId) => ledger.listJournal(accountId)))).toEqual(journals);
    for (const accountId of accounts) expect(await ledger.auditAccount(accountId)).toMatchObject({ consistent: true });

    // Every pass is recorded with its runner, schedule version, items and next due time.
    const passes = await runner.listPasses({ jobId: 'ledger.expireReservations' });
    expect(passes.map((pass) => [pass.seq, pass.status, pass.counts.processed])).toEqual([[3, 'completed', 0], [2, 'completed', 1], [1, 'completed', 0]]);
    expect(passes[1]).toMatchObject({
      runnerId: 'runner_a', scheduleVersion: 'test-schedule/1', backlog: false, batchLimit: 10,
      items: [expect.objectContaining({ status: 'expired' })],
      nextDueAt: new Date(Date.parse(passes[1].startedAt) + 5 * MIN).toISOString()
    });
    expect(await runner.getJob('ledger.expireReservations')).toMatchObject({ passes: 3, lease: null, lastPass: { status: 'completed' }, consecutiveFailures: 0 });
  });

  it('lets one of several concurrent runners take each job, with no second effect', async () => {
    const { ledger } = services;
    for (const quoteId of ['q1', 'q2', 'q3']) await demand(ledger, { quoteId, accountId: 'acct_req', outcome: null });
    advance(11 * MIN);
    const runners = ['runner_a', 'runner_b', 'runner_c'].map((runnerId) => scheduler(runnerId, { only: ['ledger.expireReservations', 'payments.pollPending'] }));
    const rounds = await Promise.all(runners.map((runner) => runner.runOnce()));
    for (const jobId of ['ledger.expireReservations', 'payments.pollPending']) {
      const outcomes = rounds.map((round) => byJob(round)[jobId].status);
      expect(outcomes.filter((status) => status === 'completed')).toHaveLength(1);
      expect(outcomes.filter((status) => status === 'completed').length + outcomes.filter((status) => ['lease_held', 'not_due'].includes(status)).length).toBe(3);
    }
    expect(await releases(ledger, 'acct_req')).toBe(3);
    const passes = await runners[0].listPasses({ jobId: 'ledger.expireReservations' });
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ status: 'completed', counts: { processed: 3 } });
    expect(await ledger.getAccount('acct_req')).toMatchObject({ held: 0, available: 1000 });
  });

  it('recovers a pass whose runner died, and a pass that failed part way, without a second effect', async () => {
    const { ledger } = services;
    for (const quoteId of ['q1', 'q2']) await demand(ledger, { quoteId, accountId: 'acct_req', outcome: null });
    advance(11 * MIN);
    // Runner A releases both holds, then dies before recording its pass: the lease and a running pass remain.
    const dying = scheduler('runner_a', { only: ['ledger.expireReservations'] }, dyingBeforeFinish(harness.scheduler()));
    await expect(dying.runOnce()).rejects.toThrow('simulated process death');
    expect(await releases(ledger, 'acct_req')).toBe(2);
    const restarted = scheduler('runner_b', { only: ['ledger.expireReservations'] });
    expect(await restarted.getJob('ledger.expireReservations')).toMatchObject({ lease: { runnerId: 'runner_a' } });
    expect(byJob(await restarted.runOnce())['ledger.expireReservations']).toMatchObject({ status: 'lease_held', holder: 'runner_a' });
    // After the lease expires the next runner records the dead pass as abandoned and runs again; nothing is left to release.
    advance(2 * MIN);
    expect(byJob(await restarted.runOnce())['ledger.expireReservations']).toMatchObject({ status: 'completed', counts: { processed: 0 } });
    const [rerun, abandoned] = await restarted.listPasses({ jobId: 'ledger.expireReservations' });
    expect(abandoned).toMatchObject({ seq: 1, runnerId: 'runner_a', status: 'abandoned', abandonedBy: { runnerId: 'runner_b', passId: rerun.passId } });
    expect(rerun).toMatchObject({ seq: 2, runnerId: 'runner_b', recovered: { passId: abandoned.passId, runnerId: 'runner_a' } });
    expect(await releases(ledger, 'acct_req')).toBe(2);

    // A crash after the first of two releases fails the pass part way; the next pass finishes the rest once.
    for (const quoteId of ['q3', 'q4']) await demand(ledger, { quoteId, accountId: 'acct_req', outcome: null });
    advance(11 * MIN);
    harness.faults.ledger.afterCommit = crash('simulated crash after the first release');
    expect(byJob(await restarted.runOnce())['ledger.expireReservations']).toMatchObject({
      status: 'failed', error: { code: 'job_failed', message: 'simulated crash after the first release' }
    });
    expect(await releases(ledger, 'acct_req')).toBe(3);
    expect(await restarted.getJob('ledger.expireReservations')).toMatchObject({ lease: null, consecutiveFailures: 1, lastPass: { status: 'failed' } });
    advance(5 * MIN);
    expect(byJob(await restarted.runOnce())['ledger.expireReservations']).toMatchObject({ status: 'completed', counts: { processed: 1 } });
    expect(await releases(ledger, 'acct_req')).toBe(4);
    expect(await ledger.getAccount('acct_req')).toMatchObject({ held: 0, available: 1000 });
    expect(await ledger.auditAccount('acct_req')).toMatchObject({ consistent: true });
  });

  it('runs from the operator entry points: one pass, or rounds that sleep until the next due time', async () => {
    const { ledger } = services;
    await demand(ledger, { quoteId: 'q1', accountId: 'acct_req', outcome: null });
    const options = { backend: harness.scheduler(), schedule: schedule({ only: ['ledger.expireReservations'] }), services, clock };
    expect(await runSchedulerPass({ ...options, runnerId: 'operator_once' })).toEqual([expect.objectContaining({ status: 'completed', counts: expect.objectContaining({ processed: 0 }) })]);
    const waits = [];
    const wait = async (ms) => {
      waits.push(ms);
      advance(ms);
    };
    expect(await runScheduler({ ...options, runnerId: 'operator_loop', wait, maxRounds: 3 })).toEqual({ rounds: 3 });
    // Each sleep lasts until the job is next due; the hold lapses during them and is released once.
    expect(waits).toEqual([5 * MIN, 5 * MIN]);
    expect(await releases(ledger, 'acct_req')).toBe(1);
    const controller = new AbortController();
    controller.abort();
    expect(await runScheduler({ ...options, runnerId: 'operator_stopped', wait, signal: controller.signal })).toEqual({ rounds: 0 });
  });

  it('bounds every pass by its batch limit and comes back for the backlog', async () => {
    const { ledger } = services;
    for (const quoteId of ['q1', 'q2', 'q3']) await demand(ledger, { quoteId, accountId: 'acct_req', outcome: null });
    advance(11 * MIN);
    const runner = scheduler('runner_a', { only: ['ledger.expireReservations'], batchLimit: 1 });
    const results = [];
    for (let round = 0; round < 4; round += 1) results.push(byJob(await runner.runOnce())['ledger.expireReservations']);
    expect(results.map((result) => [result.counts.processed, result.backlog])).toEqual([[1, true], [1, true], [1, true], [0, false]]);
    expect(await releases(ledger, 'acct_req')).toBe(3);
    const job = await runner.getJob('ledger.expireReservations');
    expect(job.nextDueAt).toBe(new Date(fx.nowMs + 5 * MIN).toISOString());
    expect(byJob(await runner.runOnce())['ledger.expireReservations']).toMatchObject({ status: 'not_due' });
    await rejectsWith(runner.runJob('ledger.unknown'), 'unknown_job');
    expect(at(0)).toBe(clock());
  });
});
