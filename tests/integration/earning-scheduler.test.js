// @vitest-environment node
// The composition hosts the durable scheduler: deferred earning work runs from the policy's schedule, not from
// whoever happens to call a route. A requester that stops acknowledging leaves its attempt to the evidence
// window, and the in-process runner settles it after the window; a queued Community Access request is admitted
// by the scheduler process (run-scheduler.js) while reading it changes nothing; two runners over one store apply
// each effect once; a runner that dies mid-pass leaves a lease that a restarted runner recovers. Fake-Firestore
// store shared by every "process"; resident sessions stand in for Doppler arithmetic; every value is test-only.
import { createHash } from 'node:crypto';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { CAPACITY_EVIDENCE_SCHEMA as COMMUNITY_CAPACITY_SCHEMA } from '../../server/community-access/domain.js';
import { createEarningComposition, OPERATORS_SCHEMA } from '../../server/earning-composition/index.js';
import { runEarningScheduler } from '../../server/earning-composition/run-scheduler.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/domain.js';
import { createNativeEarningStorage, openNativeEarning } from '../../server/native-earning.js';
import { composeScheduler } from '../../server/scheduler/operator.js';
import { createFirestoreSchedulerBackend } from '../../server/scheduler/stores.js';
import { createEarningAttempts } from '../../self/host/earning/attempts.js';
import { EARNING_CLIENT_SCHEMA, createEarningClient } from '../../self/host/earning/client.js';
import { newIdentity } from '../helpers/account-fixture.js';
import { hostStorage } from '../helpers/earning-harness.js';
import { QUOTE_REQUEST, earningPolicy, writeOutsideRepository } from '../helpers/earning-policy-fixture.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { residentRoute } from '../helpers/resident-route.js';
import { MIN, advance, clock, fx, ownerAuthorization } from '../helpers/reward-fixture.js';
import { byJob, dyingBeforeFinish } from '../helpers/scheduler-fixture.js';

const EVIDENCE = Object.freeze({ rulesId: EVIDENCE_RULES_ID, windowMs: 5 * MIN, clockSkewMs: 30_000, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS });
// Past the quote's 3-minute deadline and the 5-minute evidence window.
const PAST_WINDOW = 3 * MIN + EVIDENCE.windowMs + MIN;
const JOBS = ['ledger.settleDueEvidence', 'ledger.expireReservations', 'rewards.resumeIssuance', 'community-access.resumeFunding',
  'community-access.expireQueue', 'community-access.admitWaiting', 'payments.pollPending'];
const policy = () => {
  const value = earningPolicy();
  value.services[0].terms.evidence = { ...EVIDENCE };
  value.communityAccess = { policyVersion: 'test-community/1', poolAccountId: 'pool_general', guarantee: { mode: 'none' },
    queue: { maxLength: 4, maxPerAccount: 2, maxWaitMs: 30 * MIN }, usage: { windowMs: 60 * MIN, maxAdmissions: 3, maxAuthorizedCredits: 200 },
    rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 5 } }, capacity: { evidenceMaxAgeMs: 60 * MIN },
    evidence: { ...EVIDENCE } };
  value.scheduler = { scheduleVersion: 'test-schedule/1', leaseMs: 2 * MIN, jobs: Object.fromEntries(JOBS.map((jobId) => [jobId, { intervalMs: MIN, batchLimit: 10 }])) };
  return value;
};
// The in-process runner sleeps in real time for at most this long, so a test's clock advance is seen promptly.
const quickWait = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, Math.min(ms, 10));
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
const quiet = { warn() {}, error() {}, log() {} };

describe('the composition hosts the durable scheduler', () => {
  let firestore;
  let env;
  let base;
  const servers = [];
  const compositions = [];

  afterEach(async () => {
    await Promise.allSettled(compositions.splice(0).map((composition) => composition.stopScheduler()));
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
  });

  beforeEach(async () => {
    // Stage receipts carry the wall clock; the fixture clock starts from it.
    fx.nowMs = Date.now();
    firestore = createFakeFirestore();
    env = {
      REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', policy()), REPLOID_EARNING_STORE: 'firestore', REPLOID_EARNING_FIRESTORE_PREFIX: 'test',
      REPLOID_EARNING_TEST_SIGN_IN: 'enabled', REPLOID_EARNING_TEST_PROCESSOR: 'enabled',
      REPLOID_EARNING_COMMUNITY_CAPACITY_FILE: await writeOutsideRepository('community-capacity.json', {
        schema: COMMUNITY_CAPACITY_SCHEMA, evidenceId: 'community-capacity:test', observedAt: new Date(fx.nowMs - 1000).toISOString(), admittedSlots: 1 }),
      REPLOID_EARNING_OPERATORS_FILE: await writeOutsideRepository('operators.json', { schema: OPERATORS_SCHEMA,
        operators: [{ actorId: 'funding_admin_test', roles: ['funding'], tokenSha256: createHash('sha256').update('founder-token').digest('hex') }] })
    };
  });

  /** A server process over the shared store; `hosting` names its scheduler hosting. */
  const serve = async (hosting) => {
    const composition = await createEarningComposition({ env: { ...env, REPLOID_EARNING_SCHEDULER: hosting }, ports: { firestore, clock, wait: quickWait, log: quiet } });
    compositions.push(composition);
    const app = express();
    await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition, log: quiet });
    installJsonBodyMiddleware(app, {});
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    servers.push(server);
    base = `http://127.0.0.1:${server.address().port}`;
    return composition;
  };
  /** The scheduler process (run-scheduler.js) for one round over the same store. */
  const runOnce = () => runEarningScheduler({ env: { ...env, REPLOID_EARNING_SCHEDULER: 'external' }, once: true, ports: { firestore, clock, log: quiet }, report: () => {} })
    .then(byJob);

  const signIn = (subject) => async () => (await (await fetch(`${base}/v1/sign-in/local-test/assertions`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject }) })).json()).assertion;
  const device = async (subject) => {
    const identity = await newIdentity('Ed25519');
    const client = createEarningClient({ config: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: `${base}/v1`, providerId: 'local-test' },
      identity, host: 'browser', signIn: signIn(subject), storage: hostStorage() });
    return { identity, client, session: await client.ensureSession() };
  };
  const operator = (route, body, key) => fetch(`${base}/v1${route}`, { method: 'POST', body: JSON.stringify(body),
    headers: { authorization: 'Bearer founder-token', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } }).then((response) => response.json());
  const fundPool = async () => {
    await operator('/operator/funding/commitments', { commitmentId: 'founder_week_1', funderKind: 'operator', funderId: 'founder', externalRef: 'external:founder_week_1',
      amount: 200, unit: { kind: 'credits' }, validFrom: clock(), validUntil: new Date(fx.nowMs + 7 * 24 * 60 * MIN).toISOString() }, 'commit:1');
    expect(await operator('/operator/funding/community-pools', { fundingId: 'founder_pool_1', commitmentId: 'founder_week_1', quantity: 200,
      poolAccountId: 'pool_general', decisionId: 'decision:founder_pool_1' })).toMatchObject({ status: 'issued' });
  };
  const askAccess = (member, key) => member.client.send({ opId: key, path: '/community-access/requests', body: { request: { ...QUOTE_REQUEST } }, durable: false });

  it('settles a withheld-acknowledgment attempt after its evidence window through the in-process runner', async () => {
    const server = await serve('in-process');
    const requester = await device('requester');
    const started = await requester.client.send({ opId: 'top-up', path: '/payments/checkouts', body: { topUpId: 'test-topup' }, durable: false });
    await fetch(`${base}${started.checkout.url}/complete`, { method: 'POST' });
    const natives = await Promise.all([0, 1].map(async (index) => {
      const identity = await newIdentity('Ed25519');
      const earning = await openNativeEarning({ identity, ownerAuthorization, storage: createNativeEarningStorage(`${await writeOutsideRepository(`native-${index}.json`, {})}.state`),
        settings: { client: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: `${base}/v1`, providerId: 'local-test' }, signIn: { subject: 'contributor' } } });
      return { earning, signer: createAttemptEvidenceSigner({ identity }), participantId: identity.peerId };
    }));
    const route = await residentRoute({ participants: natives.map((row) => row.participantId), requesterId: requester.identity.peerId,
      signers: natives.map((row) => row.signer), steps: 8, acknowledgmentWaitMs: 150 });
    try {
      // The requester acknowledges only its first output, so the coordinator stops the route as overdue.
      const firstOnly = (generate) => (request, controls) => {
        const view = Object.create(controls);
        Object.defineProperty(view, 'onOutput', { get: () => controls.onOutput && ((record) => (record.step === 0 ? controls.onOutput(record) : null)) });
        return generate(request, view);
      };
      const attempts = createEarningAttempts({ client: requester.client, quoteRequest: () => ({ ...QUOTE_REQUEST }), authorizeSpending: async () => true, now: () => fx.nowMs });
      await expect(attempts.run({ threadId: 't1', attemptId: 'a1', model: route.model, messages: [{ role: 'user', content: 'Question' }] },
        { requestApproval: async () => true }, firstOnly(route.requester.generate))).rejects.toMatchObject({ code: 'ACKNOWLEDGMENT_OVERDUE' });
      const { reservationId } = await attempts.getThread('t1');
      expect(await server.ledger.getReservation(reservationId)).toMatchObject({ status: 'open' });
      for (const [index, native] of natives.entries()) await native.earning.observe({ admissions: route.admissions(index) });

      // Nothing decides before the window closes; after it, the hosted runner's sweep does, with no route call.
      advance(PAST_WINDOW);
      await vi.waitFor(async () => expect((await server.ledger.getReservation(reservationId)).status).not.toBe('open'), { timeout: 5000, interval: 20 });
      const reservation = await server.ledger.getReservation(reservationId);
      expect(reservation.settlement).toMatchObject({ outcome: 'partial_delivery', basis: 'evidence', metering: { output: 1 } });
      const [pass] = (await server.scheduler.listPasses({ jobId: 'ledger.settleDueEvidence' })).filter((row) => row.counts?.processed > 0);
      expect(pass).toMatchObject({ status: 'completed', runnerId: server.scheduler.runnerId, items: [expect.objectContaining({ ref: reservationId })] });
    } finally {
      await route.close();
    }
  });

  it('admits a queued Community Access request from the scheduler process, while reading it changes nothing', async () => {
    const server = await serve('external');
    await fundPool();
    const [first, second] = [await device('member-one'), await device('member-two')];
    const admitted = await askAccess(first, 'access:1');
    expect(admitted).toMatchObject({ state: 'available', quote: { terms: { evidence: EVIDENCE } } });
    const queued = await askAccess(second, 'access:2');
    expect(queued).toMatchObject({ state: 'queued', position: 1 });
    // The first member's answer ends before dispatch; its slot frees only through an admission pass.
    await first.client.send({ opId: 'report:1', path: `/reservations/${encodeURIComponent(admitted.reservationId)}/reports`,
      body: { report: { schema: 'reploid.attempt-report/v1', result: 'cancelled', attemptId: null } } });
    const entry = async () => firestore.collection('test_community_access_requests').doc(queued.requestId).get().then((snapshot) => snapshot.data());
    const before = await entry();
    expect(before).toMatchObject({ state: 'waiting', reservationId: null });
    for (let i = 0; i < 3; i += 1) expect(await second.client.get(`/community-access/requests/${queued.requestId}`)).toMatchObject({ state: 'queued' });
    expect(await entry()).toEqual(before);

    const round = await runOnce();
    expect(round['community-access.admitWaiting']).toMatchObject({ status: 'completed', counts: { processed: 2 } });
    const now = await second.client.get(`/community-access/requests/${queued.requestId}`);
    expect(now).toMatchObject({ state: 'available', reservationId: expect.any(String), quote: { terms: { evidence: EVIDENCE } } });
    expect(await server.ledger.getReservation(now.reservationId)).toMatchObject({ accountId: 'pool_general', deviceId: second.session.deviceId, status: 'open' });
  });

  it('applies each effect once when two runners share the store, and recovers a runner that died mid-pass', async () => {
    const server = await serve('external');
    await fundPool();
    const member = await device('member');
    const held = await askAccess(member, 'access:1');
    expect(held).toMatchObject({ state: 'available' });
    const journal = () => server.ledger.listJournal('pool_general').then((entries) => entries.map((row) => [row.type, row.amount]));
    expect(await journal()).toEqual([['issue', 200], ['reserve', 60]]);

    // A runner that dies after its job ran but before it recorded the pass leaves its lease and a running pass.
    advance(PAST_WINDOW);
    const dying = composeScheduler({ backend: dyingBeforeFinish(createFirestoreSchedulerBackend({ firestore, collectionPrefix: 'test' })), schedule: policy().scheduler,
      runnerId: 'runner-dies', services: { ledger: server.ledger, rewards: server.rewards, access: server.communityAccess, payments: server.payments }, clock });
    await expect(dying.runJob('ledger.settleDueEvidence')).rejects.toThrow('simulated process death');
    // The unbound pool hold had nothing to decide on, so its window decision released it, once.
    expect(await journal()).toEqual([['issue', 200], ['reserve', 60], ['release', 60]]);

    // Two runners at once: each job runs on one of them; the dead runner's lease holds until it expires.
    const [left, right] = await Promise.all([runOnce(), runOnce()]);
    for (const jobId of JOBS) {
      const statuses = [left[jobId].status, right[jobId].status];
      if (jobId === 'ledger.settleDueEvidence') {
        expect(statuses).toEqual(['lease_held', 'lease_held']);
        continue;
      }
      // One runner runs the job; the other finds its lease held, or finds it already done and not due.
      expect(statuses.filter((status) => status === 'completed')).toHaveLength(1);
      expect(['lease_held', 'not_due']).toContain(statuses.find((status) => status !== 'completed'));
    }
    expect([left['community-access.admitWaiting'], right['community-access.admitWaiting']].filter((row) => row.status === 'completed')).toHaveLength(1);

    // After the lease expires, a restarted runner records the dead pass as abandoned and runs the job again with no second effect.
    advance(3 * MIN);
    const recovered = await runOnce();
    expect(recovered['ledger.settleDueEvidence']).toMatchObject({ status: 'completed', counts: { processed: 0 } });
    const passes = await server.scheduler.listPasses({ jobId: 'ledger.settleDueEvidence' });
    expect(passes.map((pass) => pass.status)).toEqual(['completed', 'abandoned']);
    expect(passes[0].recovered).toMatchObject({ runnerId: 'runner-dies' });
    expect(await journal()).toEqual([['issue', 200], ['reserve', 60], ['release', 60]]);
    expect(await server.ledger.auditAccount('pool_general')).toMatchObject({ consistent: true });
  });

  it('refuses production with evidence terms or Community Access and no scheduler hosting, and schedules missing a required job', async () => {
    const production = { ...env, REPLOID_EARNING_TEST_SIGN_IN: 'disabled', REPLOID_EARNING_TEST_PROCESSOR: 'disabled' };
    await expect(createEarningComposition({ env: production, production: true, ports: { firestore, clock, log: quiet } }))
      .rejects.toMatchObject({ code: 'scheduler_hosting_required', message: expect.stringContaining('run-scheduler.js --once') });
    const thin = policy();
    delete thin.scheduler.jobs['community-access.admitWaiting'];
    await expect(createEarningComposition({ env: { ...env, REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', thin), REPLOID_EARNING_SCHEDULER: 'external' },
      ports: { firestore, clock, log: quiet } })).rejects.toMatchObject({ code: 'scheduler_jobs_required', message: expect.stringContaining('community-access.admitWaiting') });
    await expect(createEarningComposition({ env: { ...env, REPLOID_EARNING_STORE: 'memory', REPLOID_EARNING_SCHEDULER: 'external' }, ports: { clock, log: quiet } }))
      .rejects.toMatchObject({ code: 'scheduler_store_unshared' });
    const none = policy();
    delete none.scheduler;
    await expect(createEarningComposition({ env: { ...env, REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', none), REPLOID_EARNING_SCHEDULER: 'in-process' },
      ports: { firestore, clock, log: quiet } })).rejects.toMatchObject({ code: 'scheduler_policy_required' });
  });
}, 60_000);
