/**
 * @fileoverview SearXNG search through its JSON API, GET {baseUrl}/search?format=json. Instances answer 403 when
 * `json` is not listed under search.formats in settings.yml, which public instances commonly do. SearXNG has
 * no per-query price, so usage records no cost. The consumer permission wording names Brave; a SearXNG
 * deployment needs its own approved wording before the per-answer search flow can use it.
 */
import { SearchProviderError, abortCode, readBounded } from './errors.js';
import { htmlFragmentText } from '../../packages/reploid/src/retrieval/page-text.js';

const MAX_RESPONSE_BYTES = 2_000_000;
const webUrl = value => { try { return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

export function searxngResults(body, count) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.results)) return null;
  const seen = new Set();
  return body.results.flatMap(item => {
    if (!item || typeof item !== 'object' || !webUrl(item.url) || seen.has(item.url)) return [];
    const excerpt = htmlFragmentText(item.content);
    if (!excerpt) return [];
    seen.add(item.url);
    return [{ url: item.url, title: (htmlFragmentText(item.title) || item.url).slice(0, 1000), excerpt }];
  }).slice(0, count);
}

export function createSearxngSearch({ baseUrl, fetch = globalThis.fetch, now = Date.now }) {
  const base = new URL(String(baseUrl || ''));
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('SearXNG needs an http(s) base URL');
  if (typeof fetch !== 'function') throw new Error('SearXNG search needs fetch');
  const endpoint = new URL('search', base.href.endsWith('/') ? base.href : base.href + '/');
  return Object.freeze({
    kind: 'searxng',
    async search({ query, count = 10, signal = null }) {
      if (typeof query !== 'string' || !query.trim()) throw new SearchProviderError('invalid-request', { detail: 'Query is empty' });
      if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new SearchProviderError('invalid-request', { detail: 'count must be 1 to 20' });
      const url = new URL(endpoint);
      url.searchParams.set('q', query.trim()); url.searchParams.set('format', 'json'); url.searchParams.set('pageno', '1');
      const usage = { provider: 'searxng', requests: 1, billable: false, costMicroUsd: null, rateLimit: null };
      let response, text;
      try {
        response = await fetch(url, { method: 'GET', signal: signal ?? undefined, headers: { Accept: 'application/json' } });
        text = await readBounded(response, MAX_RESPONSE_BYTES, () => new SearchProviderError('invalid-response', { status: response.status, detail: 'Response exceeds 2 MB', usage }));
      } catch (error) {
        if (error instanceof SearchProviderError) throw error;
        throw new SearchProviderError(signal?.aborted ? abortCode(signal) : 'provider-unavailable',
          { detail: signal?.aborted ? null : String(error?.cause?.code || error?.name || 'network error'), usage });
      }
      if (!response.ok) {
        const status = response.status, fail = (code, extra = {}) => new SearchProviderError(code, { status, usage, ...extra });
        if (status === 403) throw fail('json-disabled', { detail: 'The instance refused format=json; enable json under search.formats in settings.yml (public instances often disable it)' });
        if (status === 429) {
          const header = Number(response.headers.get('retry-after'));
          throw fail('rate-limited', { retryAfterSeconds: Number.isFinite(header) && header > 0 ? Math.ceil(header) : 1 });
        }
        if (status === 401) throw fail('unauthorized');
        if (status === 400 || status === 422) throw fail('invalid-request');
        throw fail('provider-unavailable');
      }
      let body;
      try { body = JSON.parse(text); } catch {
        // An HTML page with status 200 usually means the instance ignored format=json.
        throw new SearchProviderError('invalid-response', { status: response.status, detail: 'Response is not JSON', usage });
      }
      const results = searxngResults(body, count);
      if (!results) throw new SearchProviderError('invalid-response', { status: response.status, detail: 'Unexpected response shape', usage });
      // SearXNG charges nothing per query; its hosting cost belongs to the operator's accounts, not to queries.
      return { results, usage, retrievedAt: now(), moreResultsAvailable: false };
    }
  });
}
