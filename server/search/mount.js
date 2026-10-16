/**
 * @fileoverview Mounts /api/retrieval when search is configured (config.js): a provider, its credential or
 * base URL, and an explicit daily query budget. Every route sits behind the caller-supplied `authorize`
 * middleware. Logs name the provider and budget, never the key.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBraveSearch } from './brave.js';
import { readSearchConfig } from './config.js';
import { createPageFetcher } from './page-fetch.js';
import { createSearchRouter } from './router.js';
import { createSearxngSearch } from './searxng.js';
import { createSearchUsage } from './usage.js';

export const SEARCH_ROUTES_PREFIX = '/api/retrieval';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function mountSearchRoutes(app, { env = process.env, authorize, log = console, fetch = globalThis.fetch, repoRoot = REPOSITORY_ROOT,
  fetcher = null, now = Date.now, readFileSync } = {}) {
  const config = readSearchConfig(env, { repoRoot, ...(readFileSync ? { readFileSync } : {}) });
  if (!config.enabled) {
    if (typeof authorize === 'function') app.get(`${SEARCH_ROUTES_PREFIX}/status`, authorize, (_req, res) => res.json({
      schema: 'reploid.server-search-status/v1', enabled: false, provider: config.provider,
      message: 'Web search is not configured on this server.'
    }));
    return { mounted: false, reason: config.reason, provider: config.provider };
  }
  if (typeof authorize !== 'function') throw new Error('Search routes need an authorization middleware');
  const search = config.provider === 'brave'
    ? createBraveSearch({ apiKey: config.brave.apiKey, fetch, now, qps: config.brave.qps, costMicroUsdPerQuery: config.brave.costMicroUsdPerQuery })
    : createSearxngSearch({ baseUrl: config.searxng.baseUrl, fetch, now });
  const usage = createSearchUsage({ now, maxQueriesPerDay: config.maxQueriesPerDay, logPath: config.usageLog, log });
  app.use(SEARCH_ROUTES_PREFIX, authorize, createSearchRouter({ search, fetcher: fetcher || createPageFetcher(), usage,
    fetchSecret: config.fetchSecret, now, fetchMicroUsdPerGb: config.fetchMicroUsdPerGb }));
  const price = config.brave ? (config.brave.costMicroUsdPerQuery === null ? 'unpriced' : `${config.brave.costMicroUsdPerQuery} micro-USD per query`) : 'no per-query price';
  const fetchPrice = config.fetchMicroUsdPerGb === null ? 'fetches unpriced' : `${config.fetchMicroUsdPerGb} micro-USD per GB fetched`;
  log.log?.(`[Search] ${config.provider} mounted at ${SEARCH_ROUTES_PREFIX}; budget ${config.maxQueriesPerDay} queries per UTC day; ${price}; ${fetchPrice}`
    + (config.sharedFetchSecret ? '' : '; fetch tokens verify only on this instance (set REPLOID_SEARCH_FETCH_SECRET to share them)'));
  return { mounted: true, provider: config.provider, prefix: SEARCH_ROUTES_PREFIX, usage };
}
