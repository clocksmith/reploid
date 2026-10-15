// @vitest-environment node
// The earning-loop routes over real in-process HTTP: authentication per route, spending,
// balances, delivery claims from a real custody transfer, operator funding and links, limits,
// and the configuration switch. Test-only provider, policies, tokens and amounts.
import { MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { EVIDENCE_RULES_ID } from '../../server/ledger/domain.js';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deliveryEvidenceFromRecord, deliveryEvidenceId } from '../../packages/reploid/src/artifacts/delivery-attestation.js';
import { createDeviceRegistrationProof, createSessionBinding } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { createCommunityAccess } from '../../server/community-access/engine.js';
import { createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { createFirestoreRouteBackend, createMemoryRouteBackend, createRouteIdempotency } from '../../server/earning-routes/idempotency.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { ACCOUNT_POLICY, newIdentity, openAccountFixture } from '../helpers/account-fixture.js';
import { PIECE_BYTES, transferPiece } from '../helpers/custody-transfer.js';
import {
  FUNDING_ADMIN, MIN, START, advance, at, clock, fund, fundingAuthority, fx, ownerAuthorization, quoteInput
} from '../helpers/reward-fixture.js';

// Test-only limits, operator credentials and Community Access policy; none is a product decision.
const LIMITS = Object.freeze({
  jsonBytes: 16 * 1024,
  evidenceJsonBytes: 256 * 1024,
  idempotencyLeaseMs: 30_000,
  address: { max: 10_000, windowMs: MIN },
  signIn: { max: 100, windowMs: MIN },
  account: { max: 1000, windowMs: MIN },
  device: { max: 1000, windowMs: MIN },
  operator: { max: 1000, windowMs: MIN }
});
const OPERATORS = Object.freeze({
  'operator-funding': { actorId: FUNDING_ADMIN, roles: ['funding'] },
  'operator-unauthorized-funder': { actorId: 'funding_other_test', roles: ['funding'] },
  'operator-settlement': { actorId: 'settlement_test', roles: ['settlement'] },
  'operator-settlement-2': { actorId: 'settlement_other_test', roles: ['settlement'] },
  'operator-issuance': { actorId: 'issuance_test', roles: ['issuance'] },
  'operator-links': { actorId: 'links_test', roles: ['links'] },
  'operator-audit': { actorId: 'audit_test', roles: ['audit'] }
});
const operatorAuthority = { authenticate: async ({ token }) => OPERATORS[token] ?? null };
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
const ENABLED = Object.freeze({ REPLOID_EARNING_ROUTES: 'enabled' });

const servers = [];
afterEach(async () => {
  // A test may leave a request hanging to model a stopped process; drop its connection.
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

const listen = async (app) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

/** One HTTP request; `body` is JSON unless it is already a string. */
const request = async (base, method, path, { token, body, key, headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
      ...headers
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, body: json, text, headers: response.headers };
};

describe.each(['memory', 'firestore'])('earning routes over HTTP (%s store)', (kind) => {
  let harness;
  let provider;
  let services;
  let quoteRequests;
  let base;
  let call;

  // Idempotency-Key bindings live beside the account database, on the same kind of store.
  const idempotencyBackend = () => (kind === 'memory'
    ? createMemoryRouteBackend({ state: harness.states.identity })
    : createFirestoreRouteBackend({ firestore: harness.dbs.identity, collectionPrefix: 'test' }));

  /** The composition an operator module would return: stores, ports and limits. */
  const composition = (overrides = {}) => {
    const communityAccess = createCommunityAccess({
      backend: createMemoryCommunityAccessBackend(), ledger: services.ledger, policy: ACCESS_POLICY, fundingAuthority, clock,
      accounts: { participantAccount: services.identity.participantAccount }, readCommunityCapacity: async () => null
    });
    // The service and price policy: clients send a request, never terms.
    const quoteTerms = async ({ accountId, deviceId, request: wanted }) => {
      quoteRequests.push({ accountId, deviceId, request: wanted });
      const { service, pricing, terms } = quoteInput({ quoteId: 'unused', accountId });
      return { service, pricing, terms };
    };
    return {
      ...services, communityAccess, quoteTerms, operatorAuthority, idempotencyBackend: idempotencyBackend(),
      limits: LIMITS, nowMs: () => fx.nowMs, log: { error() {} }, ...overrides
    };
  };

  /** An app shaped like server/proxy.js: earning routes, then the general parser, then the Pool router. */
  const start = async ({ env = ENABLED, overrides = {} } = {}) => {
    const app = express();
    const mounted = await mountEarningRoutes(app, { env, composition: composition(overrides) });
    installJsonBodyMiddleware(app, {});
    app.use('/pool', createPoolRouter({ store: createPoolStore(), allowUnauthenticatedLocal: true }));
    app.use((req, res) => res.status(404).send('File not found'));
    return { mounted, base: await listen(app) };
  };

  beforeEach(async () => {
    ({ harness, provider } = openAccountFixture(kind));
    services = harness.open({ fundingAuthority });
    quoteRequests = [];
    ({ base } = await start());
    call = (method, path, options) => request(base, method, path, options);
  });

  const signIn = async (subject, options = {}) => {
    const response = await call('POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject, ...options }) } });
    expect(response.status).toBe(200);
    return response.body;
  };

  /** Register `identity` through HTTP; a binding host signs its own session binding. */
  const register = async (session, identity, { host = 'browser', bind = false, key = `register:${identity.peerId}` } = {}) => {
    const challenge = await call('POST', '/v1/devices/challenges', { token: session.token });
    expect(challenge.status).toBe(201);
    const proof = await createDeviceRegistrationProof({ identity, challenge: challenge.body, host });
    const body = { proof, bindSession: bind, ...(bind ? { sessionBinding: await createSessionBinding({ identity, challenge: challenge.body }) } : {}) };
    return call('POST', '/v1/devices', { token: session.token, key, body });
  };

  /** A signed-in account whose session acts as a registered browser device. */
  const browserParticipant = async (subject) => {
    const { account, session } = await signIn(subject);
    const identity = await newIdentity('ECDSA');
    const registration = await register(session, identity, { bind: true });
    expect(registration.status).toBe(201);
    return { account, session, identity, deviceId: registration.body.deviceId };
  };

  /** A quote, acceptance, bound attempt and operator settlement through HTTP; returns the settled reservation id. */
  const spend = async (who, label) => {
    const quote = await call('POST', '/v1/quotes', { token: who.session.token, key: `quote:${label}`, body: { request: { service: 'chat' } } });
    expect(quote.status).toBe(201);
    const accepted = await call('POST', `/v1/quotes/${quote.body.quoteId}/accept`, { token: who.session.token, key: `accept:${label}`, body: { quoteHash: quote.body.quoteHash } });
    expect(accepted.status).toBe(200);
    const { reservationId } = accepted.body;
    expect((await call('POST', `/v1/reservations/${reservationId}/attempts`, {
      token: who.session.token, key: `bind:${label}`, body: { attemptId: `att_${label}`, recipients: ['peer_c0'] }
    })).status).toBe(200);
    const settled = await call('POST', `/v1/operator/reservations/${reservationId}/settle`, {
      token: 'operator-settlement', key: `settle:${label}`,
      body: { billableEventId: `event_${label}`, outcome: 'full', attemptId: `att_${label}`, metering: { output: 40 }, completedAt: clock() }
    });
    expect(settled.status).toBe(200);
    return { quote: quote.body, reservationId, settlement: settled.body };
  };

  describe('accounts, sessions and devices', () => {
    it('authenticates each route by session and keeps every device action inside its own account', async () => {
      expect((await call('GET', '/v1/accounts/me')).body).toMatchObject({ error: 'session_required' });
      expect((await call('GET', '/v1/accounts/me', { token: 'ses_unknown0000.' + 'a'.repeat(43) })).status).toBe(401);
      const assertion = provider.issue({ subject: 'alice' });
      const first = await call('POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion } });
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      // An assertion signs in once; account and device never come from the body.
      expect((await call('POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion } })).body.error).toBe('assertion_replayed');
      expect((await call('POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion, accountId: 'acct_x' } })).status).toBe(400);
      const alice = first.body;
      const me = await call('GET', '/v1/accounts/me', { token: alice.session.token });
      expect(me.body).toMatchObject({ session: { accountId: alice.account.accountId, deviceId: null }, account: { accountId: alice.account.accountId } });

      const phone = await newIdentity('ECDSA');
      const laptop = await newIdentity('Ed25519');
      expect((await call('POST', '/v1/devices', { token: alice.session.token, body: {} })).body.error).toBe('idempotency_key_required');
      // A native host answering this session's challenge signs no session binding, so this session cannot act as it.
      const challenge = (await call('POST', '/v1/devices/challenges', { token: alice.session.token })).body;
      const nativeProof = await createDeviceRegistrationProof({ identity: laptop, challenge, host: 'native' });
      expect((await call('POST', '/v1/devices', { token: alice.session.token, key: 'bind:native', body: { proof: nativeProof, bindSession: true } })).status).toBe(403);
      const native = await call('POST', '/v1/devices', { token: alice.session.token, key: 'register:native', body: { proof: nativeProof } });
      expect(native.body).toMatchObject({ host: 'native', sessionBound: false });
      const bound = await register(alice.session, phone, { bind: true });
      expect(bound.status).toBe(201);
      expect(bound.body.sessionBound).toBe(true);
      expect((await call('GET', '/v1/devices', { token: alice.session.token })).body.devices.map((device) => device.deviceId).sort())
        .toEqual([native.body.deviceId, bound.body.deviceId].sort());

      // Owner grants: the owning account's session, native devices only.
      const bob = await signIn('bob');
      const putOwner = (token, deviceId, key) => call('PUT', `/v1/devices/${deviceId}/owner-authorization`, { token, key, body: { ownerAuthorization } });
      expect((await putOwner(bob.session.token, native.body.deviceId, 'owner:bob')).body.error).toBe('device_not_found');
      expect((await putOwner(alice.session.token, bound.body.deviceId, 'owner:browser')).body.error).toBe('owner_record_native_only');
      expect((await putOwner(alice.session.token, native.body.deviceId, 'owner:native')).body).toMatchObject({ deviceId: native.body.deviceId });

      // Revocation: another account cannot revoke; the owner can, and the bound session stops at once.
      const revoke = (token, deviceId, key) => call('DELETE', `/v1/devices/${deviceId}`, { token, key, body: { reason: 'retired' } });
      expect((await revoke(bob.session.token, bound.body.deviceId, 'revoke:bob')).status).toBe(404);
      const desk = await signIn('alice');
      expect((await revoke(desk.session.token, bound.body.deviceId, 'revoke:phone')).status).toBe(200);
      const revoked = await call('POST', '/v1/quotes', { token: alice.session.token, key: 'quote:revoked', body: { request: {} } });
      expect([revoked.status, revoked.body.error]).toEqual([401, 'session_device_revoked']);

      // Ending a session refuses it afterwards.
      expect((await call('POST', '/v1/sessions/end', { token: desk.session.token })).status).toBe(200);
      expect((await call('GET', '/v1/accounts/me', { token: desk.session.token })).body.error).toBe('session_ended');
    });

    it('recovers with a recent provider assertion only, ending every earlier session', async () => {
      const alice = await browserParticipant('alice');
      const recover = (options) => call('POST', '/v1/accounts/recover', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: 'alice', ...options }) } });
      const stale = await recover({ authenticatedAt: new Date(fx.nowMs - ACCOUNT_POLICY.recoveryMaxAuthAgeMs - 1).toISOString() });
      expect([stale.status, stale.body.error]).toEqual([401, 'reauthentication_required']);
      const recovered = await recover();
      expect(recovered.status).toBe(200);
      expect(recovered.body.recovery.revokedDeviceIds).toEqual([alice.deviceId]);
      expect((await call('GET', '/v1/accounts/me', { token: alice.session.token })).body.error).toBe('session_revoked');
      expect((await call('GET', '/v1/balances', { token: recovered.body.session.token })).status).toBe(200);
      expect((await call('POST', '/v1/accounts/recover', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: 'nobody' }) } })).status).toBe(404);
    });
  });

  describe('spending and balances', () => {
    it('quotes, accepts, reserves, binds and settles through HTTP, with balances, reservations and journal for the own account', async () => {
      const alice = await browserParticipant('alice');
      const bob = await browserParticipant('bob');
      const unbound = (await signIn('alice')).session;
      await fund(services.ledger, alice.account.accountId, 100);

      // Quotes need a device-bound session, and clients never author terms.
      expect((await call('POST', '/v1/quotes', { token: unbound.token, key: 'q', body: { request: {} } })).body.error).toBe('device_session_required');
      expect((await call('POST', '/v1/quotes', { token: alice.session.token, key: 'q', body: { request: {}, pricing: { maxCharge: 0 } } })).status).toBe(400);
      const quote = await call('POST', '/v1/quotes', { token: alice.session.token, key: 'quote:1', body: { request: { service: 'chat' } } });
      expect(quote.status).toBe(201);
      expect(quote.body).toMatchObject({ accountId: alice.account.accountId, status: 'offered', pricing: { maxCharge: 60 } });
      expect(quoteRequests).toEqual([{ accountId: alice.account.accountId, deviceId: alice.deviceId, request: { service: 'chat' } }]);
      // A retried request replays the response first stored under its key.
      const retried = await call('POST', '/v1/quotes', { token: alice.session.token, key: 'quote:1', body: { request: { service: 'chat' } } });
      expect([retried.status, retried.body, retried.headers.get('idempotent-replayed')]).toEqual([201, quote.body, 'true']);

      const accept = (who, key) => call('POST', `/v1/quotes/${quote.body.quoteId}/accept`, { token: who.session.token, key, body: { quoteHash: quote.body.quoteHash } });
      expect((await accept(bob, 'accept:bob')).body.error).toBe('quote_account_mismatch');
      const accepted = await accept(alice, 'accept:alice');
      expect(accepted.body).toMatchObject({ authorizedMax: 60, deviceId: alice.deviceId });
      expect((await accept(alice, 'accept:alice')).body).toEqual(accepted.body);
      const { reservationId } = accepted.body;
      expect((await call('GET', '/v1/balances', { token: alice.session.token })).body).toMatchObject({ available: 40, held: 60 });

      // Attempts bind from the reservation's own account; settlement needs the settlement role.
      const bind = (who, key) => call('POST', `/v1/reservations/${reservationId}/attempts`, { token: who.session.token, key, body: { attemptId: 'att_1', recipients: ['peer_c0'] } });
      expect((await bind(bob, 'bind:bob')).status).toBe(404);
      expect((await bind(alice, 'bind:alice')).status).toBe(200);
      const settlement = { billableEventId: 'event_1', outcome: 'full', attemptId: 'att_1', metering: { output: 40 }, completedAt: clock() };
      const settle = (token, key = 'settle:1') => call('POST', `/v1/operator/reservations/${reservationId}/settle`, { token, key, body: settlement });
      expect((await settle(undefined)).body.error).toBe('operator_credential_required');
      expect((await settle(alice.session.token)).body.error).toBe('operator_credential_invalid');
      expect((await settle('operator-funding')).body.error).toBe('operator_role_required');
      const settled = await settle('operator-settlement');
      expect(settled.body).toMatchObject({ outcome: 'full', charge: 30 });
      expect((await settle('operator-settlement')).body).toEqual(settled.body);

      expect((await call('GET', '/v1/balances', { token: alice.session.token })).body).toMatchObject({ available: 70, held: 0 });
      expect((await call('GET', '/v1/reservations', { token: alice.session.token })).body.reservations).toEqual([
        expect.objectContaining({ reservationId, status: 'settled', accountId: alice.account.accountId })
      ]);
      expect((await call('GET', '/v1/reservations', { token: bob.session.token })).body.reservations).toEqual([]);
      expect((await call('GET', `/v1/reservations/${reservationId}`, { token: bob.session.token })).status).toBe(404);
      expect((await call('GET', `/v1/reservations/${reservationId}`, { token: unbound.token })).body).toMatchObject({ reservationId, status: 'settled' });
      expect((await call('GET', '/v1/journal', { token: alice.session.token })).body.entries.map((entry) => [entry.type, entry.amount]))
        .toEqual([['issue', 100], ['reserve', 60], ['charge', 30], ['release', 30]]);
    });
  });

  describe('delivery claims', () => {
    it('validates a contributor\'s delivery claim end to end from a real transfer and the acquirer\'s HTTP-submitted attestation', async () => {
      // Supplier: a native contributor registered from its owner's browser session, which acts as the browser device.
      const supplier = await browserParticipant('supplier');
      const native = await newIdentity('Ed25519');
      const nativeDevice = (await register(supplier.session, native, { host: 'native' })).body;
      expect((await call('PUT', `/v1/devices/${nativeDevice.deviceId}/owner-authorization`, {
        token: supplier.session.token, key: 'owner:native', body: { ownerAuthorization }
      })).status).toBe(200);
      const acquirer = await browserParticipant('acquirer');
      const requester = await browserParticipant('requester');
      await fund(services.ledger, requester.account.accountId, 100);

      // The system offers delivery work to the supplier's account; the contributor reads and accepts it over HTTP.
      const offer = await services.rewards.createOffer({
        offerId: 'offer_delivery', accountId: supplier.account.accountId,
        work: { category: 'verified_delivery', participantId: native.peerId, pieces: [{ hash: await sha256Hex(PIECE_BYTES), sizeBytes: PIECE_BYTES.length }] },
        reward: { basis: { kind: 'test_per_delivered_byte' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'deliveredBytes', numerator: 1, denominator: 1 }] }, maxReward: 50 },
        resourceBounds: { transferBytes: { max: 1024, unit: 'byte' } },
        duration: { startsAt: clock(), endsAt: at(40 * MIN) }, validUntil: at(5 * MIN),
        paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN }, failureCompensation: { kind: 'none' },
        idempotencyKey: 'offer:delivery'
      });
      expect((await call('GET', '/v1/offers/offer_delivery', { token: acquirer.session.token })).status).toBe(404);
      expect((await call('GET', '/v1/offers/offer_delivery', { token: supplier.session.token })).body.offerHash).toBe(offer.offerHash);
      expect((await call('POST', '/v1/offers/offer_delivery/accept', {
        token: supplier.session.token, key: 'accept:offer', body: { offerHash: offer.offerHash, ownerAuthorization }
      })).body).toMatchObject({ offerId: 'offer_delivery', accountId: supplier.account.accountId });
      advance(MIN);

      // A real transfer: the acquirer's browser exchange attests the receipt with its certified custody key.
      const transfer = await transferPiece([acquirer.identity, native]);
      const evidence = deliveryEvidenceFromRecord(transfer.record);
      expect(evidence.attestation.attestedAt).toBe(clock());
      const submit = (token) => call('POST', '/v1/deliveries', { token, body: evidence });
      expect((await submit(undefined)).status).toBe(401);
      expect((await submit((await signIn('acquirer')).session.token)).body.error).toBe('device_session_required');
      expect((await submit(supplier.session.token)).body.error).toBe('acquirer_device_mismatch');
      const submitted = await submit(acquirer.session.token);
      expect(submitted.status).toBe(201);
      // The supplier derives the same delivery id from its own grant.
      const authorizationHash = await hashDopplerEvidence(transfer.supplierRecord.authorization);
      expect(submitted.body.deliveryId).toBe(await deliveryEvidenceId({ authorizationHash, artifactId: evidence.artifactId }));

      // The contributor claims from its own device-bound session; another account cannot claim its offer.
      const claim = (who, key, body = { deliveryId: submitted.body.deliveryId }) => call('POST', '/v1/offers/offer_delivery/claims', { token: who.session.token, key, body });
      expect((await claim(acquirer, 'claim:acquirer')).body.error).toBe('offer_not_found');
      expect((await claim(supplier, 'claim:both', { ...evidence, deliveryId: submitted.body.deliveryId })).status).toBe(400);
      expect((await claim(supplier, 'claim:missing', { deliveryId: 'dlv_' + '0'.repeat(32) })).body.error).toBe('delivery_not_found');
      // No settled demand yet: the claim validates, and issuance waits for an allowed basis.
      const pending = await claim(supplier, 'claim:1');
      expect(pending.status).toBe(200);
      expect(pending.body.validation).toMatchObject({ outcome: 'accepted', reasons: [], category: 'verified_delivery', reward: { amount: PIECE_BYTES.length } });
      expect(pending.body.validation).not.toHaveProperty('evidence');
      expect(pending.body.issuance).toMatchObject({ status: 'pending', code: 'issuance_not_authorized' });
      // The same transfer earns once.
      expect((await claim(supplier, 'claim:2')).body.validation.reasons.map((reason) => reason.code)).toContain('duplicate_reward');

      // Settled demand admits the reward; the issuance operator resumes it.
      await spend(requester, 'demand');
      expect((await call('POST', '/v1/operator/rewards/issuance/resume', { token: 'operator-funding', body: {} })).body.error).toBe('operator_role_required');
      const resumed = await call('POST', '/v1/operator/rewards/issuance/resume', { token: 'operator-issuance', body: { limit: 10 } });
      expect(resumed.body.results).toEqual([expect.objectContaining({ validationId: pending.body.validation.validationId, status: 'issued', provenance: 'earned' })]);
      expect((await call('GET', '/v1/balances', { token: supplier.session.token })).body).toMatchObject({ available: PIECE_BYTES.length });
      expect((await call('GET', '/v1/journal', { token: supplier.session.token })).body.entries.map((entry) => entry.type)).toEqual(['issue']);
    });
  });

  describe('operator routes', () => {
    it('records funding commitments, reward reservations and Community Access pools behind the funding-authority port', async () => {
      const commitment = {
        commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', externalRef: 'external:commitment_1',
        amount: 100, unit: { kind: 'credits' }, validFrom: clock(), validUntil: at(24 * 60 * MIN)
      };
      const commit = (token) => call('POST', '/v1/operator/funding/commitments', { token, key: 'commit:1', body: commitment });
      const alice = await signIn('alice');
      expect((await commit(alice.session.token)).status).toBe(401);
      expect((await commit('operator-links')).body.error).toBe('operator_role_required');
      expect((await commit('operator-funding')).body).toMatchObject({ commitmentId: 'commitment_1', amount: 100, allocated: 0, status: 'active' });

      // The role admits the request; the funding-authority port decides whether this actor holds that authority.
      const reserve = (token, fundingId, key) => call('POST', '/v1/operator/funding/reward-reservations', {
        token, key, body: { fundingId, commitmentId: 'commitment_1', amount: 30, categories: ['prepared_readiness'], decisionId: `decision:${fundingId}` }
      });
      expect((await reserve('operator-unauthorized-funder', 'funding_x', 'reserve:x')).body.error).toBe('funding_not_authorized');
      const reserved = await reserve('operator-funding', 'funding_1', 'reserve:1');
      expect(reserved.body).toMatchObject({ fundingId: 'funding_1', status: 'active', authority: { actorId: FUNDING_ADMIN, decisionId: 'decision:funding_1' } });
      const pool = await call('POST', '/v1/operator/funding/community-pools', {
        token: 'operator-funding', body: { fundingId: 'pool_funding_1', commitmentId: 'commitment_1', quantity: 20, poolAccountId: 'pool_general', decisionId: 'decision:pool' }
      });
      expect(pool.body).toMatchObject({ status: 'issued', poolAccountId: 'pool_general', authority: { actorId: FUNDING_ADMIN } });
      const read = await call('GET', '/v1/operator/funding/commitments/commitment_1', { token: 'operator-audit' });
      expect(read.body.commitment).toMatchObject({ allocated: 50 });
      expect(read.body.allocations.map((allocation) => [allocation.use, allocation.credits]).sort()).toEqual([['community_access_pool', 20], ['reward_funding', 30]]);

      expect((await call('POST', '/v1/operator/funding/reward-reservations/funding_1/release', {
        token: 'operator-unauthorized-funder', body: { decisionId: 'decision:release' }
      })).body.error).toBe('funding_not_authorized');
      const released = await call('POST', '/v1/operator/funding/reward-reservations/funding_1/release', { token: 'operator-funding', body: { decisionId: 'decision:release' } });
      expect(released.body).toMatchObject({ status: 'released', returned: 30 });
      expect((await call('GET', '/v1/operator/funding/allocations?commitmentId=commitment_1', { token: 'operator-funding' })).body.allocations
        .map((allocation) => [allocation.use, allocation.status]).sort()).toEqual([['community_access_pool', 'consumed'], ['reward_funding', 'released']]);
    });

    it('records operator links and serves link and provenance reads to operators and auditors only', async () => {
      const alice = await browserParticipant('alice');
      const bob = await signIn('bob');
      const link = { kind: 'operator_flagged', accountIds: [alice.account.accountId, bob.account.accountId], evidenceId: 'case_1' };
      expect((await call('POST', '/v1/operator/links', { token: 'operator-audit', key: 'link:1', body: link })).body.error).toBe('operator_role_required');
      expect((await call('POST', '/v1/operator/links', { token: 'operator-links', key: 'link:1', body: { ...link, recordedBy: { authority: 'operator', id: 'x' } } })).status).toBe(400);
      expect((await call('POST', '/v1/operator/links', { token: 'operator-links', key: 'link:1', body: link })).body)
        .toMatchObject({ kind: 'operator_flagged', recordedBy: { authority: 'operator', id: 'links_test' } });
      expect((await call('GET', `/v1/operator/accounts/${alice.account.accountId}/links`, { token: alice.session.token })).status).toBe(401);
      expect((await call('GET', `/v1/operator/accounts/${alice.account.accountId}/links`, { token: 'operator-audit' })).body.links).toHaveLength(1);
      const provenance = await call('GET', `/v1/operator/provenance/participants/${encodeURIComponent(alice.identity.peerId)}?at=${encodeURIComponent(clock())}`, { token: 'operator-links' });
      expect(provenance.body).toMatchObject({ accountId: alice.account.accountId, deviceId: alice.deviceId, status: 'active' });
      expect((await call('GET', `/v1/operator/provenance/participants/${encodeURIComponent(alice.identity.peerId)}?at=${encodeURIComponent(new Date(START - MIN).toISOString())}`, { token: 'operator-links' })).status).toBe(404);
      expect((await call('GET', `/v1/operator/accounts/${alice.account.accountId}/audit`, { token: 'operator-audit' })).body).toMatchObject({ consistent: true });
    });
  });

  describe('idempotency keys', () => {
    it('binds a key to its caller and canonical request: a different request conflicts, another caller gets its own result', async () => {
      const alice = await browserParticipant('alice');
      const bob = await browserParticipant('bob');
      await fund(services.ledger, alice.account.accountId, 100);
      const quote = (who, request) => call('POST', '/v1/quotes', { token: who.session.token, key: 'shared-key', body: { request } });
      const first = await quote(alice, { service: 'chat' });
      expect(first.status).toBe(201);
      // Same caller, same key, different body: refused, with no second quote and no call to the price policy.
      const changed = await quote(alice, { service: 'search' });
      expect([changed.status, changed.body.error]).toEqual([409, 'idempotency_conflict']);
      expect(quoteRequests).toHaveLength(1);
      expect((await quote(alice, { service: 'chat' })).body.quoteId).toBe(first.body.quoteId);
      // Another account using the same key and body gets its own quote, never alice's.
      const theirs = await quote(bob, { service: 'chat' });
      expect(theirs.status).toBe(201);
      expect(theirs.body).toMatchObject({ accountId: bob.account.accountId });
      expect(theirs.body.quoteId).not.toBe(first.body.quoteId);

      // A failed request leaves its key free, as in the ledger; a success binds it.
      const accept = (quoteHash) => call('POST', `/v1/quotes/${first.body.quoteId}/accept`, { token: alice.session.token, key: 'accept-key', body: { quoteHash } });
      expect((await accept('sha256:not-the-terms')).body.error).toBe('quote_terms_mismatch');
      const accepted = await accept(first.body.quoteHash);
      expect(accepted.status).toBe(200);
      expect((await accept('sha256:not-the-terms')).body.error).toBe('idempotency_conflict');
      expect((await accept(first.body.quoteHash)).body).toEqual(accepted.body);

      // Device registration: bob's request under alice's key registers bob's device; alice's key with another proof conflicts.
      const device = async (who, identity) => {
        const challenge = (await call('POST', '/v1/devices/challenges', { token: who.session.token })).body;
        const proof = await createDeviceRegistrationProof({ identity, challenge, host: 'native' });
        return call('POST', '/v1/devices', { token: who.session.token, key: 'device-key', body: { proof } });
      };
      const aliceNative = await device(alice, await newIdentity());
      expect(aliceNative.body).toMatchObject({ accountId: alice.account.accountId });
      const bobNative = await device(bob, await newIdentity());
      expect(bobNative.body).toMatchObject({ accountId: bob.account.accountId });
      expect((await device(alice, await newIdentity())).body.error).toBe('idempotency_conflict');

      // Operators: the same key from another actor reaches the component as its own request, never the first result.
      const commitment = (commitmentId) => ({
        commitmentId, funderKind: 'operator', funderId: 'operator_test', externalRef: `external:${commitmentId}`,
        amount: 100, unit: { kind: 'credits' }, validFrom: clock(), validUntil: at(24 * 60 * MIN)
      });
      const commit = (token, body) => call('POST', '/v1/operator/funding/commitments', { token, key: 'commit-key', body });
      expect((await commit('operator-funding', commitment('commitment_1'))).status).toBe(201);
      expect((await commit('operator-funding', commitment('commitment_2'))).body.error).toBe('idempotency_conflict');
      expect((await commit('operator-funding', commitment('commitment_1'))).status).toBe(201);
      const other = await commit('operator-unauthorized-funder', commitment('commitment_1'));
      expect([other.status, other.body.error]).toEqual([409, 'commitment_exists']);

      // Settlement: a changed metering under the same key conflicts; another settlement actor cannot replay the first result.
      const { reservationId } = accepted.body;
      expect((await call('POST', `/v1/reservations/${reservationId}/attempts`, {
        token: alice.session.token, key: 'bind-key', body: { attemptId: 'att_1', recipients: ['peer_c0'] }
      })).status).toBe(200);
      const settle = (token, output) => call('POST', `/v1/operator/reservations/${reservationId}/settle`, {
        token, key: 'settle-key', body: { billableEventId: 'event_1', outcome: 'full', attemptId: 'att_1', metering: { output }, completedAt: clock() }
      });
      const settled = await settle('operator-settlement', 40);
      expect(settled.body).toMatchObject({ charge: 30 });
      expect((await settle('operator-settlement', 80)).body.error).toBe('idempotency_conflict');
      expect((await settle('operator-settlement', 40)).body).toEqual(settled.body);
      const replay = await settle('operator-settlement-2', 40);
      expect([replay.status, replay.body.error]).toEqual([409, 'reservation_already_settled']);
    });
  });

  describe('retry safety', () => {
    const SETTLE_ROUTE = 'POST /operator/reservations/:reservationId/settle';
    const settlement = (attemptId, output = 40) => ({ billableEventId: `event_${attemptId}`, outcome: 'full', attemptId, metering: { output }, completedAt: clock() });
    const bindings = () => createRouteIdempotency({ backend: idempotencyBackend(), leaseMs: LIMITS.idempotencyLeaseMs, nowMs: () => fx.nowMs });
    const binding = (routeId, caller, key) => bindings().get({ routeId, caller, key });
    const journalCount = async (accountId, type) => (await services.ledger.listJournal(accountId)).filter((entry) => entry.type === type).length;
    /** A funded account with an accepted quote and a bound attempt, ready to settle. */
    const readyToSettle = async (subject) => {
      const who = await browserParticipant(subject);
      await fund(services.ledger, who.account.accountId, 100);
      const quote = (await call('POST', '/v1/quotes', { token: who.session.token, key: `quote:${subject}`, body: { request: {} } })).body;
      const { reservationId } = (await call('POST', `/v1/quotes/${quote.quoteId}/accept`, {
        token: who.session.token, key: `accept:${subject}`, body: { quoteHash: quote.quoteHash }
      })).body;
      await call('POST', `/v1/reservations/${reservationId}/attempts`, { token: who.session.token, key: `bind:${subject}`, body: { attemptId: `att_${subject}`, recipients: ['peer_c0'] } });
      return { who, quote, reservationId, attemptId: `att_${subject}` };
    };
    const settleOn = (on, reservationId, body, key = 'settle-key') => request(on, 'POST', `/v1/operator/reservations/${reservationId}/settle`, { token: 'operator-settlement', key, body });

    it('keeps an outcome ambiguous after the component commits and recovers that one committed result on retry', async () => {
      const alice = await browserParticipant('alice');
      await fund(services.ledger, alice.account.accountId, 100);
      const quote = (await call('POST', '/v1/quotes', { token: alice.session.token, key: 'quote', body: { request: {} } })).body;
      // The process fails after the ledger committed the reservation, before the route stored its response.
      let crash = true;
      const { base: crashing } = await start({ overrides: { faultHooks: { afterComponent: ({ routeId }) => {
        if (routeId === 'POST /quotes/:quoteId/accept' && crash) { crash = false; throw new Error('process failed after commit'); }
      } } } });
      const accept = (quoteHash = quote.quoteHash) => request(crashing, 'POST', `/v1/quotes/${quote.quoteId}/accept`, { token: alice.session.token, key: 'accept-key', body: { quoteHash } });
      expect((await accept()).status).toBe(500);
      const caller = { accountId: alice.account.accountId, deviceId: alice.deviceId };
      expect(await binding('POST /quotes/:quoteId/accept', caller, 'accept-key')).toMatchObject({ status: 'unknown' });
      const reservations = await services.ledger.listAccountReservations(alice.account.accountId);
      expect(reservations).toHaveLength(1);
      // A changed request under the unresolved key is refused; the same request recovers the committed reservation.
      expect((await accept('sha256:other-terms')).body.error).toBe('idempotency_conflict');
      const recovered = await accept();
      expect([recovered.status, recovered.body.reservationId]).toEqual([200, reservations[0].reservationId]);
      const replayed = await accept();
      expect([replayed.body, replayed.headers.get('idempotent-replayed')]).toEqual([recovered.body, 'true']);
      expect(await services.ledger.listAccountReservations(alice.account.accountId)).toHaveLength(1);
      expect(await journalCount(alice.account.accountId, 'reserve')).toBe(1);
      expect((await call('GET', '/v1/balances', { token: alice.session.token })).body).toMatchObject({ available: 40, held: 60 });

      // A component call that commits and then loses its connection is ambiguous too.
      await call('POST', `/v1/reservations/${recovered.body.reservationId}/attempts`, { token: alice.session.token, key: 'bind', body: { attemptId: 'att_1', recipients: ['peer_c0'] } });
      let lose = true;
      const lossy = { ...services.ledger, async settleReservation(input) {
        const result = await services.ledger.settleReservation(input);
        if (lose) { lose = false; throw new Error('connection lost after commit'); }
        return result;
      } };
      const { base: lossyBase } = await start({ overrides: { ledger: lossy } });
      expect((await settleOn(lossyBase, recovered.body.reservationId, settlement('att_1'))).status).toBe(500);
      expect(await binding(SETTLE_ROUTE, { operatorId: 'settlement_test' }, 'settle-key')).toMatchObject({ status: 'unknown' });
      const settled = await settleOn(lossyBase, recovered.body.reservationId, settlement('att_1'));
      expect(settled.body).toMatchObject({ outcome: 'full', charge: 30 });
      expect(settled.body.settlementId).toBe((await services.ledger.getReservation(recovered.body.reservationId)).settlement.settlementId);
      expect(await journalCount(alice.account.accountId, 'charge')).toBe(1);
    });

    it('lets two router processes sharing the stores settle one key once', async () => {
      const { who, reservationId, attemptId } = await readyToSettle('alice');
      let entered;
      let open;
      const reached = new Promise((resolve) => { entered = resolve; });
      const gate = new Promise((resolve) => { open = resolve; });
      const { base: first } = await start({ overrides: { faultHooks: { afterComponent: async ({ routeId }) => {
        if (routeId === SETTLE_ROUTE) { entered(); await gate; }
      } } } });
      const { base: second } = await start();
      const inFlight = settleOn(first, reservationId, settlement(attemptId));
      await reached;
      // The first process committed and still holds the key: the second neither settles again nor uses another key.
      const busy = await settleOn(second, reservationId, settlement(attemptId));
      expect([busy.status, busy.body.error, busy.headers.get('retry-after')]).toEqual([409, 'idempotency_in_progress', String(LIMITS.idempotencyLeaseMs / 1000)]);
      expect((await settleOn(second, reservationId, settlement(attemptId, 80))).body.error).toBe('idempotency_conflict');
      open();
      const done = await inFlight;
      expect(done.body).toMatchObject({ outcome: 'full', charge: 30 });
      const retried = await settleOn(second, reservationId, settlement(attemptId));
      expect([retried.status, retried.body]).toEqual([200, done.body]);
      expect(await journalCount(who.account.accountId, 'charge')).toBe(1);

      // Both processes at once on a fresh key: one reservation, and every retry returns it.
      const quote = (await call('POST', '/v1/quotes', { token: who.session.token, key: 'quote-2', body: { request: {} } })).body;
      const accept = (on) => request(on, 'POST', `/v1/quotes/${quote.quoteId}/accept`, { token: who.session.token, key: 'accept-2', body: { quoteHash: quote.quoteHash } });
      const raced = await Promise.all([accept(first), accept(second)]);
      for (const response of raced) expect([200, 409]).toContain(response.status);
      const settledAccepts = await Promise.all([accept(first), accept(second)]);
      expect(settledAccepts.map((response) => response.status)).toEqual([200, 200]);
      expect(new Set(settledAccepts.map((response) => response.body.reservationId)).size).toBe(1);
      expect(await services.ledger.listAccountReservations(who.account.accountId)).toHaveLength(2);
      expect(await journalCount(who.account.accountId, 'reserve')).toBe(2);
    });

    it('recovers an unfinished request after a restart: one validated, issued reward', async () => {
      const supplier = await browserParticipant('supplier');
      const native = await newIdentity('Ed25519');
      const nativeDevice = (await register(supplier.session, native, { host: 'native' })).body;
      await call('PUT', `/v1/devices/${nativeDevice.deviceId}/owner-authorization`, { token: supplier.session.token, key: 'owner', body: { ownerAuthorization } });
      const acquirer = await browserParticipant('acquirer');
      const { reservationId, attemptId } = await readyToSettle('requester');
      await settleOn(base, reservationId, settlement(attemptId), 'demand');
      const offer = await services.rewards.createOffer({
        offerId: 'offer_delivery', accountId: supplier.account.accountId,
        work: { category: 'verified_delivery', participantId: native.peerId, pieces: [{ hash: await sha256Hex(PIECE_BYTES), sizeBytes: PIECE_BYTES.length }] },
        reward: { basis: { kind: 'test_per_delivered_byte' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'deliveredBytes', numerator: 1, denominator: 1 }] }, maxReward: 50 },
        resourceBounds: { transferBytes: { max: 1024, unit: 'byte' } },
        duration: { startsAt: clock(), endsAt: at(40 * MIN) }, validUntil: at(5 * MIN),
        paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN }, failureCompensation: { kind: 'none' },
        idempotencyKey: 'offer:delivery'
      });
      await call('POST', '/v1/offers/offer_delivery/accept', { token: supplier.session.token, key: 'accept-offer', body: { offerHash: offer.offerHash, ownerAuthorization } });
      advance(MIN);
      const transfer = await transferPiece([acquirer.identity, native]);
      const { deliveryId } = (await call('POST', '/v1/deliveries', { token: acquirer.session.token, body: deliveryEvidenceFromRecord(transfer.record) })).body;

      // The first process validates and issues the reward, then stops before storing its response.
      let stopped;
      const stopping = new Promise((resolve) => { stopped = resolve; });
      const { base: doomed } = await start({ overrides: { faultHooks: { afterComponent: ({ routeId }) => {
        if (routeId === 'POST /offers/:offerId/claims') { stopped(); return new Promise(() => {}); }
      } } } });
      const abandon = new AbortController();
      const lost = fetch(`${doomed}/v1/offers/offer_delivery/claims`, {
        method: 'POST', signal: abandon.signal, body: JSON.stringify({ deliveryId }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${supplier.session.token}`, 'idempotency-key': 'claim-key' }
      }).catch(() => null);
      await stopping;
      abandon.abort();
      await lost;
      expect(await journalCount(supplier.account.accountId, 'issue')).toBe(1);

      // A fresh router over the same stores: the key is held until the stopped holder's lease ends, then reconciles.
      const { base: restarted } = await start();
      const claim = () => request(restarted, 'POST', '/v1/offers/offer_delivery/claims', { token: supplier.session.token, key: 'claim-key', body: { deliveryId } });
      expect((await claim()).body.error).toBe('idempotency_in_progress');
      expect((await request(restarted, 'POST', '/v1/offers/offer_delivery/claims', {
        token: supplier.session.token, key: 'claim-key', body: { deliveryId: 'dlv_' + '0'.repeat(32) }
      })).body.error).toBe('idempotency_conflict');
      advance(LIMITS.idempotencyLeaseMs);
      const recovered = await claim();
      expect(recovered.status).toBe(200);
      expect(recovered.body.validation).toMatchObject({ outcome: 'accepted', issuanceStatus: 'issued' });
      expect(recovered.body.issuance).toMatchObject({ status: 'issued', amount: PIECE_BYTES.length });
      expect((await claim()).body).toEqual(recovered.body);
      expect(await journalCount(supplier.account.accountId, 'issue')).toBe(1);
      expect((await call('GET', '/v1/balances', { token: supplier.session.token })).body).toMatchObject({ available: PIECE_BYTES.length });
    });

    it('replays the stored settlement when the response fails after the settlement committed', async () => {
      const { who, reservationId, attemptId } = await readyToSettle('alice');
      let failResponse = true;
      const { base: failing } = await start({ overrides: { faultHooks: { afterComplete: ({ routeId }) => {
        if (routeId === SETTLE_ROUTE && failResponse) { failResponse = false; throw new Error('response write failed'); }
      } } } });
      expect((await settleOn(failing, reservationId, settlement(attemptId))).status).toBe(500);
      expect(await binding(SETTLE_ROUTE, { operatorId: 'settlement_test' }, 'settle-key')).toMatchObject({ status: 'complete' });
      const retried = await settleOn(failing, reservationId, settlement(attemptId));
      expect([retried.status, retried.headers.get('idempotent-replayed')]).toEqual([200, 'true']);
      expect(retried.body).toMatchObject({ outcome: 'full', charge: 30, settlementId: (await services.ledger.getReservation(reservationId)).settlement.settlementId });
      expect((await settleOn(failing, reservationId, settlement(attemptId, 80))).body.error).toBe('idempotency_conflict');
      expect(await journalCount(who.account.accountId, 'charge')).toBe(1);
    });

    it('frees a key only after a failure that definitely had no effect', async () => {
      const { who } = await readyToSettle('alice');
      await fund(services.ledger, who.account.accountId, 100, 'purchase:alice:second');
      const caller = { accountId: who.account.accountId, deviceId: who.deviceId };
      // A single-transaction component refusal commits nothing.
      const second = (await call('POST', '/v1/quotes', { token: who.session.token, key: 'quote-free', body: { request: {} } })).body;
      const accept = (quoteHash) => call('POST', `/v1/quotes/${second.quoteId}/accept`, { token: who.session.token, key: 'accept-free', body: { quoteHash } });
      expect((await accept('sha256:wrong')).body.error).toBe('quote_terms_mismatch');
      expect(await binding('POST /quotes/:quoteId/accept', caller, 'accept-free')).toMatchObject({ status: 'released' });
      const accepted = await accept(second.quoteHash);
      expect(accepted.status).toBe(200);
      // A route refusal comes before the component acts.
      const attempt = (id, body) => call('POST', `/v1/reservations/${id}/attempts`, { token: who.session.token, key: 'free-key', body });
      expect((await attempt('res_missing', { attemptId: 'att_x', recipients: ['peer_c0'] })).body.error).toBe('reservation_not_found');
      expect(await binding('POST /reservations/:reservationId/attempts', caller, 'free-key')).toMatchObject({ status: 'released' });
      expect((await attempt(accepted.body.reservationId, { attemptId: 'att_2', recipients: ['peer_c1'] })).status).toBe(200);
      expect(await services.ledger.listAccountReservations(who.account.accountId)).toHaveLength(2);

      // A refusal from a multi-transaction operation may follow a commit, so its key stays held.
      const reserve = (fundingId) => call('POST', '/v1/operator/funding/reward-reservations', {
        token: 'operator-funding', key: 'reserve-key',
        body: { fundingId, commitmentId: 'commitment_missing', amount: 5, categories: ['prepared_readiness'], decisionId: `decision:${fundingId}` }
      });
      expect((await reserve('funding_1')).body.error).toBe('commitment_not_found');
      expect(await services.rewards.getFunding('funding_1')).toMatchObject({ status: 'refused' });
      expect(await binding('POST /operator/funding/reward-reservations', { operatorId: FUNDING_ADMIN }, 'reserve-key')).toMatchObject({ status: 'unknown' });
      expect((await reserve('funding_2')).body.error).toBe('idempotency_conflict');
      expect((await reserve('funding_1')).body.error).toBe('commitment_not_found');
      expect(await services.rewards.getFunding('funding_2')).toBeNull();
    });
  });

  describe('ingress, limits and configuration', () => {
    it('bounds bodies per route, accepts only JSON objects and refuses bodies parsed upstream', async () => {
      const alice = await browserParticipant('alice');
      const big = { providerId: provider.providerId, assertion: 'x'.repeat(LIMITS.jsonBytes) };
      expect((await call('POST', '/v1/accounts/sign-in', { body: big })).status).toBe(413);
      expect((await call('POST', '/v1/accounts/sign-in', { body: '{"providerId":' })).body.error).toBe('invalid_json');
      expect((await call('POST', '/v1/accounts/sign-in', { body: '[]' })).body.error).toBe('invalid_body');
      expect((await call('POST', '/v1/accounts/sign-in', { body: 'providerId=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
      // Delivery evidence has its own larger bound, and unauthenticated bodies are never parsed.
      const padded = { artifactId: 'x'.repeat(LIMITS.jsonBytes * 2) };
      expect((await call('POST', '/v1/deliveries', { token: alice.session.token, body: padded })).body.error).toBe('invalid_input');
      expect((await call('POST', '/v1/deliveries', { body: { artifactId: 'x'.repeat(LIMITS.evidenceJsonBytes) } })).status).toBe(401);
      expect((await call('POST', '/v1/deliveries', { token: alice.session.token, body: { artifactId: 'x'.repeat(LIMITS.evidenceJsonBytes) } })).status).toBe(413);
      expect((await call('GET', '/v1/unknown', { token: alice.session.token })).body.error).toBe('route_not_found');

      // Mounted behind a general parser, the routes refuse rather than trust an unbounded body.
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      await mountEarningRoutes(app, { env: ENABLED, composition: composition() });
      const late = await request(await listen(app), 'POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion: 'x' } });
      expect([late.status, late.body.error]).toEqual([500, 'ingress_misconfigured']);
    });

    it('counts requests per client address, account and device', async () => {
      const tight = (limits) => start({ overrides: { limits: { ...LIMITS, ...limits } } });
      const signInBase = (await tight({ signIn: { max: 2, windowMs: MIN } })).base;
      const attempt = () => request(signInBase, 'POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: 'alice' }) } });
      expect((await attempt()).status).toBe(200);
      expect((await attempt()).status).toBe(200);
      const limited = await attempt();
      expect([limited.status, limited.body.error, limited.headers.get('retry-after')]).toEqual([429, 'rate_limited', '60']);
      advance(MIN);
      expect((await attempt()).status).toBe(200);

      const alice = await browserParticipant('alice');
      const accountBase = (await tight({ account: { max: 2, windowMs: MIN } })).base;
      const balances = (token) => request(accountBase, 'GET', '/v1/balances', { token });
      expect((await balances(alice.session.token)).status).toBe(200);
      expect((await balances(alice.session.token)).status).toBe(200);
      expect((await balances(alice.session.token)).status).toBe(429);
      // Another account has its own count.
      expect((await balances((await signIn('bob')).session.token)).status).toBe(200);

      const deviceBase = (await tight({ device: { max: 1, windowMs: MIN } })).base;
      const quote = (token, key) => request(deviceBase, 'POST', '/v1/quotes', { token, key, body: { request: {} } });
      expect((await quote(alice.session.token, 'device:1')).status).toBe(201);
      expect((await quote(alice.session.token, 'device:2')).status).toBe(429);
      // Session-only routes of the same account are not device-counted.
      expect((await request(deviceBase, 'GET', '/v1/devices', { token: alice.session.token })).status).toBe(200);
    });

    it('stays unmounted by default, is never reachable through the Pool local-development bypass, and fails closed without ports', async () => {
      const off = await start({ env: {} });
      expect(off.mounted).toEqual({ mounted: false, production: false });
      const unmounted = await request(off.base, 'POST', '/v1/accounts/sign-in', { body: { providerId: provider.providerId, assertion: provider.issue({ subject: 'alice' }) } });
      expect([unmounted.status, unmounted.text]).toEqual([404, 'File not found']);
      expect((await start({ env: { REPLOID_EARNING_ROUTES: 'disabled' } })).mounted.mounted).toBe(false);

      // Loopback callers get no bypass on /v1, and the Pool router's bypass never reaches these routes.
      expect((await call('GET', '/v1/balances')).status).toBe(401);
      const viaPool = await call('GET', '/pool/v1/balances');
      expect(viaPool.status).toBe(404);
      expect(viaPool.body?.error).not.toBe('session_required');

      // Without the quote-terms or operator-authority ports those routes fail closed.
      const bare = (await start({ overrides: { quoteTerms: null, operatorAuthority: null, communityAccess: null } })).base;
      const alice = await browserParticipant('alice');
      expect((await request(bare, 'POST', '/v1/quotes', { token: alice.session.token, key: 'q', body: { request: {} } })).body.error).toBe('quote_terms_unconfigured');
      expect((await request(bare, 'GET', '/v1/operator/funding/allocations', { token: 'operator-funding' })).body.error).toBe('operator_authority_unconfigured');
    });

    it('refuses invalid switches and, in production, a missing or test-only sign-in provider or memory stores', async () => {
      const mountWith = (env, composed = composition()) => mountEarningRoutes(express(), { env, composition: composed });
      await expect(mountWith({ REPLOID_EARNING_ROUTES: 'true' })).rejects.toMatchObject({ code: 'switch_invalid' });
      await expect(mountEarningRoutes(express(), { env: ENABLED })).rejects.toMatchObject({ code: 'composition_required' });
      // The composition can come from the module the configuration names.
      const loaded = await mountEarningRoutes(express(), {
        env: { ...ENABLED, REPLOID_EARNING_COMPOSITION: './earning-composition.js' },
        importModule: async (specifier) => (specifier === './earning-composition.js' ? { createEarningComposition: () => composition() } : null)
      });
      expect(loaded).toMatchObject({ mounted: true, prefix: '/v1', production: false, signInProviders: [{ providerId: provider.providerId, testOnly: true }] });

      for (const production of [{ NODE_ENV: 'production' }, { K_SERVICE: 'reploid-pool' }]) {
        await expect(mountWith({ ...ENABLED, ...production })).rejects.toMatchObject({ code: 'test_sign_in_provider_in_production' });
      }
      const providerUnderAcceptance = { providerId: 'provider-under-acceptance', verifyAssertion: async () => { throw new Error('not in tests'); } };
      const withProviders = (providers) => composition({ ...harness.open({ providers, fundingAuthority }) });
      await expect(mountWith({ ...ENABLED, NODE_ENV: 'production' }, withProviders([]))).rejects.toMatchObject({ code: 'sign_in_provider_required' });
      await expect(mountWith({ ...ENABLED, NODE_ENV: 'production' }, withProviders([providerUnderAcceptance, provider])))
        .rejects.toMatchObject({ code: 'test_sign_in_provider_in_production' });
      const production = mountWith({ ...ENABLED, NODE_ENV: 'production' }, withProviders([providerUnderAcceptance]));
      if (kind === 'memory') await expect(production).rejects.toMatchObject({ code: 'memory_store_in_production' });
      else expect(await production).toMatchObject({ mounted: true, production: true, signInProviders: [{ providerId: 'provider-under-acceptance', testOnly: false }] });
      // Memory-held Idempotency-Key bindings are refused in production too.
      await expect(mountWith({ ...ENABLED, NODE_ENV: 'production' }, {
        ...withProviders([providerUnderAcceptance]), idempotencyBackend: createMemoryRouteBackend()
      })).rejects.toMatchObject({ code: 'memory_store_in_production' });
    });
  });
}, 30_000);
