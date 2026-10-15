/**
 * @fileoverview Server search configuration. The Brave key comes from
 * REPLOID_BRAVE_SEARCH_API_KEY or a key file outside the repository named by
 * REPLOID_BRAVE_SEARCH_API_KEY_FILE; it is never logged or sent to browsers.
 * Search stays off without an explicit daily query budget.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SEARCH_PROVIDERS = Object.freeze(['brave', 'searxng']);

const positiveInteger = value => /^\d+$/.test(String(value ?? '').trim()) && Number(value) > 0 ? Number(value) : null;
const off = (reason, provider = null) => ({ enabled: false, reason, provider });
const inside = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

function readKey(env, { repoRoot, readFileSync }) {
  const direct = String(env.REPLOID_BRAVE_SEARCH_API_KEY || '').trim();
  if (direct) return direct;
  const file = String(env.REPLOID_BRAVE_SEARCH_API_KEY_FILE || '').trim();
  if (!file) return '';
  // A key file inside the working tree could be committed by accident.
  if (repoRoot && inside(repoRoot, file)) throw new Error('REPLOID_BRAVE_SEARCH_API_KEY_FILE must be outside the repository');
  return String(readFileSync(file, 'utf8')).trim();
}

function searxngUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('REPLOID_SEARXNG_BASE_URL must be http(s)');
  return url.href.replace(/\/+$/, '');
}

/** Returns { enabled, reason, provider, brave, searxng, maxQueriesPerDay, fetchSecret, usageLog }; never throws for absence, only for unsafe values. */
export function readSearchConfig(env = {}, { repoRoot = null, readFileSync = fs.readFileSync, randomBytes = crypto.randomBytes } = {}) {
  let apiKey, baseUrl;
  try { apiKey = readKey(env, { repoRoot, readFileSync }); baseUrl = searxngUrl(env.REPLOID_SEARXNG_BASE_URL); }
  catch (error) { return off(error.message); }
  const requested = String(env.REPLOID_SEARCH_PROVIDER || '').trim().toLowerCase();
  if (requested && !SEARCH_PROVIDERS.includes(requested)) return off('REPLOID_SEARCH_PROVIDER must be brave or searxng');
  const provider = requested || (apiKey ? 'brave' : baseUrl ? 'searxng' : null);
  if (!provider) return off('No search provider is configured');
  if (provider === 'brave' && !apiKey) return off('Brave search needs REPLOID_BRAVE_SEARCH_API_KEY or REPLOID_BRAVE_SEARCH_API_KEY_FILE', provider);
  if (provider === 'searxng' && !baseUrl) return off('SearXNG search needs REPLOID_SEARXNG_BASE_URL', provider);
  const maxQueriesPerDay = positiveInteger(env.REPLOID_SEARCH_MAX_QUERIES_PER_DAY);
  if (!maxQueriesPerDay) return off('Search needs an explicit REPLOID_SEARCH_MAX_QUERIES_PER_DAY budget', provider);
  const usd = String(env.REPLOID_BRAVE_SEARCH_USD_PER_1000 ?? '').trim();
  if (usd && !(/^\d+(?:\.\d+)?$/.test(usd))) return off('REPLOID_BRAVE_SEARCH_USD_PER_1000 must be a decimal number', provider);
  const qpsText = String(env.REPLOID_BRAVE_SEARCH_QPS ?? '').trim();
  const qps = qpsText ? Number(qpsText) : 1;
  if (!(Number.isFinite(qps) && qps > 0 && qps <= 1000)) return off('REPLOID_BRAVE_SEARCH_QPS must be a positive number', provider);
  const secret = String(env.REPLOID_SEARCH_FETCH_SECRET || '').trim();
  return {
    enabled: true, reason: null, provider,
    // Micro-USD per query: $5 per 1,000 is 5000. Null means the deployment has not priced queries.
    brave: provider === 'brave' ? { apiKey, qps, costMicroUsdPerQuery: usd ? Math.round(Number(usd) * 1000) : null } : null,
    searxng: provider === 'searxng' ? { baseUrl } : null,
    maxQueriesPerDay,
    // Per-process when unset: tokens then verify only on the instance that issued them.
    fetchSecret: secret || randomBytes(32).toString('base64url'),
    sharedFetchSecret: Boolean(secret),
    usageLog: String(env.REPLOID_SEARCH_USAGE_LOG || '').trim() || null
  };
}
