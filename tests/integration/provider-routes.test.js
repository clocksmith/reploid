// @vitest-environment node
// The adopted providers over real in-process HTTP: the Supabase browser flow's state route and a
// state-bound sign-in, a Stripe webhook verified over its raw body ahead of the general JSON parser
// and credited through reconciliation, the production guard with these providers configured, and
// their environment configuration. Supabase and Stripe are local fakes; every key, secret, price
// and rate is test-only.
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDeviceRegistrationProof, createSessionBinding } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createFirestoreRouteBackend, createMemoryRouteBackend } from '../../server/earning-routes/idempotency.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { createPaymentStore, createPurchaseIssuanceAuthority } from '../../server/payments/engine.js';
import { createFirestorePaymentBackend, createMemoryPaymentBackend } from '../../server/payments/stores.js';
import { createTestPaymentProcessor } from '../../server/payments/test-processor.js';
import {
  createStripeProcessorFromEnv, createSupabaseSignInFromEnv, readStripeConfig, readSupabaseSignInConfig
} from '../../server/providers/env.js';
import { ACCOUNT_POLICY, newIdentity, openAccountFixture } from '../helpers/account-fixture.js';
import { publishConversion } from '../helpers/conversion-fixture.js';
import { MIN, clock, fundingAuthority, fx } from '../helpers/reward-fixture.js';
import { LIVE_SECRET_KEY, TEST_SECRET_KEY, WEBHOOK_SECRET, createStripeFake } from '../helpers/stripe-fake.js';
import { PROJECT_URL, PUBLISHABLE_KEY, STATE_SECRET, accessToken, createJwksEndpoint, signingKey } from '../helpers/supabase-fake.js';

// Test-only limits and purchase terms; none is a product decision.
const LIMITS = Object.freeze({
  jsonBytes: 16 * 1024, evidenceJsonBytes: 256 * 1024, idempotencyLeaseMs: 30_000,
  address: { max: 10_000, windowMs: MIN }, signIn: { max: 100, windowMs: MIN }, account: { max: 1000, windowMs: MIN },
  device: { max: 1000, windowMs: MIN }, operator: { max: 1000, windowMs: MIN }
});
const PAYMENT_POLICY = Object.freeze({
  policyVersion: 'test-payments/stripe-routes-1', processorId: 'stripe-test',
  topUps: [{ topUpId: 'test-topup-a', price: { amountMinor: 1000, currency: 'USD' } }],
  polling: { minAgeMs: MIN, reversalWatchMs: 30 * 24 * 60 * MIN }
});
const ENABLED = Object.freeze({ REPLOID_EARNING_ROUTES: 'enabled' });
const SUPABASE_ENV = Object.freeze({
  REPLOID_SUPABASE_URL: PROJECT_URL, REPLOID_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY, REPLOID_SUPABASE_SIGN_IN_STATE_SECRET: STATE_SECRET
});
const STRIPE_ENV = Object.freeze({
  REPLOID_STRIPE_SECRET_KEY: TEST_SECRET_KEY, REPLOID_STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  REPLOID_STRIPE_SUCCESS_URL: 'https://reploid.test/top-up/done', REPLOID_STRIPE_CANCEL_URL: 'https://reploid.test/top-up'
});

const servers = [];
afterEach(async () => {
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
  return { status: response.status, body: json, text };
};

describe.each(['memory', 'firestore'])('adopted providers over HTTP (%s store)', (kind) => {
  let harness;
  let key;
  let jwks;
  let stripe;
  let supabase;
  let processor;
  let services;
  let payments;
  let base;

  const paymentBackend = () => (kind === 'memory'
    ? createMemoryPaymentBackend({ state: harness.states.identity })
    : createFirestorePaymentBackend({ firestore: harness.dbs.identity, collectionPrefix: 'test' }));
  const idempotencyBackend = () => (kind === 'memory'
    ? createMemoryRouteBackend({ state: harness.states.identity })
    : createFirestoreRouteBackend({ firestore: harness.dbs.identity, collectionPrefix: 'test' }));
  const composition = (overrides = {}) => ({
    ...services, signInFlows: [supabase], payments, idempotencyBackend: idempotencyBackend(),
    limits: LIMITS, nowMs: () => fx.nowMs, log: { error() {} }, ...overrides
  });
  /** An app shaped like server/proxy.js: earning and provider routes, then the general parser. */
  const start = async ({ env = ENABLED, overrides = {}, parseFirst = false } = {}) => {
    const app = express();
    if (parseFirst) app.use(express.json());
    const mounted = await mountEarningRoutes(app, { env, composition: composition(overrides) });
    installJsonBodyMiddleware(app, {});
    app.use((req, res) => res.status(404).send('File not found'));
    return { mounted, base: await listen(app) };
  };
  const call = (method, path, options) => request(base, method, path, options);

  beforeEach(async () => {
    ({ harness } = openAccountFixture(kind));
    key = await signingKey('key-a');
    jwks = createJwksEndpoint([key]);
    stripe = createStripeFake({ nowMs: () => fx.nowMs });
    supabase = createSupabaseSignInFromEnv(SUPABASE_ENV, { accountPolicy: ACCOUNT_POLICY, fetch: jwks.fetch, clock });
    processor = createStripeProcessorFromEnv(STRIPE_ENV, { fetch: stripe.fetch, clock });
    const backend = paymentBackend();
    const purchases = createPurchaseIssuanceAuthority({ backend });
    services = harness.open({
      providers: [supabase], fundingAuthority,
      otherProvenance: async (decision) => (decision.provenance === 'purchased' ? purchases(decision) : { allowed: true, decisionId: `test-funding:${decision.provenance}` })
    });
    payments = createPaymentStore({
      backend, ledger: services.ledger, processor, accounts: { participantAccount: services.identity.participantAccount }, policy: PAYMENT_POLICY, clock
    });
    await publishConversion(services.ledger, { conversionId: 'conv_test_usd_unit', clock });
    ({ base } = await start());
  });

  /** The browser flow: a state from the route, written into metadata, carried by a refreshed token. */
  const signIn = async (sub = '7f6d1c2e-0000-4000-8000-0000000000aa') => {
    const issued = await call('POST', '/v1/sign-in/supabase/states');
    expect(issued.status).toBe(201);
    const assertion = { accessToken: await accessToken(key, { sub, state: issued.body.state, nowMs: fx.nowMs }), state: issued.body.state };
    const signed = await call('POST', '/v1/accounts/sign-in', { body: { providerId: 'supabase', assertion } });
    return { ...signed, assertion };
  };

  it('serves the Supabase browser flow and signs in once with a state-bound token', async () => {
    const settings = await call('GET', '/v1/sign-in/supabase');
    expect(settings).toMatchObject({ status: 200, body: { providerId: 'supabase', url: PROJECT_URL, publishableKey: PUBLISHABLE_KEY, metadataKey: 'reploid_sign_in_state' } });
    expect(settings.text).not.toContain(STATE_SECRET);
    const first = await signIn();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true, account: { providerId: 'supabase' }, session: { token: expect.any(String) } });
    const replay = await call('POST', '/v1/accounts/sign-in', { body: { providerId: 'supabase', assertion: first.assertion } });
    expect([replay.status, replay.body.error]).toEqual([401, 'assertion_replayed']);
    // A token without a state from this service is refused.
    const bare = await call('POST', '/v1/accounts/sign-in', { body: { providerId: 'supabase', assertion: { accessToken: await accessToken(key, { nowMs: fx.nowMs }), state: 'rss1.x.y' } } });
    expect([bare.status, bare.body.error]).toEqual([401, 'assertion_invalid']);
    // Unknown providers fall through to the earning router's 404.
    expect((await call('GET', '/v1/sign-in/other')).body.error).toBe('route_not_found');
    expect((await call('POST', '/v1/sign-in/other/states')).body.error).toBe('route_not_found');
  });

  it('credits a Stripe top-up from a webhook verified over its raw body, ahead of the general JSON parser', async () => {
    const { body: alice } = await signIn();
    const identity = await newIdentity('ECDSA');
    const challenge = await call('POST', '/v1/devices/challenges', { token: alice.session.token });
    const registered = await call('POST', '/v1/devices', {
      token: alice.session.token, key: 'register:alice',
      body: { proof: await createDeviceRegistrationProof({ identity, challenge: challenge.body, host: 'browser' }), bindSession: true,
        sessionBinding: await createSessionBinding({ identity, challenge: challenge.body }) }
    });
    expect(registered.status).toBe(201);
    const started = await payments.startCheckout({ participantId: identity.peerId, topUpId: 'test-topup-a', idempotencyKey: 'top-up:1' });
    expect(started).toMatchObject({ accountId: alice.account.accountId, phase: 'open', processor: 'stripe-test' });

    const { session } = stripe.complete(started.purchaseId);
    const delivery = stripe.event('checkout.session.completed', session);
    const deliver = (target = base, { rawBody = delivery.rawBody, headers = delivery.headers, path = '/v1/payments/notifications/stripe-test' } = {}) => request(target, 'POST', path, { body: rawBody, headers });
    expect(await deliver()).toMatchObject({ status: 200, body: { received: true, eventId: delivery.eventId, duplicate: false, matched: true } });
    expect((await deliver()).body).toMatchObject({ duplicate: true, matched: true });
    const balance = await call('GET', '/v1/balances', { token: alice.session.token });
    expect(balance.body.byProvenance.purchased).toMatchObject({ issued: 1000, available: 1000 });

    // The signature covers the exact bytes: re-serialized or altered bodies are refused.
    const reserialized = JSON.stringify(JSON.parse(delivery.rawBody), null, 2);
    expect((await deliver(base, { rawBody: reserialized })).body.error).toBe('notification_not_authentic');
    expect((await deliver(base, { rawBody: delivery.rawBody.replace('"paid"', '"unpaid"') })).status).toBe(400);
    expect((await deliver(base, { headers: { 'content-type': 'application/json' } })).status).toBe(400);
    // Only this processor's path exists; a parser installed ahead of these routes is refused.
    expect((await deliver(base, { path: '/v1/payments/notifications/stripe-live' })).body.error).toBe('route_not_found');
    const misordered = (await start({ parseFirst: true })).base;
    expect((await deliver(misordered)).body).toMatchObject({ error: 'ingress_misconfigured' });
    // A Stripe outage during reconciliation is retryable, and the redelivery completes it.
    const second = await payments.startCheckout({ participantId: identity.peerId, topUpId: 'test-topup-a', idempotencyKey: 'top-up:2' });
    const later = stripe.event('checkout.session.completed', stripe.complete(second.purchaseId).session);
    stripe.failNext(1, 503);
    expect((await deliver(base, { rawBody: later.rawBody, headers: later.headers })).status).toBe(503);
    expect((await deliver(base, { rawBody: later.rawBody, headers: later.headers })).body).toMatchObject({ duplicate: true, matched: true });
    expect((await call('GET', '/v1/balances', { token: alice.session.token })).body.byProvenance.purchased).toMatchObject({ issued: 2000 });
  });

  it('starts in production with Supabase and Stripe test mode configured, and still refuses test providers', async () => {
    const production = { ...ENABLED, NODE_ENV: 'production' };
    const mountWith = (overrides) => mountEarningRoutes(express(), { env: production, composition: composition(overrides) });
    if (kind === 'memory') {
      await expect(mountWith()).rejects.toMatchObject({ code: 'memory_store_in_production' });
    } else {
      expect(await mountWith()).toMatchObject({
        mounted: true, production: true, signInProviders: [{ providerId: 'supabase', testOnly: false }], signInFlows: ['supabase'],
        payments: { id: 'stripe-test', testOnly: false, mode: 'test' }
      });
    }
    // The test-only processor and sign-in provider are refused even beside the real ones.
    const testProcessor = createTestPaymentProcessor({ id: 'test-processor', clock, signatureToleranceMs: 5 * MIN, checkoutTtlMs: 30 * MIN });
    const testPayments = createPaymentStore({
      backend: paymentBackend(), ledger: services.ledger, processor: testProcessor,
      accounts: { participantAccount: services.identity.participantAccount }, policy: { ...PAYMENT_POLICY, processorId: 'test-processor' }, clock
    });
    await expect(mountWith({ payments: testPayments })).rejects.toMatchObject({ code: 'test_payment_processor_in_production' });
    const { provider: testProvider } = openAccountFixture(kind);
    await expect(mountWith({ ...harness.open({ providers: [supabase, testProvider], fundingAuthority }) }))
      .rejects.toMatchObject({ code: 'test_sign_in_provider_in_production' });
    // A browser flow must belong to a configured sign-in provider.
    await expect(mountEarningRoutes(express(), { env: ENABLED, composition: composition({ ...harness.open({ providers: [testProvider], fundingAuthority }) }) }))
      .rejects.toThrow(/not a configured sign-in provider/);
  });
});

describe('provider configuration from the environment', () => {
  const stripe = (env) => readStripeConfig({ ...STRIPE_ENV, ...env });

  it('keeps Stripe test mode the default and live mode explicit, each with its own keys', () => {
    expect(readStripeConfig({})).toBeNull();
    expect(stripe({})).toMatchObject({ mode: 'test', secretKey: TEST_SECRET_KEY, webhookSecrets: [WEBHOOK_SECRET], toleranceMs: 300_000 });
    expect(stripe({ REPLOID_STRIPE_WEBHOOK_SECRET: `${WEBHOOK_SECRET}, whsec_previous_secret_test` }).webhookSecrets).toHaveLength(2);
    expect(() => stripe({ REPLOID_STRIPE_SECRET_KEY: LIVE_SECRET_KEY })).toThrow(expect.objectContaining({ code: 'stripe_mode_mismatch' }));
    expect(() => stripe({ REPLOID_STRIPE_LIVE_SECRET_KEY: LIVE_SECRET_KEY })).toThrow(expect.objectContaining({ code: 'stripe_mode_mismatch' }));
    expect(() => stripe({ REPLOID_STRIPE_MODE: 'live' })).toThrow(expect.objectContaining({ code: 'setting_required' }));
    expect(() => stripe({ REPLOID_STRIPE_MODE: 'production' })).toThrow(expect.objectContaining({ code: 'invalid_setting' }));
    expect(() => stripe({ REPLOID_STRIPE_MODE: 'live', REPLOID_STRIPE_LIVE_SECRET_KEY: TEST_SECRET_KEY })).toThrow(expect.objectContaining({ code: 'stripe_mode_mismatch' }));
    const live = { REPLOID_STRIPE_MODE: 'live', REPLOID_STRIPE_LIVE_SECRET_KEY: LIVE_SECRET_KEY, REPLOID_STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_endpoint_test' };
    expect(stripe(live)).toMatchObject({ mode: 'live', secretKey: LIVE_SECRET_KEY });
    expect(createStripeProcessorFromEnv({ ...STRIPE_ENV, ...live })).toMatchObject({ id: 'stripe-live', mode: 'live', testOnly: false });
    expect(createStripeProcessorFromEnv(STRIPE_ENV)).toMatchObject({ id: 'stripe-test', mode: 'test' });
    expect(() => stripe({ REPLOID_STRIPE_SUCCESS_URL: '' })).toThrow(expect.objectContaining({ code: 'setting_required' }));
    expect(() => createStripeProcessorFromEnv({ ...STRIPE_ENV, REPLOID_STRIPE_SUCCESS_URL: 'http://reploid.test/done' })).toThrow(expect.objectContaining({ code: 'invalid_setting' }));
    expect(() => stripe({ REPLOID_STRIPE_WEBHOOK_TOLERANCE_SECONDS: '0' })).toThrow(expect.objectContaining({ code: 'invalid_setting' }));
  });

  it('reads Supabase settings with an algorithm allowlist and no default secret', () => {
    expect(readSupabaseSignInConfig({})).toBeNull();
    expect(readSupabaseSignInConfig(SUPABASE_ENV)).toMatchObject({ projectUrl: PROJECT_URL, stateTtlMs: 300_000, algorithms: ['ES256', 'RS256'] });
    expect(() => readSupabaseSignInConfig({ ...SUPABASE_ENV, REPLOID_SUPABASE_SIGN_IN_STATE_SECRET: '' })).toThrow(expect.objectContaining({ code: 'setting_required' }));
    expect(() => readSupabaseSignInConfig({ ...SUPABASE_ENV, REPLOID_SUPABASE_PUBLISHABLE_KEY: '' })).toThrow(expect.objectContaining({ code: 'setting_required' }));
    expect(() => readSupabaseSignInConfig({ ...SUPABASE_ENV, REPLOID_SUPABASE_SIGN_IN_STATE_SECRET: 'too-short' })).toThrow(expect.objectContaining({ code: 'invalid_setting' }));
    expect(() => readSupabaseSignInConfig({ ...SUPABASE_ENV, REPLOID_SUPABASE_JWT_ALGORITHMS: 'ES256,HS256' })).toThrow(expect.objectContaining({ code: 'invalid_setting' }));
    expect(readSupabaseSignInConfig({ ...SUPABASE_ENV, REPLOID_SUPABASE_JWT_ALGORITHMS: 'ES256' }).algorithms).toEqual(['ES256']);
    expect(() => createSupabaseSignInFromEnv({ ...SUPABASE_ENV, REPLOID_SUPABASE_URL: 'http://projectreftest.supabase.co' }, { accountPolicy: ACCOUNT_POLICY }))
      .toThrow(expect.objectContaining({ code: 'invalid_setting' }));
    expect(() => createSupabaseSignInFromEnv(SUPABASE_ENV, {})).toThrow(/account policy/);
  });
});
