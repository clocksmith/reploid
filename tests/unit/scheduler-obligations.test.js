import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryLedgerState } from '../../server/ledger/memory-store.js';
import { OBLIGATION_JOB_ID, createObligationJob } from '../../server/scheduler/obligations.js';
import { composeScheduler } from '../../server/scheduler/operator.js';
import { createFirestoreSchedulerBackend, createMemorySchedulerBackend } from '../../server/scheduler/stores.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { MIN, MODEL, START, at, clock, fx, openFixture, ownerAuthorization, routeIdentity } from '../helpers/reward-fixture.js';
import { byJob, dyingBeforeFinish } from '../helpers/scheduler-fixture.js';

// Test-only contract terms, intervals, batch sizes and leases; none is a product or operational decision.
const toMs = (iso) => Date.parse(iso);
const OPTIONS = Object.freeze({
  kinds: { contracted_storage: ['custody', 'service'], prepared_readiness: ['execution'] },
  issueWindow: { numerator: 1, denominator: 2 }
});
const schedule = ({ batchLimit = 20, options = OPTIONS } = {}) => ({
  scheduleVersion: 'test-obligations/1', leaseMs: 2 * MIN, jobs: { [OBLIGATION_JOB_ID]: { intervalMs: MIN, batchLimit, options } }
});
const INTERVAL = 10 * MIN;
const digest = (value) => `sha256:${value.toString(16).padStart(64, '0')}`;
const piece = (index) => ({
  artifactId: `model/part-${index}.bin`, hash: digest(1000 + index), sizeBytes: 128,
  chunks: [0, 1].map((chunk) => ({ index: chunk, offset: chunk * 64, sizeBytes: 64, hash: digest(index * 10 + chunk) }))
});
const contractTerms = (offerId, work, { resourceBounds, obligations, voidWhen }) => ({
  offerId,
  accountId: 'acct_c1',
  work,
  reward: {
    basis: { kind: 'test_per_verified_interval' },
    formula: { kind: 'metered', base: 0, rates: [{ meter: 'verifiedIntervals', numerator: 2, denominator: 1 }] },
    maxReward: 50, deductions: null, voidWhen
  },
  resourceBounds,
  obligations,
  duration: { startsAt: clock(), endsAt: at(4 * INTERVAL) },
  validUntil: at(5 * MIN),
  paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
  failureCompensation: { kind: 'none' }
});
const storageTerms = () => contractTerms('offer_storage', {
  category: 'contracted_storage', participantId: 'peer_c1', contractedBy: 'acct_operator', contractType: 'accessible_delivery', pieces: [piece(1), piece(2)]
}, {
  resourceBounds: { custodyBytes: { max: 1024, unit: 'byte' } },
  obligations: { intervalMs: INTERVAL, responseWindowMs: MIN, serviceWindowMs: 5 * MIN },
  voidWhen: { minVerifiedIntervals: 0, maxOutageIntervals: 4, maxMissedChallenges: 8, maxFailedChallenges: 8, maxFailedServiceRequests: 8 }
});
const readinessTerms = () => contractTerms('offer_ready', {
  category: 'prepared_readiness', participantId: 'peer_c1', contractedBy: 'acct_operator', stage: { model: { ...MODEL }, stageIndex: 1 }
}, {
  resourceBounds: { attemptSlots: { max: 2, unit: 'attempt' } },
  obligations: { intervalMs: INTERVAL, responseWindowMs: MIN },
  voidWhen: { minVerifiedIntervals: 0, maxOutageIntervals: 4, maxMissedChallenges: 8, maxFailedChallenges: 8 }
});
const accept = async (rewards, terms) => {
  const offer = await rewards.createOffer({ ...terms, idempotencyKey: `offer:${terms.offerId}` });
  await rewards.acceptOffer({ offerId: offer.offerId, accountId: offer.accountId, offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: `accept:${offer.offerId}` });
  return rewards.getOffer(offer.offerId);
};

/** A contributor stage reached through the readiness prober port; the probe's own path reserves, executes and settles. */
const installStage = (log) => {
  const device = {
    id: 'peer_c1', transportId: 'transport_peer_c1', residentId: 'resident_peer_c1', executionId: 'execution_peer_c1',
    reserve: async ({ identity }) => {
      log.reserved.push(identity.attemptId);
      return { identity, partitionIndex: 1, status: 'reserved' };
    },
    executeStage: async ({ identity }) => ({ identity, partitionIndex: 1, step: 0, tokenPosition: 0 }),
    closeAttempt: async ({ identity }) => { log.closed.push(identity.attemptId); }
  };
  fx.prober = {
    connect: async () => {
      log.connected += 1;
      return device;
    },
    prepare: async ({ attemptIds }) => ({
      identities: attemptIds.map((attemptId) => routeIdentity({ attemptId, requesterId: 'prober', stages: ['prober', 'peer_c1', 'probe_tail'] })),
      request: { inputTokenCount: 1, maxTokens: 1, generationDigest: digest(7), generation: { maxTokens: 1 } }
    }),
    verify: async () => ({ ok: true, method: 'test-reference', detail: null })
  };
};

const schedulerHarnesses = {
  memory: () => {
    const state = createMemoryLedgerState();
    return () => createMemorySchedulerBackend({ state });
  },
  firestore: () => {
    const firestore = createFakeFirestore();
    return () => createFirestoreSchedulerBackend({ firestore, collectionPrefix: 'test' });
  }
};

const intervalOf = (offer, challenge) => Math.floor((toMs(challenge.issuedAt) - toMs(offer.duration.startsAt)) / INTERVAL);
const perInterval = (offer, challenges) => challenges.reduce((counts, challenge) => {
  const key = `${challenge.kind}:${intervalOf(offer, challenge)}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

describe.each(Object.keys(schedulerHarnesses))('durable scheduler obligations (%s store)', (kind) => {
  let harness;
  let rewards;
  let schedulerBackend;
  let log;
  let transport;
  let acquirer;
  let fraction;
  let storage;
  let readiness;

  const obligations = () => ({
    transport,
    selectAcquirer: async () => acquirer.value,
    // Unpredictable issue time: a fixed fraction of the drawing span, so the test can check the stored due time.
    random: (span) => Math.min(span - 1, Math.floor(span * fraction.value))
  });
  const runner = (runnerId, { backend = schedulerBackend(), services = { rewards }, ...options } = {}) => composeScheduler({
    backend, schedule: schedule(options), runnerId, services, obligations: obligations(), clock
  });
  const slots = async () => (await schedulerBackend().list('slots'))
    .sort((left, right) => left.offerId.localeCompare(right.offerId) || left.kind.localeCompare(right.kind) || left.intervalIndex - right.intervalIndex);
  const statusOf = async () => (await slots()).map((slot) => `${slot.offerId}:${slot.kind}:${slot.intervalIndex}:${slot.status}`);
  const at0 = (offsetMs) => { fx.nowMs = START + offsetMs; };

  beforeEach(async () => {
    ({ harness, rewards } = await openFixture(kind));
    schedulerBackend = schedulerHarnesses[kind]();
    log = { connected: 0, reserved: [], closed: [] };
    installStage(log);
    acquirer = { value: 'peer_acq' };
    fraction = { value: 0 };
    transport = {
      deliveries: [],
      failing: false,
      async deliver({ challenge }) {
        if (transport.failing) throw Object.assign(new Error('device unreachable'), { code: 'device_unreachable' });
        transport.deliveries.push(challenge.challengeId);
        return { delivered: true, receiptRef: `receipt:${challenge.challengeId}` };
      }
    };
    storage = await accept(rewards, storageTerms());
    readiness = await accept(rewards, readinessTerms());
  });

  it('issues one obligation per kind in every interval, at a stored unpredictable time, and leaves probe settlement to the probe', async () => {
    fraction.value = 0.37;
    const scheduler = runner('runner_a');
    for (let minute = 0; minute <= 41; minute += 1) {
      at0(minute * MIN);
      await scheduler.runOnce();
    }
    const stored = await rewards.listChallenges(storage.offerId);
    const probes = await rewards.listChallenges(readiness.offerId);
    expect(perInterval(storage, stored)).toEqual({ 'custody:0': 1, 'service:0': 1, 'custody:1': 1, 'service:1': 1, 'custody:2': 1, 'service:2': 1, 'custody:3': 1, 'service:3': 1 });
    expect(perInterval(readiness, probes)).toEqual({ 'execution:0': 1, 'execution:1': 1, 'execution:2': 1, 'execution:3': 1 });
    const recorded = await slots();
    expect(recorded.map((slot) => slot.status)).toEqual([...Array(4).fill('issued'), ...Array(4).fill('delivered'), ...Array(4).fill('delivered')]);
    for (const slot of recorded) {
      const challenge = [...stored, ...probes].find((entry) => entry.challengeId === slot.challengeId);
      expect(challenge.obligationRef).toBe(slot.slotId);
      // Drawn inside the first half of the interval, stored, and honoured within one scheduler interval.
      const offset = toMs(slot.dueAt) - toMs(slot.intervalStartsAt);
      expect(offset).toBe(Math.floor(INTERVAL / 2 * 0.37));
      expect(toMs(challenge.issuedAt)).toBeGreaterThanOrEqual(toMs(slot.dueAt));
      expect(toMs(challenge.issuedAt) - toMs(slot.dueAt)).toBeLessThan(MIN);
      expect(toMs(challenge.issuedAt)).toBeLessThan(toMs(slot.intervalEndsAt));
    }
    expect(transport.deliveries.sort()).toEqual(stored.map((challenge) => challenge.challengeId).sort());
    expect(stored.filter((challenge) => challenge.kind === 'service').every((challenge) => challenge.acquirer.participantId === 'peer_acq')).toBe(true);
    // Each probe ran once through the prober and settled both its attempts on its own path.
    expect(probes.map((challenge) => challenge.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(log.connected).toBe(4);
    expect(log.closed.sort()).toEqual(log.reserved.sort());
    expect(log.closed).toHaveLength(8);
    for (const probe of probes) expect(probe.answer.probe.settlement).toEqual([{ attemptId: `${probe.challengeId}-a0`, status: 'settled' }, { attemptId: `${probe.challengeId}-a1`, status: 'settled' }]);
    const passes = await scheduler.listPasses({ jobId: OBLIGATION_JOB_ID, limit: 100 });
    expect(passes).toHaveLength(42);
    expect(passes.every((pass) => pass.status === 'completed' && pass.items.length <= 20)).toBe(true);
    expect(passes.flatMap((pass) => pass.items).filter((item) => item.status === 'issued')).toHaveLength(4);
  });

  it('recovers after a restart mid-interval, and after its runner died, without skipping or repeating an interval', async () => {
    // Runner A issues interval 0's obligations, then dies before recording its pass.
    at0(MIN);
    const dying = runner('runner_a', { backend: dyingBeforeFinish(schedulerBackend()) });
    await expect(dying.runOnce()).rejects.toThrow('simulated process death');
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:0': 1, 'service:0': 1 });
    expect(log.connected).toBe(1);

    // A restarted process (new reward store and scheduler over the same records) waits out the lease, then resumes.
    rewards = harness.open().rewards;
    const restarted = runner('runner_b');
    at0(2 * MIN);
    expect(byJob(await restarted.runOnce())[OBLIGATION_JOB_ID]).toMatchObject({ status: 'lease_held', holder: 'runner_a' });
    at0(4 * MIN);
    expect(byJob(await restarted.runOnce())[OBLIGATION_JOB_ID]).toMatchObject({ status: 'completed', counts: { processed: 0 } });
    const [resumed, abandoned] = await restarted.listPasses({ jobId: OBLIGATION_JOB_ID });
    expect(abandoned).toMatchObject({ runnerId: 'runner_a', status: 'abandoned' });
    expect(resumed).toMatchObject({ runnerId: 'runner_b', recovered: { passId: abandoned.passId } });
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:0': 1, 'service:0': 1 });
    expect(perInterval(readiness, await rewards.listChallenges(readiness.offerId))).toEqual({ 'execution:0': 1 });

    // A restart in the middle of interval 1 repeats nothing.
    at0(INTERVAL + MIN);
    await restarted.runOnce();
    rewards = harness.open().rewards;
    const again = runner('runner_c');
    at0(INTERVAL + 5 * MIN);
    await again.runOnce();
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:0': 1, 'service:0': 1, 'custody:1': 1, 'service:1': 1 });
    expect(log.connected).toBe(2);

    // A crash after the reward store records interval 2's first challenge: the slot stays claimed and resumes under its key.
    at0(2 * INTERVAL + MIN);
    harness.faults.reward.afterCommit = () => { throw new Error('simulated crash after the challenge commit'); };
    const crashed = byJob(await again.runOnce())[OBLIGATION_JOB_ID];
    expect(crashed).toMatchObject({ status: 'completed', counts: { failed: 1 } });
    expect((await slots()).filter((slot) => slot.status === 'issuing')).toEqual([expect.objectContaining({ intervalIndex: 2, error: expect.objectContaining({ message: 'simulated crash after the challenge commit' }) })]);
    at0(2 * INTERVAL + 2 * MIN);
    await again.runOnce();
    expect((await slots()).filter((slot) => slot.intervalIndex <= 2).map((slot) => slot.status).every((status) => ['issued', 'delivered'].includes(status))).toBe(true);
    const challenges = [...await rewards.listChallenges(storage.offerId), ...await rewards.listChallenges(readiness.offerId)];
    expect({ ...perInterval(storage, challenges.filter((entry) => entry.offerId === storage.offerId)), ...perInterval(readiness, challenges.filter((entry) => entry.offerId === readiness.offerId)) })
      .toEqual({ 'custody:0': 1, 'service:0': 1, 'custody:1': 1, 'service:1': 1, 'custody:2': 1, 'service:2': 1, 'execution:0': 1, 'execution:1': 1, 'execution:2': 1 });
  });

  it('never issues an obligation twice when runners or probe requests run concurrently', async () => {
    at0(MIN);
    const runners = ['runner_a', 'runner_b', 'runner_c'].map((runnerId) => runner(runnerId));
    const rounds = await Promise.all(runners.map((scheduler) => scheduler.runOnce()));
    expect(rounds.map((round) => byJob(round)[OBLIGATION_JOB_ID].status).filter((status) => status === 'completed')).toHaveLength(1);
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:0': 1, 'service:0': 1 });
    expect(log.connected).toBe(1);

    // Two job instances racing on the same slots without the job lease: slot claims still allow one issuance each.
    at0(INTERVAL + MIN);
    const jobs = [0, 1].map(() => createObligationJob({ backend: schedulerBackend(), rewards, clock, ...obligations() }));
    const lease = (leaseId) => ({ leaseId, passId: `pass_${leaseId}`, runnerId: leaseId });
    await Promise.all(jobs.map((job, index) => job.run({ limit: 20, options: OPTIONS, lease: lease(`lease_${index}`), heartbeat: async () => true })));
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:0': 1, 'service:0': 1, 'custody:1': 1, 'service:1': 1 });
    expect(perInterval(readiness, await rewards.listChallenges(readiness.offerId))).toEqual({ 'execution:0': 1, 'execution:1': 1 });
    expect(log.connected).toBe(2);
    expect(transport.deliveries).toHaveLength(4);

    // Concurrent probe requests under one key run the stage once.
    const [left, right] = await Promise.all([0, 1].map(() => rewards.probeReadiness({ offerId: readiness.offerId, idempotencyKey: 'direct:probe' })));
    expect(left.challengeId).toBe(right.challengeId);
    expect(log.connected).toBe(3);
    expect(log.closed).toHaveLength(6);
  });

  it('records missed windows, unassigned service, undelivered challenges and backlog explicitly', async () => {
    fraction.value = 0.37;
    transport.failing = true;
    acquirer.value = null;
    // No runner reaches the contracts until interval 2.
    at0(2 * INTERVAL + 5 * MIN);
    const scheduler = runner('runner_a', { batchLimit: 4 });
    const passes = [];
    for (let round = 0; round < 10; round += 1) {
      const result = byJob(await scheduler.runOnce())[OBLIGATION_JOB_ID];
      if (result.status !== 'completed') break;
      passes.push(result);
      if (!result.backlog) break;
    }
    expect(passes.length).toBeGreaterThan(1);
    // Each pass stops at its batch of four actions (issuing and delivering one challenge are two) and comes back for the rest.
    expect(passes.slice(0, -1).every((pass) => pass.backlog && pass.counts.processed > 0 && pass.counts.processed <= 4)).toBe(true);
    expect(passes.at(-1).backlog).toBe(false);
    expect(await statusOf()).toEqual([
      'offer_ready:execution:0:missed_window', 'offer_ready:execution:1:missed_window', 'offer_ready:execution:2:issued',
      'offer_storage:custody:0:missed_window', 'offer_storage:custody:1:missed_window', 'offer_storage:custody:2:delivering',
      'offer_storage:service:0:missed_window', 'offer_storage:service:1:missed_window', 'offer_storage:service:2:unassigned'
    ]);
    const recorded = await slots();
    expect(recorded.filter((slot) => slot.status === 'missed_window').every((slot) => slot.reason === 'interval_ended_before_planning' && slot.challengeId === null)).toBe(true);
    const undelivered = recorded.find((slot) => slot.status === 'delivering');
    expect(undelivered.delivery).toMatchObject({ deliveredAt: null, lastError: { code: 'device_unreachable' } });
    expect(undelivered.delivery.attempts).toBeGreaterThanOrEqual(1);
    expect(recorded.find((slot) => slot.status === 'unassigned')).toMatchObject({ reason: 'no_acquirer', challengeId: null });
    // A missed scheduling window issues nothing, so it records no challenge and no outage.
    expect(perInterval(storage, await rewards.listChallenges(storage.offerId))).toEqual({ 'custody:2': 1 });
    expect(perInterval(readiness, await rewards.listChallenges(readiness.offerId))).toEqual({ 'execution:2': 1 });

    // Delivery is retried until the response deadline, then recorded unconfirmed.
    at0(2 * INTERVAL + 7 * MIN);
    await scheduler.runOnce();
    expect((await slots()).find((slot) => slot.kind === 'custody' && slot.intervalIndex === 2)).toMatchObject({
      status: 'delivery_unconfirmed', reason: 'response_deadline_passed', delivery: { attempts: undelivered.delivery.attempts, deliveredAt: null }
    });
    expect(transport.deliveries).toEqual([]);

    // Interval 3 is planned at a later due time; the runner is down until the interval has ended.
    at0(3 * INTERVAL);
    await scheduler.runOnce();
    expect((await slots()).filter((slot) => slot.intervalIndex === 3).map((slot) => slot.status)).toEqual(['planned', 'planned', 'planned']);
    at0(4 * INTERVAL + MIN);
    await scheduler.runOnce();
    const last = (await slots()).filter((slot) => slot.intervalIndex === 3);
    expect(last.map((slot) => [slot.status, slot.reason])).toEqual(Array(3).fill(['missed_window', 'issue_window_passed']));
    expect((await scheduler.listPasses({ jobId: OBLIGATION_JOB_ID })).at(0).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'missed_window', reason: 'issue_window_passed', intervalIndex: 3 })
    ]));
    expect(await rewards.listChallenges(storage.offerId)).toHaveLength(1);
  });

  it('refuses schedules whose obligations lack their ports or name unknown kinds', () => {
    const build = (options, ports = {}) => () => composeScheduler({
      backend: schedulerBackend(), schedule: schedule({ options }), runnerId: 'runner_a', services: { rewards }, clock,
      obligations: { ...obligations(), ...ports }
    });
    expect(build({ ...OPTIONS, kinds: { contracted_storage: ['retention'] } })).toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
    expect(build({ ...OPTIONS, issueWindow: { numerator: 3, denominator: 2 } })).toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
    expect(build(OPTIONS, { transport: null })).toThrow(expect.objectContaining({
      code: 'invalid_schedule', details: { errors: [expect.stringContaining('need a transport')] }
    }));
    expect(build(OPTIONS, { selectAcquirer: null })).toThrow(expect.objectContaining({ code: 'invalid_schedule' }));
    expect(build({ kinds: { prepared_readiness: ['execution'] }, issueWindow: { numerator: 1, denominator: 2 } }, { transport: null, selectAcquirer: null })).not.toThrow();
  });
});
