// The earning loop over the authenticated routes with actual execution: a chat workspace sends through
// the browser host's chat execution, whose earning client quotes, accepts, binds and reports each
// partition attempt over a route of real resident stages run by the library's ordered route runner;
// native contributor hosts claim and submit evidence through their own clients. Real accounts, ledger,
// rewards and route idempotency over memory or fake-Firestore stores. Test-only provider, policies and
// amounts; none is a product decision.
import express from 'express';
import { expect } from 'vitest';

import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createRemotePermission, remotePermissionNeed } from '../../packages/reploid/src/chat/remote-permission.js';
import { MAX_UNACKNOWLEDGED_OUTPUTS, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createFirestoreRouteBackend, createMemoryRouteBackend, createRouteIdempotency } from '../../server/earning-routes/idempotency.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/attempt-evidence.js';
import { createChatExecution } from '../../self/host/chat-execution.js';
import { createEarningAttempts } from '../../self/host/earning/attempts.js';
import { EARNING_CLIENT_SCHEMA, createEarningClient } from '../../self/host/earning/client.js';
import { createEarningContribution } from '../../self/host/earning/contribution.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { newIdentity, openAccountFixture } from './account-fixture.js';
import { STEPS, residentRoute } from './resident-route.js';
import { FUNDING_ADMIN, ISSUANCE_POLICY, MIN, MODEL, OWNER_DIGEST, fund, fundingAuthority, fx, offerInput, ownerAuthorization, quoteInput } from './reward-fixture.js';

export const LIMITS = Object.freeze({
  jsonBytes: 16 * 1024, evidenceJsonBytes: 256 * 1024, idempotencyLeaseMs: 30_000,
  address: { max: 10_000, windowMs: MIN }, signIn: { max: 100, windowMs: MIN }, account: { max: 1000, windowMs: MIN },
  device: { max: 1000, windowMs: MIN }, operator: { max: 1000, windowMs: MIN }
});
export const OPERATORS = Object.freeze({
  'operator-funding': { actorId: FUNDING_ADMIN, roles: ['funding'] },
  'operator-issuance': { actorId: 'issuance_test', roles: ['issuance'] },
  'operator-settlement': { actorId: 'settlement_test', roles: ['settlement'] }
});
// Test-only evidence terms: decisions wait five minutes after the quoted deadline.
export const EVIDENCE_TERMS = Object.freeze({ rulesId: EVIDENCE_RULES_ID, windowMs: 5 * MIN, clockSkewMs: 30_000,
  // The stages' receiver-policy bound; the ledger refuses any other value.
  maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS });
export const REPORT_SCHEMA = 'reploid.attempt-report/v1';
// The fixture quote charges 10 + ceil(output / 2) in full; offers pay a third of the settled charge.
export const FULL_CHARGE = 10 + Math.ceil(STEPS / 2);
export const SHARE = Math.ceil(FULL_CHARGE / 3);
export const PERMISSION_WORDING = Object.freeze({ id: 'remote-contributors-test', version: 'test/1', text: 'Test-only remote contributor permission wording.' });

/** Durable host storage that outlives a client, as a restarted host's storage does. */
export const hostStorage = () => {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
    set: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async (key) => { map.delete(key); }
  };
};

/** One harness per test: `open()` before, `close()` after. `evidence` adds evidence terms to every quote. */
export function createEarningHarness(kind, { evidence = EVIDENCE_TERMS } = {}) {
  const servers = [];
  const cleanups = [];
  const h = { kind, harness: null, provider: null, services: null, base: null };

  const idempotencyBackend = () => (kind === 'memory'
    ? createMemoryRouteBackend({ state: h.harness.states.identity })
    : createFirestoreRouteBackend({ firestore: h.harness.dbs.identity, collectionPrefix: 'test' }));

  /** One router process over the shared stores. */
  h.start = async (overrides = {}) => {
    const app = express();
    await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition: {
      ...h.services,
      quoteTerms: async ({ accountId, request }) => {
        if (request?.modelId !== MODEL.modelId || request.modelIdentity !== MODEL.modelIdentity) return null;
        const { service, pricing, terms } = quoteInput({ quoteId: 'unused', accountId });
        return { service, pricing, terms: evidence ? { ...terms, evidence } : terms };
      },
      operatorAuthority: { authenticate: async ({ token }) => OPERATORS[token] ?? null },
      idempotencyBackend: idempotencyBackend(), limits: LIMITS, nowMs: () => fx.nowMs, log: { error() {} }, ...overrides
    } });
    installJsonBodyMiddleware(app, {});
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };

  h.http = async (on, method, path, { token, key, body } = {}) => {
    const response = await fetch(`${on}/v1${path}`, { method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  h.clientFor = ({ on = h.base, identity, host, subject, storage = hostStorage(), fetch: fetchPort = fetch }) => createEarningClient({
    config: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: `${on}/v1`, providerId: h.provider.providerId },
    identity, host, storage, fetch: fetchPort, signIn: async () => h.provider.issue({ subject })
  });

  /** A native contributor host: its own sign-in, device registration bound to its session, and owner record. */
  h.contributor = async (subject, { on = h.base, fetch: fetchPort } = {}) => {
    const identity = await newIdentity('Ed25519');
    const storage = hostStorage();
    const client = h.clientFor({ on, identity, host: 'native', subject, storage, fetch: fetchPort });
    const session = await client.ensureSession();
    const claims = (offers = {}, over = client) => createEarningContribution({ client: over, offers, ownerPolicyDigest: OWNER_DIGEST, hashEvidence: hashDopplerEvidence });
    await claims().recordOwnerAuthorization(ownerAuthorization);
    // The stage host signs receipts on its own clock, the fixture clock here.
    return { subject, identity, storage, client, session, accountId: session.accountId, claims,
      signer: createAttemptEvidenceSigner({ identity, now: () => fx.nowMs }) };
  };

  /** The system offers a contributor work; the contributor's host accepts it under its owner policy. */
  h.offer = async (host, overrides) => {
    const created = await h.services.rewards.createOffer({
      ...offerInput({ accountId: host.accountId, participantId: host.identity.peerId, ...overrides }), idempotencyKey: `offer:${overrides.offerId}`
    });
    await host.claims().acceptOffer(created.offerId, ownerAuthorization);
    return created.offerId;
  };

  h.quoteRequest = (request) => ({ modelId: request.model.id, modelIdentity: request.model.identity, operation: 'chat.completion' });

  /** The requester's browser host: a chat workspace over the host's chat execution and its earning attempts. */
  h.requesterHost = ({ route, identity, storage = hostStorage(), on = h.base, fetch: fetchPort, generate = null }) => {
    const client = h.clientFor({ on, identity, host: 'browser', subject: 'requester', storage, fetch: fetchPort });
    const timers = [];
    const attempts = createEarningAttempts({
      client, now: () => fx.nowMs, quoteRequest: h.quoteRequest, authorizeSpending: async ({ quote }) => quote.pricing.maxCharge <= 60,
      setTimer: (callback, ms) => { const timer = { callback, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }
    });
    const partitions = generate ? { ...route.requester, generate } : route.requester;
    const execution = createChatExecution({ service: {}, partitions, models: [], getModels: () => [route.model],
      profile: { generation: {}, maxOutcomeCharacters: 1000 }, earning: attempts });
    // The one-time remote contributor permission; no per-request review follows it.
    const permission = createRemotePermission({ id: 'remote', grantedAt: 1, wording: PERMISSION_WORDING, need: remotePermissionNeed({
      networkId: 'mesh', sharingScope: 'mesh', disclosure: 'ordered-partition-activations-and-tokens', model: route.model }) });
    let saved = null;
    const app = createChatWorkspace({ meshId: 'mesh', participantId: identity.peerId, remotePermissions: () => [permission],
      store: { load: () => structuredClone(saved), save: (value) => { saved = structuredClone(value); } }, execute: execution.execute });
    cleanups.push(() => app.close());
    const thread = () => app.createThread({ model: route.model, permissions: { sharingScope: 'mesh' } });
    return {
      client, attempts, app, storage, thread,
      fireDeadline: () => timers.filter((timer) => !timer.cancelled).forEach((timer) => timer.callback())
    };
  };

  /** Two native contributors whose residents sign receipts, a funded browser requester and their route. */
  h.network = async ({ on = h.base, fetch: fetchPort, generate = null, signers = null, steps, acknowledgmentWaitMs } = {}) => {
    const c0 = await h.contributor('contributor-0');
    const c1 = await h.contributor('contributor-1');
    const requesterIdentity = await newIdentity('ECDSA');
    const route = await residentRoute({ participants: [c0.identity.peerId, c1.identity.peerId], requesterId: requesterIdentity.peerId,
      signers: signers ?? [c0.signer, c1.signer], ...(steps ? { steps } : {}), ...(acknowledgmentWaitMs ? { acknowledgmentWaitMs } : {}) });
    cleanups.push(() => route.close());
    const stageOffers = [await h.offer(c0, { offerId: 'offer_stage_0' }), await h.offer(c1, { offerId: 'offer_stage_1' })];
    const requester = h.requesterHost({ route, identity: requesterIdentity, on, fetch: fetchPort,
      ...(generate ? { generate: generate(route.requester.generate) } : {}) });
    const session = await requester.client.ensureSession();
    await fund(h.services.ledger, session.accountId, 100);
    return { c0, c1, route, stageOffers, requester, requesterIdentity, requesterAccount: session.accountId, requesterSession: session };
  };

  h.journal = async (accountId) => (await h.services.ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);
  h.reservationsOf = (accountId) => h.services.ledger.listAccountReservations(accountId);
  h.binding = (routeId, caller, key) => createRouteIdempotency({ backend: idempotencyBackend(), leaseMs: LIMITS.idempotencyLeaseMs, nowMs: () => fx.nowMs })
    .get({ routeId, caller, key });
  h.issued = async (accountId) => (await h.services.ledger.listJournal(accountId)).filter((entry) => entry.type === 'issue').length;
  h.operator = (method, path, body, key) => h.http(h.base, method, path, { token: 'operator-settlement', key, body });

  /** Balances, journals, solvency (open, reviewed and disputed holds) and the issuance bases agree. */
  h.reconcileBooks = async (accountIds) => {
    let outstanding = 0;
    for (const accountId of accountIds) {
      expect(await h.services.ledger.auditAccount(accountId)).toMatchObject({ consistent: true });
      const account = await h.services.ledger.getAccount(accountId);
      outstanding += account.available + account.held;
    }
    const solvency = await h.services.ledger.getSolvencySnapshot();
    expect(solvency.accountsObserved).toBeGreaterThanOrEqual(accountIds.length);
    expect(solvency.outstanding.total).toBe(outstanding);
    expect(solvency.issued.total - solvency.spent.total + solvency.refunded.total - solvency.reversed.total).toBe(solvency.outstanding.total);
    expect(solvency.held.total).toBe(solvency.reservations.open.held + solvency.reservations.underReview.held + solvency.reservations.disputed.held);
    const bases = await h.services.rewards.getIssuanceState();
    expect(bases.byBasis.settled_demand).toBe(solvency.issued.byProvenance.earned);
    expect(bases.byBasis.funded_reservation).toBe(solvency.issued.byProvenance.subsidized);
    return solvency;
  };

  /** `communityPoolAccountIds` names Community Access pools that accept quotes for the requester devices they admit. */
  h.open = async ({ communityPoolAccountIds = [] } = {}) => {
    ({ harness: h.harness, provider: h.provider } = openAccountFixture(kind));
    // Stage receipts and route receipts carry the hosts' wall clocks; the fixture clock starts from it.
    fx.nowMs = Date.now();
    h.services = h.harness.open({ fundingAuthority, issuancePolicy: ISSUANCE_POLICY, communityPoolAccountIds });
    h.base = await h.start();
    return h;
  };

  h.close = async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })));
  };
  return h;
}
