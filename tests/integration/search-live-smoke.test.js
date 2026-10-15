// @vitest-environment node
// Live provider smoke checks, skipped unless credentials or a base URL are present. One query each.
// REPLOID_SEARCH_RECORD_DIR, when set, receives the raw response bodies (never the key) for new fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBraveSearch } from '../../server/search/brave.js';
import { createSearxngSearch } from '../../server/search/searxng.js';

const KEY = process.env.REPLOID_BRAVE_SEARCH_API_KEY, SEARXNG = process.env.REPLOID_SEARXNG_BASE_URL, RECORD = process.env.REPLOID_SEARCH_RECORD_DIR;
const QUERY = 'when was the eiffel tower completed';

/** fetch that keeps a copy of each response body for recording. */
function recording(name) {
  return async (url, init) => {
    const response = await fetch(url, init), text = await response.clone().text();
    if (RECORD) {
      fs.mkdirSync(RECORD, { recursive: true });
      const headers = Object.fromEntries([...response.headers].filter(([header]) => /^(content-type|x-ratelimit-|retry-after)/i.test(header)));
      fs.writeFileSync(path.join(RECORD, `${name}-${Date.now()}.json`), JSON.stringify({ status: response.status, headers, body: text }, null, 2));
    }
    return response;
  };
}
const shape = found => {
  expect(found.results.length).toBeGreaterThan(0);
  for (const result of found.results) {
    expect(result.url).toMatch(/^https?:\/\//);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.excerpt.length).toBeGreaterThan(0);
    expect(result.excerpt).not.toMatch(/<\/?strong>/);
  }
};

describe.skipIf(!KEY)('live Brave Search API', () => {
  it('returns parsed results and rate-limit windows for one query', async () => {
    const search = createBraveSearch({ apiKey: KEY, fetch: recording('brave') });
    const found = await search.search({ query: QUERY, count: 3, signal: AbortSignal.timeout(15000) });
    shape(found);
    expect(found.results.length).toBeLessThanOrEqual(3);
    expect(found.usage).toMatchObject({ provider: 'brave', requests: 1, billable: true });
    expect(found.usage.rateLimit?.windows.length).toBeGreaterThan(0);
    expect(JSON.stringify(found)).not.toContain(KEY);
  }, 20000);
});

describe.skipIf(!SEARXNG)('live SearXNG JSON API', () => {
  it('returns parsed results for one query', async () => {
    const search = createSearxngSearch({ baseUrl: SEARXNG, fetch: recording('searxng') });
    shape(await search.search({ query: QUERY, count: 3, signal: AbortSignal.timeout(15000) }));
  }, 20000);
});
