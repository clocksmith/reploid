/** Host-owned web access. Both implementations return SearchProvider results and Fetch responses;
 * retrieval owns page limits, extraction and citations. Hosts own connection and disclosure grants.
 * These adapters never attach a browser, select a fallback, or close borrowed resources. */
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** A configured API/MCP search provider plus a page reader (ordinary Fetch by default). */
export function createProviderWebAccess({ provider, fetch = (...args) => globalThis.fetch(...args) }) {
  assert(typeof provider?.id === 'string' && typeof provider.search === 'function', 'Web access needs a search provider');
  assert(typeof fetch === 'function', 'Web access needs a page reader');
  return Object.freeze({
    get id() { return provider.id; },
    search: (query, limits, signal) => provider.search(query, limits, signal),
    fetch: (url, options) => fetch(url, options)
  });
}

/** An already attached, explicitly authorized browser bridge. The bridge must implement bounded
 * search and Fetch-compatible public-page reads, honoring credentials, redirects and cancellation.
 * Merely having a tab open grants no access. The host's authorization check covers the browser,
 * destination and operation; it is separate from the conversation's per-answer disclosure grant. */
export function createBrowserWebAccess({ bridge, authorized }) {
  assert(typeof bridge?.id === 'string' && bridge.id.length > 0, 'Browser access needs an attachment identity');
  assert(typeof bridge.search === 'function' && typeof bridge.fetch === 'function', 'Browser access needs search and page reading');
  assert(typeof authorized === 'function', 'Browser access needs an authorization check');
  const id = bridge.id;
  const search = bridge.search.bind(bridge), fetch = bridge.fetch.bind(bridge);
  const check = (operation, target, signal) => {
    signal?.throwIfAborted();
    assert(bridge.id === id, 'The attached browser changed');
    assert(authorized({ id, operation, target }) === true, 'Browser web access is not authorized');
  };
  const invoke = async (operation, target, signal, run) => {
    check(operation, target, signal);
    const result = await run();
    try { check(operation, target, signal); }
    catch (error) {
      if (operation === 'fetch') await result?.body?.cancel?.().catch(() => {});
      throw error;
    }
    return result;
  };
  return Object.freeze({
    id,
    search: (query, limits, signal) => invoke('search', query, signal, () => search(query, limits, signal)),
    fetch: (url, options = {}) => invoke('fetch', url, options.signal, () => fetch(url, options))
  });
}
