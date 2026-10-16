/** Device-side search for search-backed answers. The person's own search tool runs the query from this device and
 * this device fetches the result pages, so no Reploid server receives the query or the pages. The search tool is the
 * MCP web search the person named and turned on in Settings (web-search.js); turning it on is its one-time
 * configuration consent, and changing the server turns it off. Each answer also needs the per-answer search
 * permission for DEVICE_SEARCH_PROVIDER (the owner-approved wording in search-permission.json), which names the
 * server's host; a changed server needs a new permission.
 *
 * Pages are fetched under the shared page fetch policy (the server fetcher's limits) without cookies, credentials or
 * a referrer, then extracted, sliced and hashed by the same library code as the server route, so the same bytes give
 * the same document hash and passage offsets. A tab cannot see or bound redirect hops, so it follows none; it cannot
 * check where a name resolves, so it refuses IP literals and local names. An ordinary tab reads only pages that allow
 * cross-origin reads; others fail extraction and are omitted from the record. A host with separately authorized
 * broader fetch (an extension or native companion) supplies it as `fetch`. The requester bears this route's costs,
 * which have no configured price: they stay null, never zero. */
import { PAGE_FETCH_POLICY, extractDocumentText, selectPassage, sha256Text } from '../vendor/reploid/retrieval/index.js';
import { createProviderWebAccess } from './web-access.js';

/** The search service a per-answer permission for this route names, with the chosen server's host. */
export const DEVICE_SEARCH_PROVIDER = 'device-mcp';
const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.9';
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const failure = (code, detail = null) => Object.assign(new Error(detail ? `Page fetch failed (${code}): ${detail}` : `Page fetch failed (${code})`), { code });
const mimeOf = value => String(value || '').split(';')[0].trim().toLowerCase();

/** The URL when this device may fetch it: http(s), no embedded credentials, within the length limit, and neither an IP
 * literal nor a local or single-label name. Otherwise null. */
export function devicePageUrl(value, policy = PAGE_FETCH_POLICY) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > policy.maxUrlCharacters) return null;
  // The URL parser normalizes IPv4 shorthand to dotted form and keeps IPv6 in brackets.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (host === 'localhost' || LOCAL_SUFFIXES.some(suffix => host.endsWith(suffix))) return null;
  return url;
}

async function readBounded(response, maxBytes, signal) {
  signal.throwIfAborted();
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw failure('too-large', 'Body exceeds the byte limit');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let total = 0;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw failure('too-large', 'Body exceeds the byte limit'); }
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/**
 * `access`: one WebAccess implementation for both search and page reading, pinned to `accessServer`.
 * Legacy `source` and `fetch` compose the provider implementation. The host binds the disclosed server;
 * a browser on a different operator's device requires its own matching disclosure, never this device's grant.
 * `enabled()`: whether the configuration consent is in force.
 */
export function createDeviceSearch({ access, accessServer, source, enabled = () => true, server, fetch, now = Date.now,
  policy = PAGE_FETCH_POLICY } = {}) {
  assert(!access || (!source && !fetch), 'Choose one web access implementation');
  assert(!access || (typeof accessServer === 'string' && accessServer.length > 0), 'Web access needs its disclosed search server');
  const web = access || createProviderWebAccess({ provider: source, fetch });
  assert(typeof web.id === 'string' && typeof web.search === 'function' && typeof web.fetch === 'function',
    'Device search needs search and page reading');
  assert(typeof enabled === 'function' && typeof server === 'function',
    'Device search needs its consent check, its search server and fetch');
  const allowed = new Set(policy.contentTypes), unsupported = new Set(policy.unsupportedContentTypes);
  const available = () => enabled() && Boolean(server()) && (!access || server() === accessServer);
  const requireAccess = () => assert(available(), 'Device search is off or its service binding changed');

  const provider = Object.freeze({
    get id() { return `reploid.device-search/${web.id}`; },
    version: '1', searchProvider: DEVICE_SEARCH_PROVIDER, costBearer: 'requester', supply: 'device',
    /** The host of the search server the person set up; each per-answer permission names it. */
    get searchServer() { return server() || null; },
    // The answer key stays on this device: the search tool receives only the query.
    async search(query, limits, signal) {
      requireAccess();
      const found = await web.search(query, limits, signal);
      requireAccess();
      return { results: Array.isArray(found) ? found : found?.results,
        usage: { provider: DEVICE_SEARCH_PROVIDER, requests: 1, costMicroUsd: null } };
    }
  });

  async function fetchPage(url, signal) {
    requireAccess();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(failure('timeout', `${policy.timeoutMs} ms`)), policy.timeoutMs);
    const forward = () => controller.abort(failure('cancelled'));
    if (signal?.aborted) forward(); else signal?.addEventListener('abort', forward, { once: true });
    try {
      let response;
      try {
        response = await web.fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          cache: 'no-store', headers: { Accept: ACCEPT }, signal: controller.signal });
      } catch (error) {
        // Cross-origin refusals, redirects and network failures look alike to a tab.
        throw controller.signal.aborted ? controller.signal.reason : failure('fetch-failed', String(error?.name || 'network error'));
      }
      const discard = () => response.body?.cancel?.().catch(() => {});
      if (!available()) { discard(); requireAccess(); }
      const final = response.url ? devicePageUrl(response.url, policy) : url;
      if (!final) { discard(); throw failure('blocked-address'); }
      if (!response.ok) { discard(); throw failure('http-error', String(response.status)); }
      const contentType = String(response.headers.get('content-type') || ''), mime = mimeOf(contentType);
      if (unsupported.has(mime)) { discard(); throw failure('unsupported-content-type', `${mime} text extraction is not supported`); }
      if (!allowed.has(mime)) { discard(); throw failure('unsupported-content-type', mime ? `${mime} is not supported` : 'The page has no content type'); }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > policy.maxBytes) { discard(); throw failure('too-large', `${declared} bytes`); }
      let body;
      try { body = await readBounded(response, policy.maxBytes, controller.signal); }
      catch (error) { throw controller.signal.aborted ? controller.signal.reason : error; }
      requireAccess();
      return { url: final.href, status: response.status, contentType: contentType.slice(0, 200), body };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', forward);
    }
  }

  // The same extraction, passage selection and hashing as the server route's /extract.
  const extractor = Object.freeze({ id: 'reploid.device-page-extract', version: '1',
    async extract({ source: result, query, limits, signal }) {
      const url = devicePageUrl(result.url, policy);
      if (!url) throw failure('blocked-address');
      const page = await fetchPage(url, signal);
      const document = extractDocumentText({ body: page.body, contentType: page.contentType });
      if (!document.text.trim()) throw failure('no-text');
      const passage = selectPassage({ text: document.text, query, maxCharacters: limits.maxSourceCharacters });
      if (!passage.text) throw failure('no-text');
      const documentHash = await sha256Text(document.text);
      return { sourceId: result.sourceId, url: page.url, title: document.title.slice(0, 1000), text: passage.text, retrievedAt: now(),
        contentHash: documentHash, document: { url: page.url, status: page.status, contentType: page.contentType,
          characters: document.text.length, sha256: documentHash, start: passage.start, end: passage.end, bytes: page.body.byteLength },
        costMicroUsd: null };
    } });

  return Object.freeze({ provider, extractor, searchProvider: DEVICE_SEARCH_PROVIDER,
    /** The one-time configuration consent; the per-answer permission is checked separately for every answer. */
    available });
}
