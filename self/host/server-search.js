/** Search-backed answers through Reploid's server search route (server/search). The server holds the search
 * service's key and fetches cited pages; this port only sends the query and asks for passages. Its route is
 * Brave only, because the approved per-answer permission names Brave: the server refuses the query rather than
 * send it to another configured service. */
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const ROUTE = '/api/retrieval';

export function createServerSearch({ fetch = (...input) => globalThis.fetch(...input), baseUrl = '', authorization = () => null,
  searchProvider = 'brave' } = {}) {
  let status = { state: 'unknown', provider: null, message: '' }, checking = null;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener({ ...status }); };
  const request = async (path, body, signal) => {
    const headers = { Accept: 'application/json' }, token = await authorization();
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${ROUTE}${path}`, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}), signal, credentials: 'same-origin' });
    let payload = null;
    try { payload = await response.json(); } catch { /* reported below */ }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `The search route returned HTTP ${response.status}`);
      error.code = payload?.error?.code || `http-${response.status}`; error.status = response.status;
      throw error;
    }
    return payload;
  };

  const provider = Object.freeze({ id: `reploid.server-search/${searchProvider}`, version: '1', searchProvider,
    async search(query, limits, signal) {
      const payload = await request('/search', { query, count: Math.min(limits.maxResults, 20), expectProvider: searchProvider }, signal);
      assert(payload?.schema === 'reploid.server-search-results/v1' && payload.provider?.kind === searchProvider && Array.isArray(payload.results),
        'The search route returned an unexpected response');
      const usage = payload.usage;
      return { results: payload.results.map(item => ({ sourceId: item.sourceId, url: item.url, title: item.title, excerpt: item.excerpt,
        retrievedAt: item.retrievedAt, contentHash: item.contentHash, fetchToken: item.fetchToken })),
      ...(usage ? { usage: { provider: usage.provider, requests: usage.requests, costMicroUsd: usage.costMicroUsd ?? null } } : {}) };
    } });

  // Fetches the source page on the server, bound to the search that returned it, and keeps the passage's offsets.
  const extractor = Object.freeze({ id: 'reploid.server-page-extract', version: '1',
    async extract({ source, query, limits, signal }) {
      const payload = await request('/extract', { url: source.url, fetchToken: source.fetchToken, query,
        maxCharacters: limits.maxSourceCharacters }, signal);
      assert(payload?.schema === 'reploid.server-passage/v1' && typeof payload.text === 'string' && payload.document,
        'The extraction route returned an unexpected response');
      const { url, contentType, characters, sha256, start, end, bytes, status: code } = payload.document;
      return { sourceId: source.sourceId, url: payload.url, title: typeof payload.title === 'string' ? payload.title : '', text: payload.text,
        retrievedAt: payload.retrievedAt, contentHash: payload.contentHash,
        document: { url, contentType, characters, sha256, start, end, bytes, status: code } };
    } });

  return Object.freeze({
    provider, extractor, searchProvider,
    /** Search is offered only while the server's configured service is the one this route names. */
    available: () => status.state === 'ready',
    state: () => ({ ...status }),
    subscribe(listener) { listeners.add(listener); listener({ ...status }); return () => listeners.delete(listener); },
    refresh(signal) {
      checking ??= request('/status', null, signal).then(payload => {
        status = payload?.enabled && payload.provider === searchProvider ? { state: 'ready', provider: payload.provider, message: '' }
          : { state: 'unavailable', provider: payload?.provider ?? null, message: `Server search uses ${payload?.provider ?? 'no service'}` };
      }, error => { status = { state: 'unavailable', provider: null, message: error.message }; })
        .finally(() => { checking = null; notify(); });
      return checking.then(() => ({ ...status }));
    }
  });
}
