// @vitest-environment node
// The browser composition of the earning loop against the in-repository composition over real HTTP: the
// published settings choose the sign-in flow, the local test flow signs a device in, the account model
// reads balance and journal, a top-up hands off to the test checkout page and is credited, and the
// standing spending limit decides quotes. Test-only policy values.
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEarningComposition } from '../../server/earning-composition/index.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import { chooseSignInFlow, deferredEarning, loadEarningService, openBrowserEarning } from '../../self/host/credits/browser.js';
import { QUOTE_REQUEST, earningPolicy, writeOutsideRepository } from '../helpers/earning-policy-fixture.js';
import { START, clock, fx } from '../helpers/reward-fixture.js';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

const webStorage = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
};

const serve = async (env) => {
  const composition = await createEarningComposition({ env, ports: { clock } });
  const app = express();
  await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition, log: { error() {} } });
  installJsonBodyMiddleware(app, {});
  app.use((req, res) => res.status(404).send('File not found'));
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};

const until = async (predicate, label) => {
  for (let i = 0; i < 200; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('browser earning composition', () => {
  let base;
  beforeEach(async () => {
    fx.nowMs = START;
    base = await serve({
      REPLOID_EARNING_POLICY_FILE: await writeOutsideRepository('policy.json', earningPolicy()),
      REPLOID_EARNING_STORE: 'memory', REPLOID_EARNING_TEST_SIGN_IN: 'enabled', REPLOID_EARNING_TEST_PROCESSOR: 'enabled'
    });
  });

  it('stays off without a published service and offers the local flow only to a loopback page', async () => {
    expect(await loadEarningService({ origin: 'http://127.0.0.1:9', fetch: async () => { throw new Error('offline'); } })).toBeNull();
    expect(await loadEarningService({ origin: base, fetch: async () => new Response('<!doctype html>', { status: 200 }) })).toBeNull();
    const service = await loadEarningService({ origin: base });
    expect(service.signIn).toEqual([{ providerId: 'local-test', flow: 'local_test_subject', testOnly: true }]);
    expect(chooseSignInFlow(service, { hostname: '127.0.0.1' })).toMatchObject({ providerId: 'local-test' });
    expect(chooseSignInFlow(service, { hostname: 'replo.id' })).toBeNull();
    expect(chooseSignInFlow({ signIn: [service.signIn[0], { providerId: 'supabase', flow: 'supabase_magic_link', testOnly: false }] }, { hostname: '127.0.0.1' }))
      .toMatchObject({ providerId: 'supabase' });
    expect(await openBrowserEarning({ location: new URL('https://replo.id/'), storage: webStorage(), fetch: async () => new Response('', { status: 404 }) })).toBeNull();
    // Without a service the deferred port runs the attempt exactly as before.
    const ran = [];
    await deferredEarning(Promise.resolve(null)).run({ id: 'request' }, { id: 'controls' }, async (request, controls) => { ran.push([request.id, controls.id]); });
    expect(ran).toEqual([['request', 'controls']]);
  });

  it('signs in, tops up through the checkout page, reads balance and journal, and decides quotes by the standing limit', async () => {
    const storage = webStorage();
    const navigated = [];
    const earning = await openBrowserEarning({ location: new URL(`${base}/`), storage, navigate: (url) => navigated.push(url) });
    expect(earning.config).toEqual({ schema: 'reploid.earning-client/v1', enabled: true, baseUrl: `${base}/v1`, providerId: 'local-test' });
    await until(() => earning.account.state().phase === 'signed_out', 'signed out');
    await expect(earning.signIn.useSubject('Not Valid')).rejects.toThrow('short name');
    await earning.signIn.useSubject('alice');
    await until(() => earning.account.state().phase === 'ready', 'ready');
    expect(earning.account.state()).toMatchObject({ balance: { available: 0 }, journal: [], spendingLimit: null,
      topUps: [{ topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } }] });
    // The device registered is this profile's persistent earning identity.
    const session = await earning.client.ensureSession();
    expect(session.participantId).toBe(earning.identity.peerId);

    const started = await earning.account.topUp('test-topup');
    expect(navigated).toEqual([`${base}${started.checkout.url}`]);
    const page = await fetch(`${navigated[0]}/complete`, { method: 'POST' });
    expect(await page.text()).toContain('Payment recorded.');
    await earning.account.refresh();
    expect(earning.account.state()).toMatchObject({ balance: { available: 1000 }, checkout: { phase: 'issued', credits: 1000 } });
    expect(earning.account.state().journal.map((entry) => [entry.type, entry.amount])).toEqual([['issue', 1000]]);

    // No limit: the quote is declined and recorded; a limit at the maximum accepts it.
    const quote = await earning.client.send({ opId: 'quote:test', path: '/quotes', body: { request: { ...QUOTE_REQUEST } }, durable: false });
    expect(await earning.account.authorizeSpending({ quote })).toBe(false);
    expect(earning.account.state().lastQuote).toMatchObject({ maxCharge: 60, accepted: false });
    expect(earning.account.setSpendingLimit('abc')).toBeNull();
    expect(earning.account.setSpendingLimit('60')).toBe(60);
    expect(await earning.account.authorizeSpending({ quote })).toBe(true);
    expect(earning.account.setSpendingLimit('59')).toBe(59);
    expect(await earning.account.authorizeSpending({ quote })).toBe(false);

    // A page reload keeps the device's session and last checkout while the provider loads.
    const reloaded = await openBrowserEarning({ location: new URL(`${base}/`), storage, navigate: () => {} });
    await until(() => reloaded.account.state().phase === 'ready', 'reloaded ready');
    expect((await reloaded.client.ensureSession()).sessionId).toBe(session.sessionId);
    expect(reloaded.account.state().checkout).toMatchObject({ phase: 'issued' });

    // Signing out ends the device's service session.
    const { token } = session;
    await earning.account.signOut();
    expect(earning.account.state().phase).toBe('signed_out');
    expect((await fetch(`${base}/v1/balances`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});
