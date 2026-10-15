// REP-8 device-side search: the person's Settings MCP search tool runs the query from the requester's device, and the
// device fetches result pages under the shared page fetch policy, then extracts, slices and hashes them with the same
// library code as the server route. The route is not offered until its per-answer wording is approved. The MCP server
// and every page are injected fakes; no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRetrieval, extractDocumentText, selectPassage, sha256Text, PAGE_FETCH_POLICY } from '../../packages/reploid/src/retrieval/index.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createSearchPermission, searchPermissionWording } from '../../packages/reploid/src/chat/search-permission.js';
import { createDeviceSearch, devicePageUrl, DEVICE_SEARCH_PROVIDER } from '../../self/host/device-search.js';
import { createWebSearch } from '../../self/host/web-search.js';
import { createChatSession, DEVICE_SEARCH_ROUTE, SEARCH_ROUTE } from '../../self/host/chat-session.js';
import { LOCAL_DOPPLER_MODELS } from '../../self/config/doppler-local-models.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const AT = 1760500000000;
const EIFFEL = 'https://www.example.org/eiffel', LOUVRE = 'https://encyclopedia.example.net/louvre';
const PAGES = {
  [EIFFEL]: '<html><head><title>Eiffel Tower</title></head><body><nav>Menu</nav><main><p>Paris museums.</p><p>The Eiffel Tower was completed in 1889.</p></main></body></html>',
  [LOUVRE]: '<html><head><title>Louvre</title></head><body><main><p>The Louvre is the most visited art museum in the world.</p></main></body></html>'
};
const QUESTION = 'When was the Eiffel Tower completed and which museum is most visited?';
const ANSWER = 'The Eiffel Tower was completed in 1889 [1]. The Louvre is the most visited art museum in the world [2].';
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };

/** A fake MCP server whose search tool returns `urls` as Title/URL/Text blocks; it records every call it receives. */
function mcpServer(urls = [EIFFEL, LOUVRE]) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(init.body);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } }
      : body.method === 'tools/list' ? { tools: [{ name: 'web_search', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }
        : { content: [{ type: 'text', text: urls.map(link => `Title: Search title\nURL: ${link}\nText: Search snippet for ${link}`).join('\n\n') }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
      { headers: { 'content-type': 'application/json', ...(body.method === 'initialize' ? { 'mcp-session-id': 'session-1' } : {}) } });
  };
  return { fetch, calls };
}
/** Page fetches: each URL's response from `pages`, or a cross-origin refusal; records the request options. */
function pageFetch(pages = {}) {
  const requests = [];
  const fetch = vi.fn(async (url, init) => {
    requests.push({ url, init });
    const page = pages[url] ?? (PAGES[url] ? { body: PAGES[url] } : null);
    if (!page) throw new TypeError('Failed to fetch');
    if (page.throws) throw page.throws;
    const response = new Response(page.body, { status: page.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...page.headers } });
    if (page.url) Object.defineProperty(response, 'url', { value: page.url });
    return response;
  });
  return { fetch, requests };
}
function deviceRoute({ pages, urls } = {}) {
  const server = mcpServer(urls), web = createWebSearch({ storage: memory(), fetch: server.fetch, now: () => AT });
  web.configure({ url: 'https://search.example.net/mcp' }); web.setEnabled(true);
  const browser = pageFetch(pages);
  const device = createDeviceSearch({ source: web.provider, enabled: () => web.enabled(), fetch: browser.fetch, now: () => AT });
  return { server, web, browser, device };
}
async function retrieved(device, { answer = null, limits = {} } = {}) {
  const retrieval = createRetrieval({ provider: device.provider, extractor: device.extractor, now: () => AT });
  const record = await retrieval.retrieve(retrieval.pending(retrieval.request({ limits }, QUESTION), AT), null, { answer });
  return { retrieval, record };
}
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

describe('device-side retrieval', () => {
  it('fetches pages on this device and passes the retrieval and citation pipeline with the shared extraction', async () => {
    const { server, browser, device } = deviceRoute();
    const { retrieval, record } = await retrieved(device, { answer: 'attempt-1' });
    expect(record).toMatchObject({ outcome: 'retrieved', provider: { id: 'reploid.device-search/mcp-web-search:search.example.net' },
      extractor: { id: 'reploid.device-page-extract' } });
    // Each page is fetched without cookies, credentials, referrer or redirects, as a cross-origin read.
    expect(browser.requests.map(request => request.url)).toEqual([EIFFEL, LOUVRE]);
    for (const { init } of browser.requests) expect(init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    // The same bytes give the same document text, hash and passage offsets as the server route's shared extraction.
    for (const source of record.sources) {
      const document = extractDocumentText({ body: new TextEncoder().encode(PAGES[source.url]), contentType: 'text/html; charset=utf-8' });
      const passage = selectPassage({ text: document.text, query: QUESTION, maxCharacters: record.limits.maxSourceCharacters });
      expect(source).toMatchObject({ passageOrigin: 'extract', passage: passage.text, contentHash: await sha256Text(document.text),
        document: { url: source.url, sha256: await sha256Text(document.text), start: passage.start, end: passage.end, bytes: new TextEncoder().encode(PAGES[source.url]).byteLength } });
      expect(document.text.slice(source.document.start, source.document.end)).toBe(source.passage);
    }
    // Sources keep the fetched page's own title, nothing from the search response.
    expect(record.sources.map(source => source.title)).toEqual(['Eiffel Tower', 'Louvre']);
    expect(JSON.stringify(record)).not.toMatch(/Search title|Search snippet/);
    const verification = await retrieval.verify(ANSWER, record, null);
    expect(verification.claimSupport).toMatchObject({ contextValid: true, summary: { claims: 2, validCitations: 2, invalidCitations: 0, reviewableClaims: 2 } });
    // The requester bears this route; it has no configured price, so its costs stay unknown.
    expect(record.costs).toMatchObject({ retrieval: { bearer: 'requester', search: { service: DEVICE_SEARCH_PROVIDER, requests: 1, costMicroUsd: null },
      extraction: { attempted: 2, documents: 2, failed: 0, costMicroUsd: null }, costMicroUsd: null }, fallback: { path: 'none', costMicroUsd: 0 }, totalMicroUsd: null });
    // The answer key stays on this device: neither the search tool nor any page receives it.
    expect(server.calls.join('\n')).not.toContain('attempt-1');
    expect(JSON.stringify(browser.requests)).not.toContain('attempt-1');
  });

  it('refuses what the shared fetch policy refuses and omits pages this tab cannot read', async () => {
    // Ten results, the policy's maximum: nine refused or unreadable pages and one readable page.
    const urls = ['https://a.example.org/pdf', 'https://b.example.org/big', 'https://c.example.org/stream', 'https://d.example.org/image',
      'http://192.168.1.1/admin', 'https://printer.local/x', 'https://e.example.org/cors', 'https://f.example.org/missing',
      'https://g.example.org/moved', EIFFEL];
    const pages = { 'https://a.example.org/pdf': { body: '%PDF-1.7', headers: { 'content-type': 'application/pdf' } },
      'https://b.example.org/big': { body: 'x', headers: { 'content-length': String(PAGE_FETCH_POLICY.maxBytes + 1) } },
      'https://c.example.org/stream': { body: 'y'.repeat(PAGE_FETCH_POLICY.maxBytes + 1) },
      'https://d.example.org/image': { body: 'png', headers: { 'content-type': 'image/png' } },
      'https://f.example.org/missing': { body: 'gone', status: 404 },
      // A bridge that followed a redirect to a local name is refused after the fact.
      'https://g.example.org/moved': { body: PAGES[EIFFEL], url: 'http://intranet.lan/eiffel' } };
    const { browser, device } = deviceRoute({ pages, urls });
    const { record } = await retrieved(device, { limits: { maxResults: 10 } });
    expect(record.outcome).toBe('retrieved');
    expect(record.sources.map(source => source.url)).toEqual([EIFFEL]);
    expect(record.omitted.filter(item => item.reason === 'extraction-failed')).toHaveLength(urls.length - 1);
    // IP literals and local or single-label names are never requested.
    const requested = browser.requests.map(request => request.url);
    for (const local of ['http://192.168.1.1/admin', 'https://printer.local/x']) expect(requested).not.toContain(local);
    expect(record.costs.retrieval.extraction).toMatchObject({ attempted: 10, documents: 1, failed: 9, costMicroUsd: null });
    for (const [url, allowed] of [['https://example.org/a', true], ['ftp://example.org/a', false], ['https://user:pw@example.org/a', false],
      ['http://0x7f.1/', false], ['https://[::1]/x', false], ['https://[2001:4860::8888]/x', false], ['http://router/x', false],
      ['https://localhost:8080/', false], ['https://svc.internal/', false], ['https://x.home.arpa/', false],
      [`https://example.org/${'a'.repeat(PAGE_FETCH_POLICY.maxUrlCharacters)}`, false]]) expect(Boolean(devicePageUrl(url)), url).toBe(allowed);

    // Nothing readable: the record fails explicitly and invents no source.
    const blocked = deviceRoute({ urls: ['https://e.example.org/cors'] });
    expect((await retrieved(blocked.device)).record).toMatchObject({ outcome: 'failed', error: { code: 'extraction-failed' }, sources: [] });
  });
});

describe('authorization', () => {
  it('needs its Settings consent, and is not offered until the per-answer wording is approved; nothing is sent', async () => {
    expect(searchPermissionWording(DEVICE_SEARCH_PROVIDER)).toBeNull();
    expect(() => createSearchPermission({ id: 'g', networkId: 'mesh', threadId: 't', searchProvider: DEVICE_SEARCH_PROVIDER, query: QUESTION,
      recipients: [], wording: searchPermissionWording('brave'), grantedAt: AT })).toThrow('not the approved text');

    const { server, web, browser, device } = deviceRoute();
    web.setEnabled(false);
    expect(device.available()).toBe(false);
    await expect(device.provider.search(QUESTION, { maxResults: 2 }, null)).rejects.toThrow('Device search is off');
    web.setEnabled(true);
    expect(device.available()).toBe(true);

    // The session offers the Brave route and refuses the device route while its wording is unapproved.
    const model = LOCAL_DOPPLER_MODELS[0];
    const fixed = { provider: { id: 'test.brave', version: '1', searchProvider: 'brave', search: async () => [] }, permission: 'search-answer' };
    const session = createChatSession({ storage: memory(), service: createChatTestService(), retrieval: { routes: { [SEARCH_ROUTE]: fixed,
      [DEVICE_SEARCH_ROUTE]: { provider: device.provider, extractor: device.extractor, permission: 'search-answer', available: device.available } } } });
    cleanups.push(() => session.close());
    expect(session.searchPermissionRequest({ model, sharingScope: 'local' })).toMatchObject({ route: SEARCH_ROUTE, searchProvider: 'brave', recipients: [] });
    expect(() => session.searchPermissionRequest({ model, sharingScope: 'local', route: DEVICE_SEARCH_ROUTE })).toThrow('Search is not available');
    const thread = session.createThread({ model, sharingScope: 'local' });
    expect(() => session.send(thread, QUESTION, [], { search: { route: DEVICE_SEARCH_ROUTE, wording: searchPermissionWording('brave'), recipients: [] } }))
      .toThrow('Search is not available');

    // The workspace refuses the route without a grant for its own search service.
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store: { load: () => null, save() {} }, execute: vi.fn(),
      retrieval: { routes: { [DEVICE_SEARCH_ROUTE]: { provider: device.provider, extractor: device.extractor, permission: 'search-answer' } } } });
    cleanups.push(() => app.close());
    const other = app.createThread({ model: { id: 'm', name: 'M', identity: 'sha256:' + 'a'.repeat(64) } });
    expect(() => app.send(other, QUESTION, { retrieval: { route: DEVICE_SEARCH_ROUTE } })).toThrow('need the per-answer search permission');
    const brave = createSearchPermission({ id: 'g1', networkId: 'mesh', threadId: other, searchProvider: 'brave', query: QUESTION, recipients: [],
      wording: searchPermissionWording('brave'), grantedAt: AT });
    expect(() => app.send(other, QUESTION, { retrieval: { route: DEVICE_SEARCH_ROUTE }, searchPermission: brave })).toThrow('does not cover');
    expect(server.calls).toEqual([]);
    expect(browser.requests).toEqual([]);
  });
});
