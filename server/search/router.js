/**
 * @fileoverview /api/retrieval routes. Search runs the configured provider under the daily budget and returns
 * results with fetch tokens; extraction fetches only URLs that a search on this server returned (an HMAC token
 * binds the URL and an expiry), so the route is not an open fetch proxy. Neither route returns credentials.
 */
import crypto from 'node:crypto';
import express from 'express';
import { extractDocumentText } from './html-text.js';
import { selectPassage } from './passage.js';

export const SERVER_SEARCH_STATUS_SCHEMA = 'reploid.server-search-status/v1';
export const SERVER_SEARCH_RESULTS_SCHEMA = 'reploid.server-search-results/v1';
export const SERVER_PASSAGE_SCHEMA = 'reploid.server-passage/v1';
const MAX_QUERY = 512, MAX_COUNT = 20, MAX_PASSAGE = 12000, SEARCH_DEADLINE_MS = 10000;

const sha256Hex = value => crypto.createHash('sha256').update(value).digest('hex');
const mac = (secret, url, expiresAt) => crypto.createHmac('sha256', secret).update(`${url}\n${expiresAt}`).digest('base64url');

export function signFetchToken(secret, url, expiresAt) { return `${mac(secret, url, expiresAt)}.${expiresAt}`; }

/** True when `token` was issued for exactly `url` by this secret and has not expired. */
export function verifyFetchToken(secret, url, token, now = Date.now()) {
  const [signature, expiry, extra] = typeof token === 'string' && token.length <= 512 ? token.split('.') : [];
  if (!signature || !/^\d{1,16}$/.test(expiry || '') || extra !== undefined || Number(expiry) <= now) return false;
  const expected = Buffer.from(mac(secret, url, Number(expiry))), given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Response status per failure code; upstream credential failures are the server's problem, not the caller's.
const STATUS = { 'invalid-request': 400, 'invalid-url': 400, 'provider-unauthorized': 502, 'rate-limited': 429, 'quota-exhausted': 429,
  'budget-exhausted': 429, 'json-disabled': 502, 'provider-unavailable': 502, 'invalid-response': 502, timeout: 504, cancelled: 504,
  'blocked-address': 403, 'unsupported-content-type': 415, 'too-large': 413, 'http-error': 502, 'fetch-failed': 502,
  'too-many-redirects': 502, 'no-text': 422, 'invalid-fetch-token': 403, 'provider-mismatch': 409 };
const MESSAGES = { 'provider-unauthorized': 'The search provider refused the server credentials',
  'invalid-fetch-token': 'This URL was not returned by a search on this server, or its token expired',
  'provider-mismatch': 'The server is configured for a different search provider', 'no-text': 'The page has no extractable text' };

function send(res, code, { detail = null, retryAfterSeconds = null, status = null } = {}) {
  if (res.headersSent || res.writableEnded) return;
  if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
  const message = MESSAGES[code] || (detail ? String(detail).slice(0, 300) : code.replace(/-/g, ' '));
  res.status(STATUS[code] || 502).json({ error: { code, message, ...(status ? { upstreamStatus: status } : {}),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } });
}
const failure = (res, error) => {
  const code = error?.code === 'unauthorized' ? 'provider-unauthorized' : STATUS[error?.code] ? error.code : 'provider-unavailable';
  // Upstream detail is echoed only for request validation; other details stay in server logs.
  send(res, code, { detail: code === 'invalid-request' ? error.detail : null, retryAfterSeconds: error?.retryAfterSeconds, status: error?.status });
};

/** An abort signal for one route: its own deadline, or the caller disconnecting. */
function routeSignal(res, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Route deadline'), { name: 'TimeoutError' })), timeoutMs);
  res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) controller.abort(new Error('Caller disconnected')); });
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

export function createSearchRouter({ search, fetcher, extract = extractDocumentText, usage, fetchSecret, now = Date.now,
  tokenTtlMs = 15 * 60 * 1000, searchDeadlineMs = SEARCH_DEADLINE_MS }) {
  if (!search?.kind || typeof search.search !== 'function') throw new Error('Search router needs a search provider');
  if (typeof fetcher?.fetchPage !== 'function') throw new Error('Search router needs a page fetcher');
  if (!usage || typeof fetchSecret !== 'string' || fetchSecret.length < 16) throw new Error('Search router needs usage counters and a fetch secret');
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));
  const provider = { kind: search.kind, id: `reploid.server-search/${search.kind}`, version: '1' };

  router.get('/status', (req, res) => res.json({ schema: SERVER_SEARCH_STATUS_SCHEMA, enabled: true, provider: search.kind,
    providerId: provider.id, unsupportedContentTypes: ['application/pdf'] }));
  router.get('/usage', (req, res) => res.json(usage.snapshot()));

  router.post('/search', async (req, res) => {
    const body = req.body, query = typeof body?.query === 'string' ? body.query.trim() : '';
    const count = body?.count ?? 10;
    if (!plainObject(body) || !query || query.length > MAX_QUERY || !Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT
      || (body.expectProvider !== undefined && typeof body.expectProvider !== 'string')) {
      return send(res, 'invalid-request', { detail: `query (1 to ${MAX_QUERY} characters) and count (1 to ${MAX_COUNT}) are required` });
    }
    // The person allowed one named provider; a different configuration sends nothing.
    if (body.expectProvider !== undefined && body.expectProvider !== search.kind) return send(res, 'provider-mismatch');
    try { usage.admit(); } catch (error) { return failure(res, error); }
    const { signal, done } = routeSignal(res, searchDeadlineMs);
    let found;
    try { found = await search.search({ query, count, signal }); }
    catch (error) {
      usage.record({ provider: search.kind, billable: error?.usage?.billable === true, costMicroUsd: error?.usage?.costMicroUsd ?? null,
        rateLimit: error?.usage?.rateLimit ?? null, subject: req.reploidAccessSubject ?? null, outcome: error?.code || 'error' });
      done(); return failure(res, error);
    }
    done();
    const snapshot = usage.record({ provider: search.kind, billable: found.usage.billable, costMicroUsd: found.usage.costMicroUsd,
      rateLimit: found.usage.rateLimit, resultCount: found.results.length, subject: req.reploidAccessSubject ?? null });
    const retrievedAt = now(), expiresAt = retrievedAt + tokenTtlMs, seen = new Set();
    const results = found.results.flatMap(result => {
      const sourceId = 'web-' + sha256Hex(result.url).slice(0, 16);
      if (seen.has(sourceId)) return [];
      seen.add(sourceId);
      return [{ sourceId, url: result.url, title: result.title, excerpt: result.excerpt, retrievedAt,
        contentHash: 'sha256:' + sha256Hex(result.excerpt), fetchToken: signFetchToken(fetchSecret, result.url, expiresAt) }];
    });
    res.json({ schema: SERVER_SEARCH_RESULTS_SCHEMA, provider, results,
      usage: { provider: found.usage.provider, requests: found.usage.requests, billable: found.usage.billable,
        costMicroUsd: found.usage.billable ? found.usage.costMicroUsd : null, rateLimit: found.usage.rateLimit,
        budget: { day: snapshot.day, queries: snapshot.queries, maxQueriesPerDay: snapshot.maxQueriesPerDay } } });
  });

  router.post('/extract', async (req, res) => {
    const body = req.body;
    const valid = plainObject(body) && typeof body.url === 'string' && body.url.length <= 2048 && typeof body.fetchToken === 'string'
      && typeof (body.query ?? '') === 'string' && (body.query ?? '').length <= MAX_QUERY
      && Number.isSafeInteger(body.maxCharacters) && body.maxCharacters >= 1 && body.maxCharacters <= MAX_PASSAGE;
    if (!valid) return send(res, 'invalid-request', { detail: `url, fetchToken, query and maxCharacters (1 to ${MAX_PASSAGE}) are required` });
    if (!verifyFetchToken(fetchSecret, body.url, body.fetchToken, now())) return send(res, 'invalid-fetch-token');
    // The fetcher's own deadline fires first and reports timeout; this one only backs it up.
    const { signal, done } = routeSignal(res, (fetcher.timeoutMs ?? SEARCH_DEADLINE_MS) + 1000);
    let page;
    try { page = await fetcher.fetchPage(body.url, { signal }); }
    catch (error) { usage.recordFetch({ ok: false }); done(); return failure(res, error); }
    done();
    usage.recordFetch({ bytes: page.bytes, ok: true });
    let document;
    try { document = extract({ body: page.body, contentType: page.contentType, charset: page.charset }); }
    catch { return send(res, 'no-text'); }
    if (!document.text.trim()) return send(res, 'no-text');
    const passage = selectPassage({ text: document.text, query: body.query ?? '', maxCharacters: body.maxCharacters });
    if (!passage.text) return send(res, 'no-text');
    const documentHash = 'sha256:' + sha256Hex(document.text);
    res.json({ schema: SERVER_PASSAGE_SCHEMA, url: body.url, text: passage.text, retrievedAt: now(), contentHash: documentHash,
      document: { url: page.url, status: page.status, contentType: page.contentType, bytes: page.bytes, byteSha256: page.byteSha256,
        characters: document.text.length, sha256: documentHash, start: passage.start, end: passage.end } });
  });
  return router;
}
