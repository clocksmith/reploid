/**
 * @fileoverview Brave Search API web search, server side only. The subscription key travels in the
 * X-Subscription-Token header, never in the URL or a response. Requests are spaced to the plan's rate and
 * held back while Brave's rate-limit headers report an exhausted window; a wait longer than maxWaitMs is
 * refused locally without calling Brave. Only successful (2xx) responses are billable.
 */
import { SearchProviderError, abortCode, readBounded, sleep as defaultSleep } from './errors.js';
import { htmlFragmentText } from './html-text.js';

export const BRAVE_WEB_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
export const BRAVE_MAX_COUNT = 20;
const MAX_RESPONSE_BYTES = 2_000_000;
const QUOTA_WINDOW_SECONDS = 86400;

const finite = value => Number.isFinite(value) ? value : null;
const list = (headers, name) => String(headers.get(name) || '').split(',').map(item => item.trim()).filter(Boolean);

/**
 * Brave's X-RateLimit-* headers are comma-separated, one entry per window, for example
 * Limit "1, 15000", Policy "1;w=1, 15000;w=2592000", Remaining "0, 14000", Reset "1, 1419704" (seconds).
 */
export function parseRateLimitHeaders(headers) {
  const limits = list(headers, 'x-ratelimit-limit').map(Number), remaining = list(headers, 'x-ratelimit-remaining').map(Number);
  const reset = list(headers, 'x-ratelimit-reset').map(Number);
  const policy = list(headers, 'x-ratelimit-policy').map(entry => {
    const [limit, ...parameters] = entry.split(';').map(part => part.trim());
    const window = parameters.find(part => part.startsWith('w='));
    return { limit: Number(limit), windowSeconds: window ? Number(window.slice(2)) : NaN };
  });
  const count = Math.max(limits.length, remaining.length, reset.length, policy.length);
  if (!count) return null;
  return { windows: Array.from({ length: count }, (_, index) => ({ limit: finite(limits[index] ?? policy[index]?.limit),
    remaining: finite(remaining[index]), resetSeconds: finite(reset[index]), windowSeconds: finite(policy[index]?.windowSeconds) })) };
}

const exhausted = rateLimit => (rateLimit?.windows || []).filter(window => window.remaining === 0);
const quotaWindow = window => window.windowSeconds !== null && window.windowSeconds >= QUOTA_WINDOW_SECONDS;
const webUrl = value => { try { return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

/** Search results with tags stripped and entities decoded; results without a web URL or text are dropped. */
export function braveResults(body, count) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.web === undefined) return [];
  if (!body.web || !Array.isArray(body.web.results)) return null;
  return body.web.results.flatMap(item => {
    if (!item || typeof item !== 'object' || !webUrl(item.url)) return [];
    const snippets = Array.isArray(item.extra_snippets) ? item.extra_snippets.map(htmlFragmentText).filter(Boolean) : [];
    const excerpt = htmlFragmentText(item.description) || snippets[0] || '';
    if (!excerpt) return [];
    return [{ url: item.url, title: (htmlFragmentText(item.title) || item.url).slice(0, 1000), excerpt }];
  }).slice(0, count);
}

function errorDetail(text) {
  try { const detail = JSON.parse(text)?.error?.detail; return typeof detail === 'string' ? detail.slice(0, 300) : null; } catch { return null; }
}

export function createBraveSearch({ apiKey, fetch = globalThis.fetch, now = Date.now, endpoint = BRAVE_WEB_SEARCH_ENDPOINT,
  costMicroUsdPerQuery = null, qps = 1, maxWaitMs = 2000, sleep = defaultSleep }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Brave search needs an API key');
  if (typeof fetch !== 'function') throw new Error('Brave search needs fetch');
  if (costMicroUsdPerQuery !== null && !(Number.isSafeInteger(costMicroUsdPerQuery) && costMicroUsdPerQuery >= 0)) throw new Error('Invalid Brave query cost');
  const interval = 1000 / qps;
  let nextAt = 0, blockedUntil = 0, blockedQuota = false;

  /** Reserves the next request slot or refuses when the wait would exceed maxWaitMs. */
  function reserve() {
    const current = now(), wait = Math.max(0, nextAt - current, blockedUntil - current);
    if (wait > maxWaitMs) {
      throw new SearchProviderError(blockedQuota && blockedUntil > current ? 'quota-exhausted' : 'rate-limited',
        { status: 429, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)), detail: 'Held back locally; Brave was not called' });
    }
    nextAt = Math.max(current, nextAt) + interval;
    return wait;
  }
  function observe(rateLimit) {
    const windows = exhausted(rateLimit).filter(window => window.resetSeconds !== null);
    if (!windows.length) return;
    const latest = windows.reduce((a, b) => (b.resetSeconds > a.resetSeconds ? b : a));
    blockedUntil = Math.max(blockedUntil, now() + latest.resetSeconds * 1000);
    blockedQuota = windows.some(quotaWindow);
  }

  return Object.freeze({
    kind: 'brave',
    async search({ query, count = 10, signal = null }) {
      if (typeof query !== 'string' || !query.trim()) throw new SearchProviderError('invalid-request', { detail: 'Query is empty' });
      if (!Number.isSafeInteger(count) || count < 1 || count > BRAVE_MAX_COUNT) {
        throw new SearchProviderError('invalid-request', { detail: `count must be 1 to ${BRAVE_MAX_COUNT}` });
      }
      const wait = reserve();
      try { if (wait > 0) await sleep(wait, signal); }
      catch { throw new SearchProviderError(abortCode(signal)); }
      const url = new URL(endpoint);
      url.searchParams.set('q', query.trim());
      url.searchParams.set('count', String(count));
      let response;
      try {
        response = await fetch(url, { method: 'GET', signal: signal ?? undefined,
          headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': apiKey } });
      } catch (error) {
        throw new SearchProviderError(signal?.aborted ? abortCode(signal) : 'provider-unavailable',
          { detail: signal?.aborted ? null : String(error?.cause?.code || error?.name || 'network error') });
      }
      const rateLimit = parseRateLimitHeaders(response.headers);
      observe(rateLimit);
      const failed = { provider: 'brave', requests: 1, billable: false, costMicroUsd: null, rateLimit };
      let text;
      try { text = await readBounded(response, MAX_RESPONSE_BYTES, () => new SearchProviderError('invalid-response', { status: response.status, detail: 'Response exceeds 2 MB', usage: failed })); }
      catch (error) {
        if (error instanceof SearchProviderError) throw error;
        throw new SearchProviderError(signal?.aborted ? abortCode(signal) : 'provider-unavailable', { status: response.status, usage: failed });
      }
      if (!response.ok) {
        const status = response.status, detail = errorDetail(text);
        const fail = (code, extra = {}) => new SearchProviderError(code, { status, detail, usage: failed, ...extra });
        if (status === 401 || status === 403) throw fail('unauthorized');
        if (status === 402) throw fail('quota-exhausted');
        if (status === 400 || status === 422) throw fail('invalid-request');
        if (status === 429) {
          const windows = exhausted(rateLimit), quota = windows.some(quotaWindow);
          const header = Number(response.headers.get('retry-after'));
          const resets = windows.map(window => window.resetSeconds).filter(value => value !== null);
          const retryAfterSeconds = Number.isFinite(header) && header > 0 ? Math.ceil(header) : resets.length ? Math.max(1, Math.ceil(Math.min(...resets))) : 1;
          throw fail(quota ? 'quota-exhausted' : 'rate-limited', { retryAfterSeconds });
        }
        throw fail('provider-unavailable');
      }
      let body;
      try { body = JSON.parse(text); } catch { throw new SearchProviderError('invalid-response', { status: response.status, detail: 'Response is not JSON', usage: { ...failed, billable: true, costMicroUsd: costMicroUsdPerQuery } }); }
      const results = braveResults(body, count);
      const usage = { provider: 'brave', requests: 1, billable: true, costMicroUsd: costMicroUsdPerQuery, rateLimit };
      if (!results) throw new SearchProviderError('invalid-response', { status: response.status, detail: 'Unexpected response shape', usage });
      return { results, usage, retrievedAt: now(), moreResultsAvailable: body.query?.more_results_available === true };
    }
  });
}
