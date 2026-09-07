import { test, expect } from '@playwright/test';

test('Zero loads public configuration and retries bootstrap without bypassing credential headers', async ({ page }) => {
  // Browser contract test with explicit SDK fixtures, not a real Firebase token exchange.
  let configured = false;
  let configRequests = 0;
  await page.route('**/config/zero-access.json', (route) => {
    configRequests += 1;
    expect(route.request().headers()['x-reploid-vfs-bypass']).toBe('1');
    return route.fulfill({ json: {
      schema: 'reploid.zero-access/v1', projectId: 'test-project', appId: 'test-app',
      appCheck: { provider: 'recaptcha-v3', siteKey: configured ? 'public-test-key' : null }
    } });
  });
  const modules = {
    app: `export const getApps = () => [{ options: { projectId: 'unrelated', appId: 'other' } }];
      export const initializeApp = (options, name) => {
        window.zeroFixtureApp = { options, name }; return window.zeroFixtureApp;
      };`,
    auth: `export const getAuth = (app) => {
      if (app.options.projectId !== 'test-project') throw new Error('Wrong app');
      return { currentUser: { getIdToken: async () => 'fixture-auth-token' } };
    };`,
    check: `export class ReCaptchaV3Provider { constructor(key) { this.key = key; } }
      export const initializeAppCheck = (app, options) => {
        window.zeroFixtureCheck = { app, options }; return {};
      };
      export const getToken = async () => ({ token: 'fixture-check-token' });`
  };
  for (const [name, body] of Object.entries(modules)) {
    await page.route(`**/__zero-sdk-${name}.js`, (route) => route.fulfill({ contentType: 'text/javascript', body }));
  }
  await page.route('**/__zero-access-test', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Zero access contract</title>' }));
  await page.goto('/__zero-access-test');
  await page.evaluate(() => {
    window.REPLOID_ZERO_FIREBASE_CONFIG = { projectId: 'test-project', appId: 'test-app' };
    window.REPLOID_FIREBASE_APP_MODULE_URL = '/__zero-sdk-app.js';
    window.REPLOID_FIREBASE_AUTH_MODULE_URL = '/__zero-sdk-auth.js';
    window.REPLOID_FIREBASE_APP_CHECK_MODULE_URL = '/__zero-sdk-check.js';
  });
  const first = await page.evaluate(async () => {
    const { getZeroAccessHeaders } = await import('/config/zero-inference.js');
    return getZeroAccessHeaders().catch((error) => error.message);
  });
  expect(first).toContain('not configured');
  expect(await page.evaluate(() => window.zeroFixtureApp)).toBeUndefined();
  configured = true;
  const headers = await page.evaluate(async () => {
    const { getZeroAccessHeaders } = await import('/config/zero-inference.js');
    return Promise.all([getZeroAccessHeaders(), getZeroAccessHeaders()]);
  });
  expect(headers).toEqual(Array(2).fill({
    Authorization: 'Bearer fixture-auth-token', 'X-Firebase-AppCheck': 'fixture-check-token'
  }));
  expect(configRequests).toBe(2);
  expect(await page.evaluate(() => window.zeroFixtureCheck.options.provider.key)).toBe('public-test-key');
  expect(await page.evaluate(() => window.zeroFixtureApp.name)).toBe('reploid-zero');
});
