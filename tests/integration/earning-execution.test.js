// @vitest-environment node
// The earning loop with actual execution and delivery evidence, end to end over the authenticated
// routes. A chat workspace sends through the browser host's chat execution, whose earning client
// quotes, accepts, binds and reports each partition attempt; a route of real resident stages runs
// it; native contributor clients claim their stage shares from their own admission records; a real
// custody transfer supplies the delivery evidence. Real accounts, ledger, rewards and route
// idempotency over memory and fake-Firestore stores. Test-only provider, policies and amounts.
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createRemotePermission, remotePermissionNeed } from '../../packages/reploid/src/chat/remote-permission.js';
import { sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { createFirestoreRouteBackend, createMemoryRouteBackend, createRouteIdempotency } from '../../server/earning-routes/idempotency.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { billableEventIdFor } from '../../server/ledger/attempt-outcomes.js';
import { createChatExecution } from '../../self/host/chat-execution.js';
import { createEarningAttempts } from '../../self/host/earning/attempts.js';
import { EARNING_CLIENT_SCHEMA, createEarningClient } from '../../self/host/earning/client.js';
import { createEarningContribution } from '../../self/host/earning/contribution.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createSessionBinding } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { ACCOUNT_POLICY, newIdentity, openAccountFixture } from '../helpers/account-fixture.js';
import { PIECE_BYTES, transferPiece } from '../helpers/custody-transfer.js';
import { PROMPT_TOKENS, STEPS, residentRoute } from '../helpers/resident-route.js';
import {
  FUNDING_ADMIN, ISSUANCE_POLICY, MIN, MODEL, OWNER_DIGEST, advance, at, clock, fund, fundingAuthority, fx, offerInput, ownerAuthorization, quoteInput
} from '../helpers/reward-fixture.js';

// Test-only limits, operator credentials and policies; none is a product decision.
const LIMITS = Object.freeze({
  jsonBytes: 16 * 1024, evidenceJsonBytes: 256 * 1024, idempotencyLeaseMs: 30_000,
  address: { max: 10_000, windowMs: MIN }, signIn: { max: 100, windowMs: MIN }, account: { max: 1000, windowMs: MIN },
  device: { max: 1000, windowMs: MIN }, operator: { max: 1000, windowMs: MIN }
});
const OPERATORS = Object.freeze({
  'operator-funding': { actorId: FUNDING_ADMIN, roles: ['funding'] },
  'operator-issuance': { actorId: 'issuance_test', roles: ['issuance'] }
});
// Deliveries may also draw on an operator-funded reservation once settled demand is exhausted.
const ISSUANCE = Object.freeze({ ...ISSUANCE_POLICY, categoryBases: { ...ISSUANCE_POLICY.categoryBases, verified_delivery: ['settled_demand', 'funded_reservation'] } });
const REPORT_ROUTE = 'POST /reservations/:reservationId/reports';
const CLAIM_ROUTE = 'POST /offers/:offerId/claims';
// The fixture quote charges 10 + ceil(output / 2) for a full answer; offers pay a third of the settled charge.
const FULL_CHARGE = 10 + Math.ceil(STEPS / 2);
const SHARE = Math.ceil(FULL_CHARGE / 3);
const REPORT_SCHEMA = 'reploid.attempt-report/v1';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

/** Durable host storage that outlives a client, as a restarted host's storage does. */
const hostStorage = () => {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
    set: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => { map.delete(key); }
  };
};

describe('earning client configuration', () => {
  it('stays off unless explicitly configured and refuses incomplete or insecure configuration', async () => {
    const ports = { identity: await newIdentity('ECDSA'), host: 'browser', signIn: async () => 'assertion', storage: hostStorage(), fetch: async () => { throw new Error('no request'); } };
    expect(createEarningClient(ports)).toBeNull();
    expect(createEarningClient({ ...ports, config: { schema: EARNING_CLIENT_SCHEMA, enabled: false, baseUrl: 'https://example.test/v1', providerId: 'p' } })).toBeNull();
    for (const config of [{ enabled: true, baseUrl: 'https://example.test/v1', providerId: 'p' },
      { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: 'http://example.test/v1', providerId: 'p' },
      { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: 'https://example.test/v1' },
      { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: 'https://example.test/v1', providerId: 'p', autoAccept: true }]) {
      expect(() => createEarningClient({ ...ports, config })).toThrow(TypeError);
    }
    const client = createEarningClient({ ...ports, config: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: 'https://example.test/v1/', providerId: 'p' } });
    expect(client.config.baseUrl).toBe('https://example.test/v1');
    expect(() => createEarningAttempts({ client: null })).toThrow('enabled earning client');
    // Partition paths whose records the outcome rules cannot read are refused before any quote.
    const sent = [];
    const attempts = createEarningAttempts({ client: { send: async (op) => { sent.push(op); }, storage: hostStorage(), participantId: 'peer' },
      quoteRequest: () => ({}), authorizeSpending: async () => true });
    await expect(attempts.run({ threadId: 't', attemptId: 'a', model: { id: 'm', partition: { participantA: 'a', participantB: 'b' } } }, {}, async () => ({})))
      .rejects.toMatchObject({ code: 'route_unsupported' });
    expect(sent).toEqual([]);
  });
});

describe.each(['memory', 'firestore'])('earning with actual execution and delivery evidence (%s store)', (kind) => {
  let harness;
  let provider;
  let services;
  let base;
  const cleanups = [];

  const idempotencyBackend = () => (kind === 'memory'
    ? createMemoryRouteBackend({ state: harness.states.identity })
    : createFirestoreRouteBackend({ firestore: harness.dbs.identity, collectionPrefix: 'test' }));

  /** One router process over the shared stores. */
  const start = async (overrides = {}) => {
    const app = express();
    await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition: {
      ...services,
      // The service and price policy: requests name a model, never terms.
      quoteTerms: async ({ accountId, request }) => {
        if (request?.modelId !== MODEL.modelId || request.modelIdentity !== MODEL.modelIdentity) return null;
        const { service, pricing, terms } = quoteInput({ quoteId: 'unused', accountId });
        return { service, pricing, terms };
      },
      operatorAuthority: { authenticate: async ({ token }) => OPERATORS[token] ?? null },
      idempotencyBackend: idempotencyBackend(), limits: LIMITS, nowMs: () => fx.nowMs, log: { error() {} }, ...overrides
    } });
    installJsonBodyMiddleware(app, {});
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };

  const http = async (on, method, path, { token, key, body } = {}) => {
    const response = await fetch(`${on}/v1${path}`, { method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  const clientFor = ({ on = base, identity, host, subject, storage = hostStorage(), fetch: fetchPort = fetch }) => createEarningClient({
    config: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: `${on}/v1`, providerId: provider.providerId },
    identity, host, storage, fetch: fetchPort, signIn: async () => provider.issue({ subject })
  });

  /** A native contributor host: its own sign-in, device registration bound to its session, and owner record. */
  const contributor = async (subject) => {
    const identity = await newIdentity('Ed25519');
    const storage = hostStorage();
    const client = clientFor({ identity, host: 'native', subject, storage });
    const session = await client.ensureSession();
    const claims = (offers = {}, over = client) => createEarningContribution({ client: over, offers, ownerPolicyDigest: OWNER_DIGEST, hashEvidence: hashDopplerEvidence });
    await claims().recordOwnerAuthorization(ownerAuthorization);
    return { subject, identity, storage, client, session, accountId: session.accountId, claims };
  };

  /** The system offers a contributor work; the contributor's host accepts it under its owner policy. */
  const offer = async (host, overrides) => {
    const created = await services.rewards.createOffer({
      ...offerInput({ accountId: host.accountId, participantId: host.identity.peerId, ...overrides }), idempotencyKey: `offer:${overrides.offerId}`
    });
    await host.claims().acceptOffer(created.offerId, ownerAuthorization);
    return created.offerId;
  };

  const quoteRequest = (request) => ({ modelId: request.model.id, modelIdentity: request.model.identity, operation: 'chat.completion' });

  /**
   * The requester's browser host: a chat workspace executing through the host's chat execution,
   * whose earning attempts quote, accept, bind and report over the route of resident stages.
   */
  const requesterHost = ({ route, identity, storage = hostStorage(), on = base, fetch: fetchPort }) => {
    const client = clientFor({ on, identity, host: 'browser', subject: 'requester', storage, fetch: fetchPort });
    const timers = [];
    const attempts = createEarningAttempts({
      client, now: () => fx.nowMs, quoteRequest, authorizeSpending: async ({ quote }) => quote.pricing.maxCharge <= 60,
      setTimer: (callback, ms) => { const timer = { callback, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }
    });
    const execution = createChatExecution({ service: {}, partitions: route.requester, models: [], getModels: () => [route.model],
      profile: { generation: {}, maxOutcomeCharacters: 1000 }, earning: attempts });
    // The one-time remote contributor permission; no per-request review follows it.
    const permission = createRemotePermission({ id: 'remote', grantedAt: 1, need: remotePermissionNeed({
      networkId: 'mesh', sharingScope: 'mesh', disclosure: 'ordered-partition-activations-and-tokens', model: route.model }) });
    let saved = null;
    const app = createChatWorkspace({ meshId: 'mesh', participantId: identity.peerId, remotePermissions: () => [permission],
      store: { load: () => structuredClone(saved), save: (value) => { saved = structuredClone(value); } }, execute: execution.execute });
    cleanups.push(() => app.close());
    const thread = () => app.createThread({ model: route.model, permissions: { sharingScope: 'mesh' } });
    const latest = (threadId) => app.getState().threads.find((row) => row.id === threadId)?.attempts.at(-1);
    return {
      client, attempts, app, storage, thread, latest,
      fireDeadline: () => timers.filter((timer) => !timer.cancelled).forEach((timer) => timer.callback())
    };
  };

  /** Two native contributors, a funded browser requester and a route over the contributors' resident stages. */
  const network = async ({ on = base, fetch: fetchPort } = {}) => {
    const c0 = await contributor('contributor-0');
    const c1 = await contributor('contributor-1');
    const requesterIdentity = await newIdentity('ECDSA');
    const route = await residentRoute({ participants: [c0.identity.peerId, c1.identity.peerId], requesterId: requesterIdentity.peerId });
    cleanups.push(() => route.close());
    const stageOffers = [await offer(c0, { offerId: 'offer_stage_0' }), await offer(c1, { offerId: 'offer_stage_1' })];
    const requester = requesterHost({ route, identity: requesterIdentity, on, fetch: fetchPort });
    const session = await requester.client.ensureSession();
    await fund(services.ledger, session.accountId, 100);
    return { c0, c1, route, stageOffers, requester, requesterIdentity, requesterAccount: session.accountId, requesterSession: session };
  };

  const journal = async (accountId) => (await services.ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);
  const reservationsOf = (accountId) => services.ledger.listAccountReservations(accountId);
  // Acceptances in one fixture instant list in id order; a thread names its own.
  const reservationOf = async (attempts, threadId) => services.ledger.getReservation((await attempts.getThread(threadId)).reservationId);
  const binding = (routeId, caller, key) => createRouteIdempotency({ backend: idempotencyBackend(), leaseMs: LIMITS.idempotencyLeaseMs, nowMs: () => fx.nowMs })
    .get({ routeId, caller, key });
  const issued = async (accountId) => (await services.ledger.listJournal(accountId)).filter((entry) => entry.type === 'issue').length;

  /** Balances, journals, solvency and the issuance bases agree. */
  const reconcileBooks = async (accountIds) => {
    let outstanding = 0;
    for (const accountId of accountIds) {
      expect(await services.ledger.auditAccount(accountId)).toMatchObject({ consistent: true });
      const account = await services.ledger.getAccount(accountId);
      outstanding += account.available + account.held;
    }
    const solvency = await services.ledger.getSolvencySnapshot();
    expect(solvency.accountsObserved).toBeGreaterThanOrEqual(accountIds.length);
    expect(solvency.outstanding.total).toBe(outstanding);
    expect(solvency.issued.total - solvency.spent.total + solvency.refunded.total - solvency.reversed.total).toBe(solvency.outstanding.total);
    expect(solvency.held.total).toBe(solvency.reservations.open.held + solvency.reservations.underReview.held);
    const bases = await services.rewards.getIssuanceState();
    expect(bases.byBasis.settled_demand).toBe(solvency.issued.byProvenance.earned);
    expect(bases.byBasis.funded_reservation).toBe(solvency.issued.byProvenance.subsidized);
    return solvency;
  };

  beforeEach(async () => {
    ({ harness, provider } = openAccountFixture(kind));
    // Route receipts carry the coordinator's wall clock; the fixture clock starts from it.
    fx.nowMs = Date.now();
    services = harness.open({ fundingAuthority, issuancePolicy: ISSUANCE });
    base = await start();
  });
  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  describe('requester', () => {
    it('settles a completed answer once, bound before dispatch to the route\'s recipients', async () => {
      const { c0, c1, route, requester, requesterAccount, requesterSession } = await network();
      const thread = requester.thread();
      const attempt = await requester.app.send(thread, 'Question');
      expect(attempt).toMatchObject({ status: 'completed', authorization: { kind: 'permission', permissionId: 'remote' } });
      expect(requester.app.getState().threads[0].messages.at(-1).content).toBe('012');

      const [reservation] = await reservationsOf(requesterAccount);
      expect(reservation).toMatchObject({ status: 'settled', deviceId: requesterSession.deviceId, authorizedMax: 60 });
      expect(reservation.attempts).toEqual([expect.objectContaining({ attemptId: attempt.id, status: 'settled',
        recipients: expect.arrayContaining([c0.identity.peerId, c1.identity.peerId]) })]);
      // Outcome and metering come from the route receipt under the declared rules.
      expect(reservation.settlement).toMatchObject({ outcome: 'full', charge: FULL_CHARGE, metering: { output: STEPS, context: PROMPT_TOKENS },
        billableEventId: billableEventIdFor(reservation.reservationId) });
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
      expect(await requester.client.pending()).toEqual([]);
      expect(await requester.attempts.getThread(thread)).toMatchObject({ status: 'settled', retryable: false });

      // The kept route record; the same report under another key is refused, not settled again.
      const record = await services.ledger.findAttemptRecord(route.admissions(0)[0].identity);
      expect(record).toMatchObject({ reservationId: reservation.reservationId, attemptId: attempt.id, outcome: 'full', rule: 'completed' });
      const again = await http(base, 'POST', `/reservations/${reservation.reservationId}/reports`, { token: requesterSession.token, key: 'another-key',
        body: { report: { schema: REPORT_SCHEMA, result: 'completed', attemptId: attempt.id, identity: record.identity, execution: record.execution } } });
      expect([again.status, again.body.error]).toEqual([409, 'reservation_already_settled']);
      await reconcileBooks([requesterAccount]);
    });

    it('binds and reports only from the accepting device, and refuses reports the rules cannot read', async () => {
      const { route, requester, requesterAccount } = await network();
      const hold = route.hold(1, 0);
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      await hold.entered;
      const { reservationId } = await requester.attempts.getThread(thread);
      const [{ attempts: [bound] }] = await reservationsOf(requesterAccount);
      // Another registered device of the same account neither reports nor binds this reservation's attempts.
      const laptop = clientFor({ identity: await newIdentity('ECDSA'), host: 'browser', subject: 'requester' });
      const other = await laptop.ensureSession();
      expect(other.accountId).toBe(requesterAccount);
      const report = (token, key, body) => http(base, 'POST', `/reservations/${reservationId}/reports`, { token, key, body: { report: body } });
      expect((await report(other.token, 'r1', { schema: REPORT_SCHEMA, result: 'abandoned', attemptId: null })).body.error).toBe('reservation_device_mismatch');
      expect((await http(base, 'POST', `/reservations/${reservationId}/attempts`, { token: other.token, key: 'b1',
        body: { attemptId: 'att_other', recipients: bound.recipients } })).body.error).toBe('reservation_device_mismatch');
      // The accepting device's malformed or premature reports change nothing.
      const { token } = await requester.client.ensureSession();
      expect((await report(token, 'r2', { schema: REPORT_SCHEMA, result: 'completed', attemptId: bound.attemptId, outcome: 'full' })).body.error).toBe('invalid_report');
      expect((await report(token, 'r3', { schema: REPORT_SCHEMA, result: 'completed', attemptId: bound.attemptId,
        identity: { ...(await services.ledger.getReservation(reservationId)).attempts[0], route: route.route } })).body.error).toBe('invalid_report');
      expect((await report(token, 'r4', { schema: REPORT_SCHEMA, result: 'abandoned', attemptId: null })).body.error).toBe('attempt_active');
      hold.release();
      expect((await sending).status).toBe('completed');
      expect((await services.ledger.getReservation(reservationId)).settlement).toMatchObject({ outcome: 'full', charge: FULL_CHARGE });
    });

    it('settles a cancellation under its rule, cancels an acceptance that never dispatched and holds nothing for declined terms', async () => {
      const { c0, route, stageOffers, requester, requesterAccount } = await network();
      const hold = route.hold(1, 1);
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      await hold.entered;
      // The requester stops the answer after the route delivered one step.
      await requester.app.cancel(thread);
      expect(await sending).toMatchObject({ status: 'cancelled' });
      const [cancelled] = await reservationsOf(requesterAccount);
      expect(cancelled.settlement).toMatchObject({ outcome: 'cancellation', phase: 'dispatched', metering: { output: 1 }, charge: Math.ceil(1 / 2) });
      expect(await services.ledger.findAttemptRecord(route.admissions(0)[0].identity))
        .toMatchObject({ result: 'cancelled', rule: 'cancelled_after_dispatch', cancellation: { cause: 'requester' }, activitySteps: 1 });
      // Cancelled work earns no stage share.
      expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'done', outcome: 'rejected' });

      // An attempt that fails before any disclosure cancels its acceptance before dispatch.
      const failing = requester.attempts.wrap(async () => { throw new Error('No prepared ordered entry available'); });
      await expect(failing({ threadId: 'thread_unavailable', attemptId: 'att_unavailable', model: route.model, messages: [] },
        { signal: new AbortController().signal, requestApproval: async () => true })).rejects.toThrow('No prepared ordered entry');
      expect(await reservationOf(requester.attempts, 'thread_unavailable')).toMatchObject({ status: 'settled', attempts: [],
        settlement: { outcome: 'cancellation', phase: 'queued', charge: 0 } });

      // Declined terms are never accepted, so nothing is held.
      const declining = createEarningAttempts({ client: requester.client, quoteRequest, authorizeSpending: async () => false, now: () => fx.nowMs });
      await expect(declining.run({ threadId: 'thread_declined', attemptId: 'att_declined', model: route.model, messages: [] },
        { signal: new AbortController().signal, requestApproval: async () => true }, route.requester.generate)).rejects.toMatchObject({ code: 'spending_declined' });
      expect(await reservationsOf(requesterAccount)).toHaveLength(2);
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', 1], ['release', 59], ['reserve', 60], ['release', 60]]);
      expect(cancelled.reservationId).toBe((await requester.attempts.getThread(thread)).reservationId);
      await reconcileBooks([requesterAccount, c0.accountId]);
    });

    it('settles a timeout at the quoted deadline from the route\'s own stop', async () => {
      const { route, requester, requesterAccount } = await network();
      const hold = route.hold(0, 1);
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      await hold.entered;
      advance(4 * MIN);
      requester.fireDeadline();
      expect((await sending).status).toBe('failed');
      expect((await reservationsOf(requesterAccount))[0].settlement).toMatchObject({ outcome: 'timeout', charge: 0 });
      expect(await services.ledger.findAttemptRecord(route.admissions(0)[0].identity)).toMatchObject({ rule: 'deadline', cancellation: { cause: 'deadline' } });
    });

    it('closes a lost contributor\'s attempt, settles one explicit retry under the same acceptance and abandons without a second charge', async () => {
      const { c0, c1, route, stageOffers, requester, requesterAccount, requesterSession } = await network();
      route.loseStage(1, 1);
      const thread = requester.thread();
      const lost = await requester.app.send(thread, 'Question');
      expect(lost.status).toBe('failed');
      const [open] = await reservationsOf(requesterAccount);
      expect(open).toMatchObject({ status: 'open', attempts: [expect.objectContaining({ attemptId: lost.id, status: 'failed', reason: 'contributor_loss' })] });
      expect(await requester.attempts.getThread(thread)).toMatchObject({ retryable: true, reservationId: open.reservationId });

      // A retry that fails before any disclosure keeps the acceptance for the next explicit retry.
      const generate = route.requester.generate;
      route.requester.generate = async () => { route.requester.generate = generate; throw new Error('No prepared ordered entry available'); };
      const unavailable = await requester.app.retry(thread, lost.id);
      expect(unavailable.status).toBe('failed');
      expect(await requester.attempts.getThread(thread)).toMatchObject({ retryable: true, reservationId: open.reservationId, lastAttemptId: unavailable.id });

      // The explicit retry binds under the same acceptance: one reservation and one charge within the authorized maximum.
      const retried = await requester.app.retry(thread, unavailable.id);
      expect(retried).toMatchObject({ status: 'completed', retryOf: unavailable.id });
      const [settled] = await reservationsOf(requesterAccount);
      expect(settled.reservationId).toBe(open.reservationId);
      expect(settled.attempts.map((row) => [row.attemptNumber, row.status])).toEqual([[1, 'failed'], [2, 'settled']]);
      expect(settled.settlement).toMatchObject({ outcome: 'full', charge: FULL_CHARGE, authorizedMax: 60, attempt: { attemptId: retried.id, attemptNumber: 2 } });
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
      expect((await http(base, 'POST', `/reservations/${settled.reservationId}/attempts`, { token: requesterSession.token, key: 'third',
        body: { attemptId: 'att_third', recipients: [c0.identity.peerId] } })).body.error).toBe('reservation_already_settled');

      // Only the settled retry's shares count; the lost attempt's records earn nothing.
      expect((await c1.claims({ stageShare: stageOffers[1] }).claimStageShares(route.admissions(1))).map((row) => row.outcome)).toEqual(['rejected', 'accepted']);
      expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0))).map((row) => row.outcome)).toEqual(['rejected', 'accepted']);

      // A lost attempt the requester stops retrying settles once as provider failure.
      route.loseStage(0, 1);
      const thread2 = requester.thread();
      expect((await requester.app.send(thread2, 'Question')).status).toBe('failed');
      expect(await requester.attempts.abandon(thread2)).toMatchObject({ status: 'settled', retryable: false });
      expect((await reservationOf(requester.attempts, thread2)).settlement).toMatchObject({ outcome: 'provider_failure', charge: 0 });
      expect(await requester.attempts.abandon(thread2)).toBeNull();
      await reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
    });
  });

  describe('contributor', () => {
    it('earns each stage share once within the settled-demand cap and refuses duplicates', async () => {
      const { c0, c1, route, stageOffers, requester, requesterAccount } = await network();
      const thread = requester.thread();
      expect((await requester.app.send(thread, 'Question')).status).toBe('completed');

      const c0Claims = c0.claims({ stageShare: stageOffers[0] });
      expect((await c0Claims.claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'done', outcome: 'accepted', issuance: 'issued' });
      // Settled demand allows half the net settled charge, so the second share waits for more demand.
      expect((await c1.claims({ stageShare: stageOffers[1] }).claimStageShares(route.admissions(1)))[0])
        .toMatchObject({ status: 'done', outcome: 'accepted', issuance: 'pending' });
      expect(await journal(c0.accountId)).toEqual([['issue', SHARE]]);
      expect(await journal(c1.accountId)).toEqual([]);
      // Observing the same records again sends nothing new.
      expect(await c0Claims.claimStageShares(route.admissions(0))).toEqual([expect.objectContaining({ status: 'done' })]);
      // Another stage's record, or the same share under a new key, earns nothing.
      const claim = (who, offerId, opId, admission, stageIndex) => who.client.send({ opId, path: `/offers/${offerId}/claims`,
        body: { stageIndex, contribution: { admission, ownerPolicyDigest: OWNER_DIGEST } } });
      const stolen = await claim(c1, stageOffers[1], 'claim:stolen', route.admissions(0)[0], 0);
      expect(stolen.validation.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['route_mismatch', 'contributor_admission_invalid']));
      const duplicate = await claim(c0, stageOffers[0], 'claim:again', route.admissions(0)[0], 0);
      expect(duplicate.validation).toMatchObject({ outcome: 'rejected', reasons: [expect.objectContaining({ code: 'duplicate_reward' })] });
      // A claim must match the reported route.
      expect((await c0.client.send({ opId: 'claim:mismatch', path: `/offers/${stageOffers[0]}/claims`, body: {
        stageIndex: 0, reservationId: 'rsv:other', contribution: { admission: route.admissions(0)[0], ownerPolicyDigest: OWNER_DIGEST } } })
        .catch((error) => error)).code).toBe('attempt_record_mismatch');

      // More settled demand; the issuance operator's resume issues the waiting share.
      expect((await requester.app.send(thread, 'Follow-up')).status).toBe('completed');
      const resumed = await http(base, 'POST', '/operator/rewards/issuance/resume', { token: 'operator-issuance', body: {} });
      expect(resumed.body.results).toEqual([expect.objectContaining({ status: 'issued', accountId: c1.accountId, amount: SHARE, provenance: 'earned' })]);
      expect(await journal(c1.accountId)).toEqual([['issue', SHARE]]);
      const solvency = await reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
      expect(solvency).toMatchObject({ spent: { total: 2 * FULL_CHARGE }, issued: { byProvenance: { earned: 2 * SHARE, purchased: 100 } }, held: { total: 0 } });

      // A refund under its authority restores the requester's credit and shrinks the settled-demand basis.
      const [first] = await reservationsOf(requesterAccount);
      await services.ledger.refundSettlement({ reservationId: first.reservationId, refundId: 'refund_1', amount: FULL_CHARGE,
        authority: { kind: 'operator_adjustment', decisionId: 'decision:refund', actorId: 'operator_test' }, idempotencyKey: 'refund:1' });
      const after = await reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
      expect(after).toMatchObject({ refunded: { total: FULL_CHARGE }, outstanding: { total: 100 - FULL_CHARGE + 2 * SHARE } });
      const late = await c0Claims.claimStageShares(route.admissions(0));
      expect(late.at(-1)).toMatchObject({ outcome: 'accepted', issuance: 'pending' });
    });

    it('earns a delivery once from the acquirer\'s attestation, drawing on a funded reservation without settled demand', async () => {
      const supplier = await contributor('supplier');
      const acquirerIdentity = await newIdentity('ECDSA');
      const acquirer = clientFor({ identity: acquirerIdentity, host: 'browser', subject: 'acquirer' });
      const { accountId: acquirerAccount } = await acquirer.ensureSession();
      const deliveryOffer = await offer(supplier, {
        offerId: 'offer_delivery',
        work: { category: 'verified_delivery', participantId: supplier.identity.peerId, pieces: [{ hash: await sha256Hex(PIECE_BYTES), sizeBytes: PIECE_BYTES.length }] },
        reward: { basis: { kind: 'test_per_delivered_byte' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'deliveredBytes', numerator: 1, denominator: 1 }] }, maxReward: 50 },
        resourceBounds: { transferBytes: { max: 1024, unit: 'byte' } }
      });
      // The operator funds delivery rewards through the funding routes.
      expect((await http(base, 'POST', '/operator/funding/commitments', { token: 'operator-funding', key: 'commit', body: {
        commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', externalRef: 'external:commitment_1',
        amount: 20, unit: { kind: 'credits' }, validFrom: clock(), validUntil: at(24 * 60 * MIN) } })).status).toBe(201);
      expect((await http(base, 'POST', '/operator/funding/reward-reservations', { token: 'operator-funding', key: 'reserve', body: {
        fundingId: 'funding_delivery', commitmentId: 'commitment_1', amount: 20, categories: ['verified_delivery'], decisionId: 'decision:delivery' } })).body)
        .toMatchObject({ status: 'active' });
      advance(MIN);

      // A real custody transfer; each host settles its own side through its client.
      const transfer = await transferPiece([acquirerIdentity, supplier.identity]);
      const supplierClaims = supplier.claims({ delivery: deliveryOffer });
      // Before the acquirer submits its attestation, the supplier's claim waits for a later try.
      expect((await supplierClaims.settleDeliveries([transfer.supplierRecord]))[0]).toMatchObject({ status: 'open', tries: 1 });
      const acquirerSide = createEarningContribution({ client: acquirer, ownerPolicyDigest: OWNER_DIGEST, hashEvidence: hashDopplerEvidence });
      const [submitted] = await acquirerSide.settleDeliveries([transfer.record]);
      expect(submitted).toMatchObject({ status: 'done', deliveryId: expect.stringMatching(/^dlv_[a-f0-9]{32}$/) });
      expect((await supplierClaims.settleDeliveries([transfer.supplierRecord]))[0]).toMatchObject({ status: 'done', outcome: 'accepted', issuance: 'issued' });
      // No settled demand exists, so the reward is subsidized from the operator's reservation.
      expect((await services.ledger.listJournal(supplier.accountId)).map((entry) => [entry.type, entry.amount, entry.lots[0].provenance]))
        .toEqual([['issue', PIECE_BYTES.length, 'subsidized']]);
      expect(await services.rewards.getFunding('funding_delivery')).toMatchObject({ authorized: PIECE_BYTES.length });
      // The delivery earns once.
      expect(await supplierClaims.settleDeliveries([transfer.supplierRecord])).toEqual([expect.objectContaining({ status: 'done' })]);
      const again = await supplier.client.send({ opId: 'claim:delivery-again', path: `/offers/${deliveryOffer}/claims`, body: { deliveryId: submitted.deliveryId } });
      expect(again.validation.reasons.map((reason) => reason.code)).toContain('duplicate_reward');
      expect(await issued(supplier.accountId)).toBe(1);
      await reconcileBooks([supplier.accountId, acquirerAccount]);
    });
  });

  describe('crash and restart', () => {
    it('after execution completes but before settlement: the stored report settles once on restart', async () => {
      // The report request never reaches the service; the requester host then stops.
      let offline = false;
      const flaky = (url, init) => (offline && url.endsWith('/reports') ? Promise.reject(new Error('host stopped')) : fetch(url, init));
      const { route, requester, requesterAccount, requesterIdentity } = await network({ fetch: flaky });
      offline = true;
      const thread = requester.thread();
      expect((await requester.app.send(thread, 'Question')).status).toBe('completed');
      expect(await requester.client.pending()).toEqual([expect.objectContaining({ opId: expect.stringMatching(/^report:/) })]);
      expect((await reservationsOf(requesterAccount))[0]).toMatchObject({ status: 'open' });

      // A restarted host on the same storage, past the quoted deadline: the route's own completion time settles it in full.
      advance(4 * MIN);
      const restarted = requesterHost({ route, identity: requesterIdentity, storage: requester.storage });
      const [result] = await restarted.attempts.reconcile();
      expect(result).toMatchObject({ ok: true, body: { rule: 'completed', settlement: { outcome: 'full', charge: FULL_CHARGE } } });
      expect(await restarted.attempts.getThread(thread)).toMatchObject({ status: 'settled' });
      expect(await restarted.client.pending()).toEqual([]);
      expect(await restarted.attempts.reconcile()).toEqual([]);
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);

      // A route record lost before it was stored leaves an acceptance no report settles: it expires and releases.
      offline = false;
      const lostHost = requesterHost({ route, identity: requesterIdentity, storage: requester.storage,
        fetch: (url, init) => (url.endsWith('/reports') ? Promise.reject(new Error('host stopped')) : fetch(url, init)) });
      expect((await lostHost.app.send(lostHost.thread(), 'Question')).status).toBe('completed');
      await requester.storage.delete('outbox');
      advance(11 * MIN);
      expect(await services.ledger.expireReservations()).toEqual([expect.objectContaining({ outcome: 'expired', charge: 0 })]);
      expect((await journal(requesterAccount)).slice(4)).toEqual([['reserve', 60], ['release', 60]]);
      await reconcileBooks([requesterAccount]);
    });

    it('after settlement but before the response: the retried report reconciles to the one settlement', async () => {
      let crash = true;
      const faulty = await start({ faultHooks: { afterComponent: ({ routeId }) => {
        if (routeId === REPORT_ROUTE && crash) { crash = false; throw new Error('process failed after the settlement committed'); }
      } } });
      const { route, requester, requesterAccount, requesterSession, requesterIdentity } = await network({ on: faulty });
      const thread = requester.thread();
      expect((await requester.app.send(thread, 'Question')).status).toBe('completed');
      // The ledger committed; the route's answer was lost, so the key stays unknown and the report pending.
      const [op] = await requester.client.pending();
      expect(await binding(REPORT_ROUTE, { accountId: requesterAccount, deviceId: requesterSession.deviceId }, op.key)).toMatchObject({ status: 'unknown' });
      expect((await reservationsOf(requesterAccount))[0]).toMatchObject({ status: 'settled' });

      // A restarted host, served by a restarted process: the same request reconciles to the committed settlement.
      const restarted = requesterHost({ route, identity: requesterIdentity, storage: requester.storage, on: await start() });
      const [result] = await restarted.attempts.reconcile();
      expect(result).toMatchObject({ ok: true, body: { settlement: { outcome: 'full', charge: FULL_CHARGE,
        settlementId: (await reservationsOf(requesterAccount))[0].settlement.settlementId } } });
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);
      expect(await restarted.attempts.getThread(thread)).toMatchObject({ status: 'settled' });
    });

    it('after the reward validates but before issuance: the retried claim issues the one validated reward', async () => {
      let stop = true;
      const rewards = { ...services.rewards, async issueReward(input) {
        if (stop) { stop = false; throw new Error('process stopped before issuance'); }
        return services.rewards.issueReward(input);
      } };
      const faulty = await start({ rewards });
      const { c0, route, stageOffers, requester, requesterAccount } = await network();
      expect((await requester.app.send(requester.thread(), 'Question')).status).toBe('completed');

      const onFaulty = clientFor({ on: faulty, identity: c0.identity, host: 'native', subject: c0.subject, storage: c0.storage });
      const claims = c0.claims({ stageShare: stageOffers[0] }, onFaulty);
      expect((await claims.claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'pending' });
      // The validation committed; nothing was issued and the claim's key stays unknown.
      const [op] = await onFaulty.pending();
      expect(await binding(CLAIM_ROUTE, { accountId: c0.accountId, deviceId: c0.session.deviceId }, op.key)).toMatchObject({ status: 'unknown' });
      expect(await issued(c0.accountId)).toBe(0);

      // The restarted host resends to a restarted process: the same validation issues once.
      const restarted = c0.claims({ stageShare: stageOffers[0] }, clientFor({ identity: c0.identity, host: 'native', subject: c0.subject, storage: c0.storage }));
      const [result] = await restarted.reconcile();
      expect(result).toMatchObject({ ok: true, body: { validation: { outcome: 'accepted', issuanceStatus: 'issued' }, issuance: { status: 'issued', amount: SHARE } } });
      expect((await restarted.claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'done', outcome: 'accepted', issuance: 'issued' });
      expect(await issued(c0.accountId)).toBe(1);
      expect((await services.rewards.listIssuanceDecisions()).filter((row) => row.allowed)).toHaveLength(1);
      await reconcileBooks([requesterAccount, c0.accountId]);
    });

    it('two server processes with the same keys settle and issue once', async () => {
      let entered;
      let open;
      const reached = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { open = resolve; });
      const first = await start({ faultHooks: { afterComponent: async ({ routeId }) => {
        if (routeId === REPORT_ROUTE) { entered(); await gate; }
      } } });
      const second = await start();
      const { c0, route, stageOffers, requester, requesterAccount, requesterIdentity } = await network({ on: first });
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      await reached;
      // While the first process holds the committed report, the second refuses the same key as in progress.
      const other = requesterHost({ route, identity: requesterIdentity, storage: requester.storage, on: second });
      expect(await other.attempts.reconcile()).toEqual([expect.objectContaining({ ok: false, code: 'idempotency_in_progress', pending: true })]);
      open();
      expect((await sending).status).toBe('completed');
      expect(await other.attempts.reconcile()).toEqual([]);
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['charge', FULL_CHARGE], ['release', 60 - FULL_CHARGE]]);

      // The same claim to both processes at once, under the device's one session: one validation and one issued reward.
      const session = await c0.storage.get('session');
      const racing = [];
      for (const on of [first, second]) {
        const storage = hostStorage();
        await storage.set('session', session);
        racing.push(c0.claims({ stageShare: stageOffers[0] }, clientFor({ on, identity: c0.identity, host: 'native', subject: c0.subject, storage })));
      }
      const results = await Promise.all(racing.map((claims) => claims.claimStageShares(route.admissions(0))));
      for (const [row] of results) expect(['done', 'pending']).toContain(row.status);
      for (const claims of racing) await claims.reconcile();
      const settled = await Promise.all(racing.map((claims) => claims.claimStageShares(route.admissions(0))));
      expect(settled.map(([row]) => [row.status, row.outcome, row.issuance])).toEqual([['done', 'accepted', 'issued'], ['done', 'accepted', 'issued']]);
      expect(await issued(c0.accountId)).toBe(1);
      await reconcileBooks([requesterAccount, c0.accountId]);
    });
  });

  describe('sessions', () => {
    it('binds a later session to a registered device after its session expires, and only for that device\'s account', async () => {
      const c0 = await contributor('contributor-0');
      advance(ACCOUNT_POLICY.sessionTtlMs + MIN);
      expect((await c0.client.get('/balances').catch((error) => error)).code).toBe('session_expired');
      const renewed = await c0.client.ensureSession();
      expect(renewed).toMatchObject({ deviceId: c0.session.deviceId, accountId: c0.accountId });
      expect(renewed.sessionId).not.toBe(c0.session.sessionId);
      expect((await c0.client.get('/balances')).accountId).toBe(c0.accountId);

      const signIn = async (subject) => (await http(base, 'POST', '/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject }) } })).body.session;
      const bind = async (session, identity, key) => {
        const challenge = (await http(base, 'POST', '/devices/challenges', { token: session.token })).body;
        return http(base, 'POST', `/devices/${c0.session.deviceId}/sessions`, { token: session.token, key, body: { sessionBinding: await createSessionBinding({ identity, challenge }) } });
      };
      // Another account cannot bind this device; another key cannot sign for it; a bound session cannot rebind.
      expect((await bind(await signIn('someone-else'), c0.identity, 'b1')).body.error).toBe('device_not_found');
      expect((await bind(await signIn(c0.subject), await newIdentity('Ed25519'), 'b2')).body.error).toBe('session_binding_invalid');
      expect((await bind(renewed, c0.identity, 'b3')).body.error).toBe('session_already_bound');
      // A revoked device binds nothing.
      const desk = await signIn(c0.subject);
      expect((await http(base, 'DELETE', `/devices/${c0.session.deviceId}`, { token: desk.token, key: 'revoke', body: { reason: 'retired' } })).status).toBe(200);
      expect((await bind(await signIn(c0.subject), c0.identity, 'b4')).body.error).toBe('device_not_found');
    });
  });

  describe('revoked device mid-flow', () => {
    it('refuses a revoked requester\'s report and retry, releases its hold on expiry and pays no share for it', async () => {
      const { c0, route, stageOffers, requester, requesterAccount, requesterSession } = await network();
      const hold = route.hold(1, 1);
      const thread = requester.thread();
      const sending = requester.app.send(thread, 'Question');
      await hold.entered;
      // The account holder revokes the phone from another session while its attempt runs.
      const desk = await http(base, 'POST', '/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: 'requester' }) } });
      expect((await http(base, 'DELETE', `/devices/${requesterSession.deviceId}`, { token: desk.body.session.token, key: 'revoke', body: { reason: 'retired' } })).status).toBe(200);
      hold.release();
      expect((await sending).status).toBe('completed');
      // The report is refused for good; nothing is charged and no retry can bind.
      expect(await requester.client.pending()).toEqual([]);
      const [reservation] = await reservationsOf(requesterAccount);
      expect(reservation).toMatchObject({ status: 'open', attempts: [expect.objectContaining({ status: 'bound' })] });
      expect((await http(base, 'POST', `/reservations/${reservation.reservationId}/attempts`, { token: requesterSession.token, key: 'retry',
        body: { attemptId: 'att_retry', recipients: [c0.identity.peerId] } })).body.error).toBe('session_device_revoked');
      // The declared release rule returns the hold at expiry; the unsettled work earns nothing.
      advance(11 * MIN);
      expect(await services.ledger.expireReservations()).toEqual([expect.objectContaining({ outcome: 'expired', charge: 0 })]);
      expect(await journal(requesterAccount)).toEqual([['issue', 100], ['reserve', 60], ['release', 60]]);
      expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ status: 'open', tries: 1 });
      expect(await issued(c0.accountId)).toBe(0);
      await reconcileBooks([requesterAccount, c0.accountId]);
    });

    it('refuses a revoked contributor device\'s claim after its stage executed and settled', async () => {
      const { c0, c1, route, stageOffers, requester, requesterAccount } = await network();
      expect((await requester.app.send(requester.thread(), 'Question')).status).toBe('completed');
      const desk = await http(base, 'POST', '/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: c1.subject }) } });
      expect((await http(base, 'DELETE', `/devices/${c1.session.deviceId}`, { token: desk.body.session.token, key: 'revoke', body: { reason: 'retired' } })).status).toBe(200);
      expect((await c1.claims({ stageShare: stageOffers[1] }).claimStageShares(route.admissions(1)))[0]).toMatchObject({ status: 'done', refused: 'session_device_revoked' });
      expect((await c0.claims({ stageShare: stageOffers[0] }).claimStageShares(route.admissions(0)))[0]).toMatchObject({ outcome: 'accepted', issuance: 'issued' });
      expect(await issued(c1.accountId)).toBe(0);
      await reconcileBooks([requesterAccount, c0.accountId, c1.accountId]);
    });
  });
}, 60_000);
