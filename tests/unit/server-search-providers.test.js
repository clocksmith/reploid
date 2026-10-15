// @vitest-environment node
// Brave and SearXNG search adapters (server/search) against fixtures shaped from each provider's documented
// format. Injected fetch only: no network, no key. Live behavior is the separate, opt-in live smoke test.
import { describe, expect, it, vi } from 'vitest';
import { createBraveSearch, parseRateLimitHeaders } from '../../server/search/brave.js';
import { createSearxngSearch } from '../../server/search/searxng.js';
import braveFixture from '../fixtures/search/brave-web-search.json';
import brave422 from '../fixtures/search/brave-error-422.json';
import brave429 from '../fixtures/search/brave-error-429.json';
import searxngFixture from '../fixtures/search/searxng-search.json';

const KEY = 'test-brave-key-0123456789';
const json = (body, { status = 200, headers = {} } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } });
const RATE = { 'x-ratelimit-limit': '1, 15000', 'x-ratelimit-policy': '1;w=1, 15000;w=2592000',
  'x-ratelimit-remaining': '0, 14790', 'x-ratelimit-reset': '1, 1419704' };
/** A clock the injected sleep advances, so spacing is observable without real waiting. */
function clock() {
  let time = 1760500000000;
  return { now: () => time, sleep: vi.fn(async ms => { time += ms; }), advance: ms => { time += ms; } };
}
function brave(responses, options = {}) {
  const calls = [], queue = [...responses], time = clock();
  const fetch = vi.fn(async (url, init) => { calls.push({ url: new URL(url), init }); return queue.shift()(); });
  return { calls, fetch, time, search: createBraveSearch({ apiKey: KEY, fetch, now: time.now, sleep: time.sleep, ...options }) };
}

describe('Brave Search adapter', () => {
  it('sends the documented request with the key only in its header and returns cleaned results', async () => {
    const { search, calls } = brave([() => json(braveFixture, { headers: RATE })], { costMicroUsdPerQuery: 5000 });
    const found = await search.search({ query: '  when was the eiffel tower completed ', count: 5 });
    const [{ url, init }] = calls;
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'when was the eiffel tower completed', count: '5' });
    expect(url.href).not.toContain(KEY);
    expect(init.headers).toEqual({ Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': KEY });
    expect(found.results).toEqual([
      { url: 'https://www.example.org/eiffel-tower', title: 'Eiffel Tower - History & Facts',
        excerpt: 'The Eiffel Tower was completed on March 31, 1889, for the Exposition Universelle — Paris\'s world fair.' },
      // An empty description falls back to the first extra snippet; results without text or a web URL are dropped.
      { url: 'https://encyclopedia.example.net/wiki/Eiffel_Tower', title: 'Tour Eiffel',
        excerpt: 'Construction began in January 1887 and finished in 1889.' }]);
    expect(found.moreResultsAvailable).toBe(true);
    expect(found.usage).toEqual({ provider: 'brave', requests: 1, billable: true, costMicroUsd: 5000,
      rateLimit: { windows: [{ limit: 1, remaining: 0, resetSeconds: 1, windowSeconds: 1 },
        { limit: 15000, remaining: 14790, resetSeconds: 1419704, windowSeconds: 2592000 }] } });
    expect(JSON.stringify(found)).not.toContain(KEY);
  });

  it('records an unpriced query as null cost and treats a response without web results as empty', async () => {
    const { search } = brave([() => json({ type: 'search', query: { original: 'x' } })]);
    expect(await search.search({ query: 'x', count: 3 })).toMatchObject({ results: [], usage: { billable: true, costMicroUsd: null, rateLimit: null } });
  });

  it('maps errors: credentials, validation detail, rate limit, monthly quota, outages and malformed bodies', async () => {
    const cases = [
      [() => json({ type: 'ErrorResponse', error: { status: 401, detail: 'Invalid token' } }, { status: 401 }), { code: 'unauthorized', status: 401 }],
      [() => json(brave422, { status: 422 }), { code: 'invalid-request', status: 422, detail: brave422.error.detail }],
      [() => json(brave429, { status: 429, headers: { ...RATE, 'x-ratelimit-reset': '1, 1419704' } }), { code: 'rate-limited', retryAfterSeconds: 1 }],
      [() => json(brave429, { status: 429, headers: { ...RATE, 'x-ratelimit-remaining': '1, 0', 'x-ratelimit-reset': '1, 86400' } }),
        { code: 'quota-exhausted', retryAfterSeconds: 86400 }],
      [() => json({}, { status: 402 }), { code: 'quota-exhausted' }],
      [() => json('upstream', { status: 503 }), { code: 'provider-unavailable', status: 503 }],
      [() => json('<html>not json</html>'), { code: 'invalid-response' }],
      [() => json({ type: 'search', web: { results: 'nope' } }), { code: 'invalid-response' }],
      [() => { throw new TypeError('fetch failed'); }, { code: 'provider-unavailable' }]
    ];
    for (const [response, expected] of cases) {
      const { search } = brave([response]);
      const error = await search.search({ query: 'eiffel', count: 3 }).catch(failure => failure);
      expect(error, expected.code).toMatchObject(expected);
      expect(String(error.message) + JSON.stringify(error)).not.toContain(KEY);
    }
    // Non-2xx responses are not billable; a 2xx with a malformed body is.
    const failed = await brave([() => json({}, { status: 503 })]).search.search({ query: 'a', count: 1 }).catch(error => error);
    expect(failed.usage).toMatchObject({ billable: false, costMicroUsd: null });
    const malformed = await brave([() => json('nope')], { costMicroUsdPerQuery: 5000 }).search.search({ query: 'a', count: 1 }).catch(error => error);
    expect(malformed.usage).toMatchObject({ billable: true, costMicroUsd: 5000 });
  });

  it('rejects invalid input locally and distinguishes timeout from cancellation', async () => {
    const { search, fetch } = brave([]);
    await expect(search.search({ query: ' ', count: 3 })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(search.search({ query: 'a', count: 21 })).rejects.toMatchObject({ code: 'invalid-request' });
    expect(fetch).not.toHaveBeenCalled();
    const hanging = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const timed = createBraveSearch({ apiKey: KEY, fetch: hanging });
    await expect(timed.search({ query: 'a', count: 1, signal: AbortSignal.timeout(5) })).rejects.toMatchObject({ code: 'timeout' });
    const stopped = new AbortController(), pending = timed.search({ query: 'b', count: 1, signal: stopped.signal });
    stopped.abort(new Error('Stopped'));
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('spaces requests to the plan rate and refuses locally, without calling Brave, when the wait is too long', async () => {
    const ok = () => json(braveFixture, { headers: { ...RATE, 'x-ratelimit-remaining': '1, 14790' } });
    const { search, fetch, time } = brave([ok, ok, ok], { qps: 1, maxWaitMs: 2000 });
    await search.search({ query: 'a', count: 1 });
    await search.search({ query: 'b', count: 1 }); // within maxWaitMs: waits one interval
    expect(time.sleep).toHaveBeenCalledWith(1000, null);
    expect(fetch).toHaveBeenCalledTimes(2);

    const strict = brave([ok, ok], { qps: 0.25, maxWaitMs: 2000 });
    await strict.search.search({ query: 'a', count: 1 });
    await expect(strict.search.search({ query: 'b', count: 1 })).rejects.toMatchObject({ code: 'rate-limited', retryAfterSeconds: 4 });
    expect(strict.fetch).toHaveBeenCalledTimes(1);
    strict.time.advance(4000);
    await strict.search.search({ query: 'c', count: 1 });
    expect(strict.fetch).toHaveBeenCalledTimes(2);
  });

  it('holds back while Brave reports an exhausted window, as quota when the window is monthly', async () => {
    const exhausted = () => json(braveFixture, { headers: { ...RATE, 'x-ratelimit-remaining': '0, 0', 'x-ratelimit-reset': '1, 3600' } });
    const { search, fetch, time } = brave([exhausted, exhausted]);
    await search.search({ query: 'a', count: 1 });
    await expect(search.search({ query: 'b', count: 1 })).rejects.toMatchObject({ code: 'quota-exhausted', retryAfterSeconds: 3600 });
    expect(fetch).toHaveBeenCalledTimes(1);
    time.advance(3600 * 1000);
    await search.search({ query: 'c', count: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('parses comma-separated rate-limit headers and ignores their absence', () => {
    expect(parseRateLimitHeaders(new Headers(RATE)).windows.map(window => window.windowSeconds)).toEqual([1, 2592000]);
    expect(parseRateLimitHeaders(new Headers())).toBeNull();
  });
});

describe('SearXNG adapter', () => {
  const searxng = responses => {
    const calls = [], queue = [...responses];
    const fetch = vi.fn(async (url, init) => { calls.push({ url: new URL(url), init }); return queue.shift()(); });
    return { calls, search: createSearxngSearch({ baseUrl: 'https://searx.example.org/base/', fetch, now: () => 1 }) };
  };
  it('queries the JSON API under the configured base URL and returns deduplicated results without a price', async () => {
    const { search, calls } = searxng([() => json(searxngFixture)]);
    const found = await search.search({ query: 'when was the eiffel tower completed', count: 10 });
    expect(calls[0].url.origin + calls[0].url.pathname).toBe('https://searx.example.org/base/search');
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ q: 'when was the eiffel tower completed', format: 'json', pageno: '1' });
    expect(found.results.map(result => [result.url, result.title])).toEqual([
      ['https://www.example.org/eiffel-tower', 'Eiffel Tower - History & Facts'],
      ['https://encyclopedia.example.net/wiki/Eiffel_Tower', 'Eiffel Tower']]);
    expect(found.usage).toEqual({ provider: 'searxng', requests: 1, billable: false, costMicroUsd: null, rateLimit: null });
    expect((await searxng([() => json(searxngFixture)]).search.search({ query: 'x', count: 1 })).results).toHaveLength(1);
  });
  it('reports a JSON-disabled instance, rate limiting, outages and HTML in place of JSON', async () => {
    const cases = [
      [() => json('<html>Forbidden</html>', { status: 403 }), { code: 'json-disabled', status: 403 }],
      [() => json('Too Many Requests', { status: 429, headers: { 'retry-after': '30' } }), { code: 'rate-limited', retryAfterSeconds: 30 }],
      [() => json('bad gateway', { status: 502 }), { code: 'provider-unavailable' }],
      [() => json('<!doctype html><html></html>'), { code: 'invalid-response' }],
      [() => json({ results: {} }), { code: 'invalid-response' }]
    ];
    for (const [response, expected] of cases) {
      await expect(searxng([response]).search.search({ query: 'x', count: 3 })).rejects.toMatchObject(expected);
    }
    expect((await searxng([cases[0][0]]).search.search({ query: 'x', count: 3 }).catch(error => error)).detail)
      .toContain('enable json under search.formats');
    expect(() => createSearxngSearch({ baseUrl: 'file:///etc', fetch })).toThrow('http(s) base URL');
  });
});
