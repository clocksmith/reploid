// Web search through a remote MCP server: the Streamable HTTP exchange, tool choice, result parsing and
// the permission rules, with results run through the library's retrieval. The server here is a fake.
import { describe, expect, it } from 'vitest';
import { createWebSearch, parseSearchResults, chooseSearchTool } from '../../self/host/web-search.js';
import { createRetrieval } from '../../packages/reploid/src/retrieval/index.js';

const SEARCH_TOOL = { name: 'web_search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, numResults: { type: 'number' } }, required: ['query'] } };
const EXA_TEXT = 'Title: Doppler WebGPU\nURL: https://example.org/doppler\nText: Doppler runs models in the browser with WebGPU.\n\n'
  + 'Title: Reploid\nURL: https://example.org/reploid\nText: Reploid shares capacity between browsers.';

/** A fake MCP server: answers initialize as an event stream, everything else as JSON, and requires its session id. */
function fakeServer({ text = EXA_TEXT } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, session: init.headers['Mcp-Session-Id'] || null, auth: init.headers.Authorization || null, params: body.params });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method !== 'initialize' && init.headers['Mcp-Session-Id'] !== 'session-1') return new Response('missing session', { status: 400 });
    const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } }
      : body.method === 'tools/list' ? { tools: [{ name: 'fetch_page', inputSchema: { properties: { url: { type: 'string' } } } }, SEARCH_TOOL] }
        : { content: [{ type: 'text', text }] };
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    return body.method === 'initialize'
      ? new Response(`event: message\ndata: ${message}\n\n`, { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1' } })
      : new Response(message, { headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}
const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

describe('MCP web search', () => {
  it('searches through the MCP session and yields sources the retrieval library accepts', async () => {
    const server = fakeServer();
    const search = createWebSearch({ storage: memory(), fetch: server.fetch, now: () => 1000 });
    search.configure({ url: 'https://search.example.net/mcp', token: 'secret' });
    search.setEnabled(true);
    const retrieval = createRetrieval({ provider: search.provider, now: () => 1000 });
    const record = await retrieval.retrieve(retrieval.pending(retrieval.request({}, 'How does Doppler run models?'), 1000));
    expect(record.outcome).toBe('retrieved');
    expect(record.provider.id).toBe('mcp-web-search:search.example.net');
    expect(record.sources.map(source => source.url)).toEqual(['https://example.org/doppler', 'https://example.org/reploid']);
    expect(server.calls.map(call => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    expect(server.calls.slice(1).every(call => call.session === 'session-1' && call.auth === 'Bearer secret')).toBe(true);
    expect(server.calls.at(-1).params).toEqual({ name: 'web_search', arguments: { query: 'How does Doppler run models?', numResults: 5 } });
  });

  it('sends nothing while off, and a new server turns it off', async () => {
    const server = fakeServer();
    const search = createWebSearch({ storage: memory(), fetch: server.fetch });
    expect(() => search.setEnabled(true)).toThrow('Add an MCP server URL first');
    search.configure({ url: 'https://one.example/mcp' }); search.setEnabled(true);
    search.configure({ url: 'https://two.example/mcp' });
    expect(search.enabled()).toBe(false);
    await expect(search.provider.search('q', { maxResults: 3, maxSourceCharacters: 1200 })).rejects.toThrow('Web search is off');
    expect(server.calls).toEqual([]);
    expect(() => search.configure({ url: 'http://search.example/mcp' })).toThrow(/https/);
  });

  it('reads JSON result lists and markdown links, and picks the search tool', () => {
    expect(parseSearchResults({ content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'A', url: 'https://a.example', snippet: 'Alpha.' }] }) }] }))
      .toEqual([{ url: 'https://a.example', title: 'A', excerpt: 'Alpha.' }]);
    expect(parseSearchResults({ content: [{ type: 'text', text: '1. [Beta page](https://b.example) Beta text.' }] }))
      .toEqual([{ url: 'https://b.example', title: 'Beta page', excerpt: 'Beta text.' }]);
    expect(chooseSearchTool([{ name: 'fetch_page', inputSchema: {} }, SEARCH_TOOL])).toEqual({ name: 'web_search', query: 'query', count: 'numResults' });
  });
});
