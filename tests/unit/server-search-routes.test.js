// @vitest-environment node
// /api/retrieval routes and their configuration (server/search). Providers and page fetches are injected;
// the Brave adapter is exercised through mount.js with an injected fetch serving the documented fixture.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchRouter, signFetchToken, verifyFetchToken } from '../../server/search/router.js';
import { createSearchUsage } from '../../server/search/usage.js';
import { readSearchConfig } from '../../server/search/config.js';
import { mountSearchRoutes } from '../../server/search/mount.js';
import { SearchProviderError, PageFetchError } from '../../server/search/errors.js';
import braveFixture from '../fixtures/search/brave-web-search.json';

const SECRET = 'route-test-secret-0123456789abcdef', KEY = 'brave-route-key-0123456789';
const HTML = '<html><head><title>T</title></head><body><main><p>Paris museums.</p><p>The Eiffel Tower was completed in 1889.</p></main></body></html>';
const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });

async function serve(app) {
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/retrieval`;
  return async (route, body) => {
    const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
}
function fixture({ search = null, fetcher = null, maxQueriesPerDay = 10, time = 1760500000000 } = {}) {
  const provider = search || { kind: 'brave', search: vi.fn(async ({ count }) => ({ results: [
    { url: 'https://www.example.org/eiffel-tower', title: 'Eiffel Tower', excerpt: 'Completed in 1889.' },
    { url: 'https://www.example.org/eiffel-tower', title: 'Duplicate', excerpt: 'Same URL.' },
    { url: 'https://encyclopedia.example.net/wiki/Eiffel_Tower', title: 'Encyclopedia', excerpt: 'Construction 1887 to 1889.' }].slice(0, count),
  usage: { provider: 'brave', requests: 1, billable: true, costMicroUsd: 5000, rateLimit: null } })) };
  const pages = fetcher || { timeoutMs: 1000, fetchPage: vi.fn(async url => ({ url, status: 200, contentType: 'text/html; charset=utf-8', charset: 'utf-8',
    bytes: HTML.length, byteSha256: 'sha256:' + 'b'.repeat(64), body: Buffer.from(HTML) })) };
  const clock = { time };
  const usage = createSearchUsage({ now: () => clock.time, maxQueriesPerDay });
  const app = express();
  app.use('/api/retrieval', createSearchRouter({ search: provider, fetcher: pages, usage, fetchSecret: SECRET, now: () => clock.time }));
  return { app, provider, pages, usage, clock };
}

describe('search route', () => {
  it('reports its provider and returns results with stable ids, content hashes and fetch tokens', async () => {
    const { app, provider, usage, clock } = fixture(), call = await serve(app);
    expect((await call('/status')).body).toEqual({ schema: 'reploid.server-search-status/v1', enabled: true, provider: 'brave',
      providerId: 'reploid.server-search/brave', unsupportedContentTypes: ['application/pdf'] });
    const { status, body } = await call('/search', { query: '  eiffel tower completed ', count: 3, expectProvider: 'brave' });
    expect(status).toBe(200);
    expect(provider.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'eiffel tower completed', count: 3 }));
    expect(body).toMatchObject({ schema: 'reploid.server-search-results/v1', provider: { kind: 'brave', id: 'reploid.server-search/brave', version: '1' },
      usage: { provider: 'brave', requests: 1, billable: true, costMicroUsd: 5000, budget: { queries: 1, maxQueriesPerDay: 10 } } });
    // Duplicate URLs collapse to one source id.
    expect(body.results.map(result => result.url)).toEqual(['https://www.example.org/eiffel-tower', 'https://encyclopedia.example.net/wiki/Eiffel_Tower']);
    for (const result of body.results) {
      expect(result.sourceId).toMatch(/^web-[a-f0-9]{16}$/);
      expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.retrievedAt).toBe(clock.time);
      expect(verifyFetchToken(SECRET, result.url, result.fetchToken, clock.time)).toBe(true);
    }
    expect(usage.snapshot()).toMatchObject({ queries: 1, billableQueries: 1, costMicroUsd: 5000, unpricedQueries: 0 });
    expect((await call('/usage')).body).toMatchObject({ schema: 'reploid.server-search-usage/v1', queries: 1 });
  });

  it('sends nothing upstream for invalid bodies or a different expected provider, and stops at the daily budget', async () => {
    const { app, provider, clock } = fixture({ maxQueriesPerDay: 2 }), call = await serve(app);
    for (const body of [{}, { query: '' }, { query: 'x'.repeat(513) }, { query: 'a', count: 21 }, { query: 'a', count: 1.5 }, { query: 'a', expectProvider: 3 }]) {
      expect((await call('/search', body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(await call('/search', { query: 'a', expectProvider: 'searxng' })).toMatchObject({ status: 409, body: { error: { code: 'provider-mismatch' } } });
    expect(provider.search).not.toHaveBeenCalled();
    await call('/search', { query: 'a' }); await call('/search', { query: 'b' });
    const refused = await call('/search', { query: 'c' });
    expect(refused).toMatchObject({ status: 429, body: { error: { code: 'budget-exhausted' } } });
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(provider.search).toHaveBeenCalledTimes(2);
    clock.time += 86400000; // the next UTC day
    expect((await call('/search', { query: 'd' })).status).toBe(200);
  });

  it('maps provider failures to statuses without echoing credentials or upstream detail', async () => {
    const cases = [
      [new SearchProviderError('unauthorized', { status: 401, detail: `token ${KEY} rejected` }), 502, 'provider-unauthorized'],
      [new SearchProviderError('invalid-request', { status: 422, detail: 'count must be at most 20' }), 400, 'invalid-request'],
      [new SearchProviderError('rate-limited', { status: 429, retryAfterSeconds: 2 }), 429, 'rate-limited'],
      [new SearchProviderError('quota-exhausted', { status: 429, retryAfterSeconds: 3600 }), 429, 'quota-exhausted'],
      [new SearchProviderError('json-disabled', { status: 403 }), 502, 'json-disabled'],
      [new SearchProviderError('provider-unavailable', { status: 503, detail: 'internal host db-7' }), 502, 'provider-unavailable'],
      [new SearchProviderError('invalid-response'), 502, 'invalid-response'],
      [new SearchProviderError('timeout'), 504, 'timeout'],
      [new Error('unexpected'), 502, 'provider-unavailable']
    ];
    for (const [error, status, code] of cases) {
      const search = { kind: 'brave', search: async () => { throw error; } };
      const { app, usage } = fixture({ search }), call = await serve(app), response = await call('/search', { query: 'q' });
      expect(response, code).toMatchObject({ status, body: { error: { code } } });
      expect(JSON.stringify(response.body)).not.toContain(KEY);
      expect(JSON.stringify(response.body)).not.toContain('db-7');
      if (code === 'rate-limited') expect(response.headers.get('retry-after')).toBe('2');
      expect(usage.snapshot()).toMatchObject({ queries: 1, billableQueries: 0 });
    }
    expect((await (await serve(fixture({ search: { kind: 'brave', search: async () => { throw new SearchProviderError('invalid-request', { detail: 'count must be at most 20' }); } } }).app))('/search', { query: 'q' })).body.error.message)
      .toBe('count must be at most 20');
  });
});

describe('extract route', () => {
  it('fetches only token-bound URLs and returns an exact passage with document offsets and hashes', async () => {
    const { app, pages, usage, clock } = fixture(), call = await serve(app);
    const url = 'https://www.example.org/eiffel-tower', token = signFetchToken(SECRET, url, clock.time + 60000);
    const { status, body } = await call('/extract', { url, fetchToken: token, query: 'When was the Eiffel Tower completed?', maxCharacters: 200 });
    expect(status).toBe(200);
    const documentText = 'Paris museums.\n\nThe Eiffel Tower was completed in 1889.';
    expect(body).toMatchObject({ schema: 'reploid.server-passage/v1', url, text: 'The Eiffel Tower was completed in 1889.', retrievedAt: clock.time,
      document: { url, status: 200, contentType: 'text/html; charset=utf-8', bytes: HTML.length, characters: documentText.length,
        start: 16, end: documentText.length } });
    expect(documentText.slice(body.document.start, body.document.end)).toBe(body.text);
    const hash = 'sha256:' + (await import('node:crypto')).createHash('sha256').update(documentText).digest('hex');
    expect(body.contentHash).toBe(hash); expect(body.document.sha256).toBe(hash);
    expect(usage.snapshot()).toMatchObject({ fetches: 1, fetchedBytes: HTML.length });

    const refused = [
      { url: 'https://evil.example/internal', fetchToken: token },
      { url, fetchToken: token.replace(/^./, character => character === 'A' ? 'B' : 'A') },
      { url, fetchToken: signFetchToken('another-secret-0123456789abcdef', url, clock.time + 60000) },
      { url, fetchToken: signFetchToken(SECRET, url, clock.time - 1) },
      { url, fetchToken: 'garbage' }];
    for (const attempt of refused) {
      expect(await call('/extract', { ...attempt, query: 'q', maxCharacters: 100 })).toMatchObject({ status: 403, body: { error: { code: 'invalid-fetch-token' } } });
    }
    expect(pages.fetchPage).toHaveBeenCalledTimes(1);
    expect((await call('/extract', { url, fetchToken: token, query: 'q', maxCharacters: 12001 })).status).toBe(400);
  });

  it('maps fetch failures and empty documents', async () => {
    const url = 'https://www.example.org/a';
    for (const [error, status, code] of [[new PageFetchError('unsupported-content-type', { detail: 'PDF text extraction is not supported' }), 415, 'unsupported-content-type'],
      [new PageFetchError('too-large'), 413, 'too-large'], [new PageFetchError('blocked-address'), 403, 'blocked-address'],
      [new PageFetchError('timeout'), 504, 'timeout'], [new PageFetchError('http-error', { status: 404 }), 502, 'http-error']]) {
      const { app, clock, usage } = fixture({ fetcher: { timeoutMs: 1000, fetchPage: async () => { throw error; } } }), call = await serve(app);
      const response = await call('/extract', { url, fetchToken: signFetchToken(SECRET, url, clock.time + 1000), query: 'q', maxCharacters: 100 });
      expect(response, code).toMatchObject({ status, body: { error: { code } } });
      expect(usage.snapshot()).toMatchObject({ fetches: 1, failedFetches: 1 });
    }
    const blank = { timeoutMs: 1000, fetchPage: async () => ({ url, status: 200, contentType: 'text/html', bytes: 30, byteSha256: 'sha256:' + 'c'.repeat(64),
      body: Buffer.from('<html><body><script>x</script></body></html>') }) };
    const { app, clock } = fixture({ fetcher: blank }), call = await serve(app);
    expect(await call('/extract', { url, fetchToken: signFetchToken(SECRET, url, clock.time + 1000), query: 'q', maxCharacters: 100 }))
      .toMatchObject({ status: 422, body: { error: { code: 'no-text' } } });
  });
});

describe('search configuration and mount', () => {
  const outside = () => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-search-')), 'brave.key'); fs.writeFileSync(file, `  ${KEY}\n`); return file; };
  it('needs a provider, its credential and an explicit daily budget; key files must be outside the repository', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    expect(readSearchConfig({}, { repoRoot })).toMatchObject({ enabled: false, reason: 'No search provider is configured' });
    expect(readSearchConfig({ REPLOID_BRAVE_SEARCH_API_KEY: KEY }, { repoRoot })).toMatchObject({ enabled: false, provider: 'brave',
      reason: 'Search needs an explicit REPLOID_SEARCH_MAX_QUERIES_PER_DAY budget' });
    expect(readSearchConfig({ REPLOID_BRAVE_SEARCH_API_KEY_FILE: path.join(repoRoot, 'brave.key'), REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '5' }, { repoRoot }))
      .toMatchObject({ enabled: false, reason: 'REPLOID_BRAVE_SEARCH_API_KEY_FILE must be outside the repository' });
    const fromFile = readSearchConfig({ REPLOID_BRAVE_SEARCH_API_KEY_FILE: outside(), REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '500',
      REPLOID_BRAVE_SEARCH_USD_PER_1000: '5', REPLOID_SEARCH_FETCH_SECRET: SECRET }, { repoRoot });
    expect(fromFile).toMatchObject({ enabled: true, provider: 'brave', maxQueriesPerDay: 500, fetchSecret: SECRET, sharedFetchSecret: true,
      brave: { apiKey: KEY, qps: 1, costMicroUsdPerQuery: 5000 } });
    expect(readSearchConfig({ REPLOID_SEARXNG_BASE_URL: 'https://searx.example.org/', REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '5' }))
      .toMatchObject({ enabled: true, provider: 'searxng', searxng: { baseUrl: 'https://searx.example.org' }, brave: null, sharedFetchSecret: false });
    expect(readSearchConfig({ REPLOID_SEARCH_PROVIDER: 'google', REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '5' })).toMatchObject({ enabled: false });
    expect(readSearchConfig({ REPLOID_SEARCH_PROVIDER: 'searxng', REPLOID_BRAVE_SEARCH_API_KEY: KEY, REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '5' }))
      .toMatchObject({ enabled: false, reason: 'SearXNG search needs REPLOID_SEARXNG_BASE_URL' });
    expect(readSearchConfig({ REPLOID_BRAVE_SEARCH_API_KEY: KEY, REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '0' })).toMatchObject({ enabled: false });
    expect(readSearchConfig({ REPLOID_BRAVE_SEARCH_API_KEY: KEY, REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '5', REPLOID_BRAVE_SEARCH_USD_PER_1000: 'five' })).toMatchObject({ enabled: false });
  });

  it('mounts behind the authorization middleware and never exposes the key in responses or logs', async () => {
    const logs = [], log = { log: line => logs.push(line), warn: line => logs.push(line) };
    const upstream = vi.fn(async () => new Response(JSON.stringify(braveFixture), { status: 200, headers: { 'content-type': 'application/json',
      'x-ratelimit-limit': '1, 15000', 'x-ratelimit-policy': '1;w=1, 15000;w=2592000', 'x-ratelimit-remaining': '1, 14000', 'x-ratelimit-reset': '1, 100' } }));
    const authorize = vi.fn((req, res, next) => req.headers.authorization === 'Bearer ok' ? (req.reploidAccessSubject = 'test', next()) : res.status(401).json({ error: 'no' }));
    const app = express(), env = { REPLOID_BRAVE_SEARCH_API_KEY: KEY, REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '3', REPLOID_SEARCH_FETCH_SECRET: SECRET };
    expect(mountSearchRoutes(express(), { env: {}, authorize, log })).toEqual({ mounted: false, reason: 'No search provider is configured', provider: null });
    const mounted = mountSearchRoutes(app, { env, authorize, log, fetch: upstream });
    expect(mounted).toMatchObject({ mounted: true, provider: 'brave', prefix: '/api/retrieval' });
    const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/retrieval/search`, init = { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'eiffel', count: 2, expectProvider: 'brave' }) };
    expect((await fetch(url, init)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: 'Bearer ok' } }), text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text).results).toHaveLength(2);
    expect(upstream.mock.calls[0][1].headers['X-Subscription-Token']).toBe(KEY);
    expect(text).not.toContain(KEY);
    expect(logs.join('\n')).toContain('[Search] brave mounted at /api/retrieval; budget 3 queries per UTC day; unpriced');
    expect(logs.join('\n')).not.toContain(KEY);
  });
});
