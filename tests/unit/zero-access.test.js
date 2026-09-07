import { afterEach, describe, expect, it, vi } from 'vitest';
import { getZeroAccessHeaders, getZeroAppCheckSiteKey } from '../../self/config/zero-inference.js';

const firebase = { projectId: 'test-project', appId: 'test-app' };
const configured = {
  schema: 'reploid.zero-access/v1',
  ...firebase,
  appCheck: { provider: 'recaptcha-v3', siteKey: 'public-test-site-key' }
};

afterEach(() => vi.unstubAllGlobals());

describe('Zero public App Check configuration', () => {
  it('loads the same-origin configuration with explicit Firebase identity binding', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => configured });
    vi.stubGlobal('fetch', fetch);
    expect(await getZeroAppCheckSiteKey(firebase)).toBe('public-test-site-key');
    expect(fetch).toHaveBeenCalledWith('/config/zero-access.json', expect.objectContaining({
      cache: 'no-store', headers: { 'x-reploid-vfs-bypass': '1' }, signal: expect.any(AbortSignal)
    }));
  });

  it('preserves the explicit operator site-key override', async () => {
    vi.stubGlobal('REPLOID_ZERO_APP_CHECK_SITE_KEY', ' override-key ');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await getZeroAppCheckSiteKey(firebase)).toBe('override-key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['schema', { ...configured, schema: 'unknown' }, /does not match/],
    ['project', { ...configured, projectId: 'other' }, /does not match/],
    ['app', { ...configured, appId: 'other' }, /does not match/],
    ['missing identity', { ...configured, appId: '' }, /does not match/],
    ['provider', { ...configured, appCheck: { provider: 'debug', siteKey: 'test' } }, /recaptcha-v3/],
    ['missing key', { ...configured, appCheck: { provider: 'recaptcha-v3', siteKey: null } }, /not configured/],
    ['non-string key', { ...configured, appCheck: { provider: 'recaptcha-v3', siteKey: {} } }, /not configured/]
  ])('rejects invalid %s before initializing Firebase', async (_name, config, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => config }));
    await expect(getZeroAppCheckSiteKey(firebase)).rejects.toThrow(message);
  });

  it('fails closed on HTTP and malformed JSON responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('not JSON'); } });
    vi.stubGlobal('fetch', fetch);
    await expect(getZeroAppCheckSiteKey(firebase)).rejects.toThrow('(503)');
    await expect(getZeroAppCheckSiteKey(firebase)).rejects.toThrow('not JSON');
  });

  it('shares initialization but retries a rejected configuration on the next request', async () => {
    vi.stubGlobal('REPLOID_ZERO_FIREBASE_CONFIG', firebase);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    const attempts = await Promise.allSettled([getZeroAccessHeaders(), getZeroAccessHeaders()]);
    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(getZeroAccessHeaders()).rejects.toThrow('(503)');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
