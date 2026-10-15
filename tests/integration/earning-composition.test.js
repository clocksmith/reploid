// @vitest-environment node
// The in-repository earning composition over real in-process HTTP: stores and providers built from the
// environment and an operator policy file outside the repository; the local test sign-in flow; a top-up
// checkout through the session route, completed on the test processor's checkout page and credited;
// quotes and contribution offers from the policy's templates; and the production refusals. Memory and
// fake-Firestore stores. Every policy value is test-only.
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDeviceRegistrationProof, createSessionBinding } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createEarningComposition, OPERATORS_SCHEMA } from '../../server/earning-composition/index.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { newIdentity } from '../helpers/account-fixture.js';
import { earningPolicy, OFFER_MODEL, QUOTE_REQUEST, writeOutsideRepository } from '../helpers/earning-policy-fixture.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { MIN, START, clock, fx } from '../helpers/reward-fixture.js';
import { createHash } from 'node:crypto';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

const listen = async (app) => {
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const call = async (base, method, path, { token, key, body, form = false } = {}) => {
  const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: {
    ...(body === undefined ? {} : { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
  body: body === undefined ? undefined : (form ? body : JSON.stringify(body)) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, body: json, text };
};

describe.each(['memory', 'firestore'])('earning composition (%s store)', (kind) => {
  let env;
  let firestore;
  let base;
  let composition;

  const compose = (overrides = {}, { production = false } = {}) => createEarningComposition({
    env: { ...env, ...overrides }, production, ports: { clock, ...(firestore ? { firestore } : {}) }
  });

  beforeEach(async () => {
    fx.nowMs = START;
    firestore = kind === 'firestore' ? createFakeFirestore() : null;
    env = {
      REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', earningPolicy()),
      REPLOID_EARNING_STORE: kind,
      ...(kind === 'firestore' ? { REPLOID_EARNING_FIRESTORE_PREFIX: 'test' } : {}),
      REPLOID_EARNING_TEST_SIGN_IN: 'enabled',
      REPLOID_EARNING_TEST_PROCESSOR: 'enabled',
      REPLOID_EARNING_OPERATORS_FILE: await writeOutsideRepository('operators.json', {
        schema: OPERATORS_SCHEMA, operators: [{ actorId: 'funding_admin_test', roles: ['funding'], tokenSha256: createHash('sha256').update('operator-token').digest('hex') }]
      })
    };
    composition = await compose();
    const app = express();
    const mounted = await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition, log: { error() {} } });
    expect(mounted).toMatchObject({ mounted: true, signInFlows: ['local-test'], payments: { id: 'test-processor', testOnly: true }, offers: true });
    installJsonBodyMiddleware(app, {});
    base = await listen(app);
  });

  /** The local flow: an assertion for a typed subject, a session, and this host's device registered and bound. */
  const device = async (subject, host) => {
    const issued = await call(base, 'POST', '/v1/sign-in/local-test/assertions', { body: { subject } });
    expect(issued.status).toBe(201);
    const signed = await call(base, 'POST', '/v1/accounts/sign-in', { body: { providerId: 'local-test', assertion: issued.body.assertion } });
    const { token } = signed.body.session;
    const identity = await newIdentity('Ed25519');
    const challenge = (await call(base, 'POST', '/v1/devices/challenges', { token })).body;
    const registered = await call(base, 'POST', '/v1/devices', { token, key: `register:${subject}:${host}`, body: {
      proof: await createDeviceRegistrationProof({ identity, challenge, host }), bindSession: true, sessionBinding: await createSessionBinding({ identity, challenge }) } });
    expect(registered.status).toBe(201);
    return { token, identity, accountId: signed.body.account.accountId, deviceId: registered.body.deviceId };
  };

  it('publishes its settings, signs in through the local flow and refuses malformed subjects', async () => {
    const settings = await call(base, 'GET', '/v1/client');
    expect(settings.body).toEqual({ schema: 'reploid.earning-service/v1', signIn: [{ providerId: 'local-test', flow: 'local_test_subject', testOnly: true }],
      topUps: [{ topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } }] });
    expect((await call(base, 'POST', '/v1/sign-in/local-test/assertions', { body: { subject: 'Not Valid' } })).body.error).toBe('invalid_body');
    expect((await call(base, 'POST', '/v1/sign-in/local-test/assertions', { body: { subject: 'alice', extra: 1 } })).body.error).toBe('invalid_body');
    // The local flow issues no states; real providers' state route does not exist for it.
    expect((await call(base, 'POST', '/v1/sign-in/local-test/states')).body.error).toBe('route_not_found');
    const alice = await device('alice', 'browser');
    const again = await device('alice', 'native');
    expect(again.accountId).toBe(alice.accountId);
    expect((await call(base, 'GET', '/v1/accounts/me', { token: alice.token })).body.account.providerId).toBe('local-test');
  });

  it('starts a top-up checkout once per key, completes it on the test checkout page and credits it once', async () => {
    const alice = await device('alice', 'browser');
    const started = await call(base, 'POST', '/v1/payments/checkouts', { token: alice.token, key: 'top-up:1', body: { topUpId: 'test-topup' } });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ phase: 'open', credits: 1000, topUp: { topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } },
      checkout: { kind: 'test_checkout', url: `/v1/payments/test-checkouts/${started.body.checkoutId}` }, issued: false });
    const replay = await call(base, 'POST', '/v1/payments/checkouts', { token: alice.token, key: 'top-up:1', body: { topUpId: 'test-topup' } });
    expect(replay.body.checkoutId).toBe(started.body.checkoutId);
    expect((await call(base, 'POST', '/v1/payments/checkouts', { token: alice.token, key: 'top-up:1', body: { topUpId: 'other' } })).body.error).toBe('idempotency_conflict');
    expect((await call(base, 'POST', '/v1/payments/checkouts', { token: alice.token, key: 'top-up:2', body: { topUpId: 'other' } })).body.error).toBe('unknown_top_up');
    expect((await call(base, 'POST', '/v1/payments/checkouts', { key: 'top-up:3', body: { topUpId: 'test-topup' } })).body.error).toBe('session_required');

    const page = await call(base, 'GET', started.body.checkout.url);
    expect(page.status).toBe(200);
    expect(page.text).toContain('10.00 USD for 1000 credits');
    expect(page.text).toContain('Complete test payment');
    const completed = await call(base, 'POST', `${started.body.checkout.url}/complete`);
    expect(completed.text).toContain('Payment recorded.');
    // Completing again changes nothing.
    expect((await call(base, 'POST', `${started.body.checkout.url}/complete`)).text).toContain('Payment recorded.');
    expect((await call(base, 'GET', `/v1/payments/checkouts/${started.body.checkoutId}`, { token: alice.token })).body).toMatchObject({ phase: 'issued', issued: true });
    expect((await call(base, 'GET', '/v1/balances', { token: alice.token })).body).toMatchObject({ available: 1000, byProvenance: { purchased: { available: 1000 } } });
    expect((await call(base, 'GET', '/v1/journal', { token: alice.token })).body.entries.map((entry) => [entry.type, entry.amount])).toEqual([['issue', 1000]]);
    // Another account cannot read it.
    const bob = await device('bob', 'browser');
    expect((await call(base, 'GET', `/v1/payments/checkouts/${started.body.checkoutId}`, { token: bob.token })).body.error).toBe('checkout_not_found');
  });

  it('quotes from the policy template with its deadline and offers contribution only to the hosts and models it names', async () => {
    const alice = await device('alice', 'browser');
    const quote = await call(base, 'POST', '/v1/quotes', { token: alice.token, key: 'quote:1', body: { request: { ...QUOTE_REQUEST } } });
    expect(quote.status).toBe(201);
    expect(quote.body).toMatchObject({ pricing: { maxCharge: 60 },
      service: { deadline: new Date(START + 3 * MIN).toISOString(), firstOutputDeadline: new Date(START + 30_000).toISOString() },
      terms: { validUntil: new Date(START + MIN).toISOString() } });
    expect((await call(base, 'POST', '/v1/quotes', { token: alice.token, key: 'quote:2', body: { request: { ...QUOTE_REQUEST, modelId: 'other' } } })).body.error)
      .toBe('quote_not_offered');

    const native = await device('carol', 'native');
    const offered = await call(base, 'POST', '/v1/offers', { token: native.token, key: 'offer:1', body: { category: 'demanded_inference', model: { ...OFFER_MODEL } } });
    expect(offered.status).toBe(201);
    expect(offered.body).toMatchObject({ accountId: native.accountId, status: 'offered', work: { participantId: native.identity.peerId, model: { ...OFFER_MODEL } },
      duration: { startsAt: new Date(START).toISOString(), endsAt: new Date(START + 60 * MIN).toISOString() } });
    fx.nowMs += 1000;
    expect((await call(base, 'POST', '/v1/offers', { token: native.token, key: 'offer:1', body: { category: 'demanded_inference', model: { ...OFFER_MODEL } } })).body.offerId)
      .toBe(offered.body.offerId);
    // A browser device, another model or an unknown category gets no offer from this template.
    expect((await call(base, 'POST', '/v1/offers', { token: alice.token, key: 'offer:2', body: { category: 'demanded_inference', model: { ...OFFER_MODEL } } })).body.error)
      .toBe('offer_not_available');
    expect((await call(base, 'POST', '/v1/offers', { token: native.token, key: 'offer:3', body: { category: 'demanded_inference', model: { ...OFFER_MODEL, planId: 'sha256:other' } } })).body.error)
      .toBe('offer_not_available');
    // The offer is the account's own; the earning router serves it.
    expect((await call(base, 'GET', `/v1/offers/${offered.body.offerId}`, { token: native.token })).body.offerId).toBe(offered.body.offerId);
    expect((await call(base, 'GET', `/v1/offers/${offered.body.offerId}`, { token: alice.token })).body.error).toBe('offer_not_found');
  });

  it('authenticates operators by token digest and publishes conversions once', async () => {
    const commitment = await call(base, 'POST', '/v1/operator/funding/commitments', { token: 'operator-token', key: 'commit:1', body: {
      commitmentId: 'commitment_1', funderKind: 'operator', funderId: 'operator_test', externalRef: 'external:commitment_1', amount: 100,
      unit: { kind: 'credits' }, validFrom: clock(), validUntil: new Date(START + 7 * 24 * 60 * MIN).toISOString() } });
    expect(commitment.status).toBe(201);
    expect((await call(base, 'POST', '/v1/operator/funding/commitments', { token: 'wrong', key: 'commit:2', body: {} })).body.error).toBe('operator_credential_invalid');
    // A restarted process over the same stores converges on the published record.
    fx.nowMs += MIN;
    await expect(compose()).resolves.toBeTruthy();
  });

  it('refuses unsafe or incomplete configuration', async () => {
    await expect(compose({ REPLOID_EARNING_STORE: 'memory' }, { production: true })).rejects.toMatchObject({ code: 'memory_store_in_production' });
    await expect(compose({ REPLOID_EARNING_STORE: 'firestore', REPLOID_EARNING_FIRESTORE_PREFIX: 'test' }, { production: true }))
      .rejects.toMatchObject({ code: 'test_provider_in_production' });
    await expect(compose({ REPLOID_EARNING_POLICY_FILE: new URL('../../package.json', import.meta.url).pathname }))
      .rejects.toMatchObject({ code: 'file_inside_repository' });
    await expect(compose({ REPLOID_EARNING_TEST_SIGN_IN: 'disabled' })).rejects.toMatchObject({ code: 'sign_in_provider_required' });
    await expect(compose({ REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', earningPolicy({ services: [] })) }))
      .rejects.toMatchObject({ code: 'policy_invalid' });
    const late = earningPolicy();
    late.services[0].deadlines.firstOutputMs = late.services[0].deadlines.completeMs;
    await expect(compose({ REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', late) })).rejects.toThrow('firstOutputMs must be');
    const unpaid = earningPolicy();
    delete unpaid.payments;
    await expect(compose({ REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', unpaid) })).rejects.toMatchObject({ code: 'payment_policy_required' });
    // Over a durable store, a conversion already published under the same id with other terms refuses to start.
    if (kind === 'firestore') {
      const changed = earningPolicy();
      changed.conversions.records[0].rate = { credits: 2, perMinorUnits: 1 };
      await expect(compose({ REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', changed) })).rejects.toMatchObject({ code: 'conversion_conflict' });
    }
    // The production guard in mount.js also refuses the test flow and checkout.
    await expect(mountEarningRoutes(express(), { env: { REPLOID_EARNING_ROUTES: 'enabled', NODE_ENV: 'production' }, composition }))
      .rejects.toMatchObject({ code: 'test_sign_in_provider_in_production' });
  });
}, 60_000);
