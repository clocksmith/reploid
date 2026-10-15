/** Web search for conversations through a remote MCP server the person names in Settings.
 * Turning it on is the stored, revocable permission to send each question to that server; changing
 * the server turns it off again. When on, a send opts into retrieval (vendor/reploid/retrieval): the
 * server's search tool runs before the model and its results become the numbered sources. */
import { createMcpClient } from './mcp-client.js';

export const WEB_SEARCH_STORAGE_KEY = 'reploid.web-search:v1';
const QUERY_ARGUMENTS = ['query', 'q', 'search', 'search_query', 'searchQuery', 'term', 'text', 'input'];
const COUNT_ARGUMENTS = ['numResults', 'num_results', 'count', 'max_results', 'maxResults', 'limit', 'n'];
const EXCERPT_FIELDS = ['text', 'content', 'snippet', 'description', 'summary', 'highlights', 'excerpt', 'body'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const empty = Object.freeze({ enabled: false, url: '', token: '', tool: '', enabledAt: null });

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const host = url => { try { return new URL(url).host; } catch { return ''; } };
const clean = value => String(value).replace(/\s+/g, ' ').trim();

/** The tool to call and how to fill its arguments, from the server's tool list. */
export function chooseSearchTool(tools, preferred = '') {
  const queryArgument = tool => {
    const properties = tool?.inputSchema?.properties || {};
    return QUERY_ARGUMENTS.find(name => properties[name]?.type === 'string')
      || (tool?.inputSchema?.required || []).find(name => properties[name]?.type === 'string') || null;
  };
  const tool = preferred ? tools.find(item => item.name === preferred) : tools.find(item => /search/i.test(item.name) && queryArgument(item));
  if (!tool || !queryArgument(tool)) return null;
  const properties = tool.inputSchema?.properties || {};
  return { name: tool.name, query: queryArgument(tool),
    count: COUNT_ARGUMENTS.find(name => ['number', 'integer'].includes(properties[name]?.type)) || null };
}

/** Search results from a tool result: structured content, JSON text, "Title:/URL:" text blocks or markdown links. */
export function parseSearchResults(result) {
  const found = [];
  const take = item => {
    const url = [item.url, item.link, item.href, item.uri].find(value => typeof value === 'string' && /^https?:\/\//.test(value));
    const excerpt = EXCERPT_FIELDS.map(field => Array.isArray(item[field]) ? item[field].join(' ') : item[field])
      .find(value => typeof value === 'string' && value.trim());
    if (url && excerpt) found.push({ url, title: clean(item.title || item.name || url).slice(0, 1000), excerpt: clean(excerpt) });
  };
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (['url', 'link', 'href'].some(key => typeof value[key] === 'string')) take(value);
      else Object.values(value).forEach(visit);
    }
  };
  if (result?.structuredContent) visit(result.structuredContent);
  for (const block of result?.content || []) {
    if (block?.type === 'resource' && block.resource) take({ url: block.resource.uri, title: block.resource.name, text: block.resource.text });
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try { visit(JSON.parse(block.text)); continue; } catch { /* not JSON: read it as text */ }
    found.push(...parseTextResults(block.text));
  }
  const seen = new Set();
  return found.filter(item => !seen.has(item.url) && seen.add(item.url));
}

function parseTextResults(text) {
  const records = []; let current = null;
  for (const line of text.split(/\r?\n/)) {
    const field = line.match(/^\s*(?:[-*]\s*)?([A-Za-z ]{2,20}):\s*(.*)$/);
    const key = field?.[1].trim().toLowerCase();
    if (key === 'title') { current = { title: field[2], url: '', text: [] }; records.push(current); }
    else if (current && ['url', 'link', 'source'].includes(key)) current.url = field[2].trim();
    else if (current && field && EXCERPT_FIELDS.includes(key)) current.text.push(field[2]);
    else if (current && !field && line.trim() && !/^-{3,}$/.test(line.trim())) current.text.push(line);
  }
  const parsed = records.filter(record => /^https?:\/\//.test(record.url) && record.text.join(' ').trim())
    .map(record => ({ url: record.url, title: clean(record.title || record.url).slice(0, 1000), excerpt: clean(record.text.join(' ')) }));
  if (parsed.length) return parsed;
  // Markdown links with the text that follows each one.
  const links = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)];
  return links.map((link, index) => ({ url: link[2], title: clean(link[1]).slice(0, 1000),
    excerpt: clean(text.slice(link.index + link[0].length, links[index + 1]?.index ?? text.length)) || clean(link[1]) }));
}

export function createWebSearch({ storage = globalThis.localStorage, fetch, now = Date.now } = {}) {
  const read = () => { try { return { ...empty, ...JSON.parse(storage?.getItem(WEB_SEARCH_STORAGE_KEY) || '{}') }; } catch { return { ...empty }; } };
  let settings = read(), client = null, status = { state: 'idle', message: '' };
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(snapshot()); };
  const snapshot = () => ({ ...settings, token: settings.token ? '••••' : '', hasToken: Boolean(settings.token), recipient: host(settings.url), status: { ...status } });
  const connection = () => {
    if (!client || client.url !== settings.url || client.token !== settings.token) {
      client = { url: settings.url, token: settings.token, mcp: createMcpClient({ url: settings.url, token: settings.token, ...(fetch ? { fetch } : {}) }) };
    }
    return client.mcp;
  };
  const save = next => {
    settings = { ...empty, ...next };
    try { storage?.setItem(WEB_SEARCH_STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage is optional */ }
    notify();
  };
  async function resolveTool(signal) {
    const choice = chooseSearchTool(await connection().listTools(signal), settings.tool);
    assert(choice, settings.tool ? `The server has no tool named ${settings.tool} with a text query` : 'The server offers no search tool with a text query');
    return choice;
  }

  const provider = Object.freeze({
    get id() { return `mcp-web-search:${host(settings.url) || 'unset'}`; },
    // The query leaves this device for the person's own search server.
    version: '1', supply: 'device',
    async search(query, limits, signal) {
      assert(settings.enabled && settings.url, 'Web search is off');
      const tool = await resolveTool(signal);
      const args = { [tool.query]: query, ...(tool.count ? { [tool.count]: limits.maxResults } : {}) };
      const results = parseSearchResults(await connection().callTool(tool.name, args, signal)).slice(0, limits.maxResults * 2);
      const retrievedAt = now();
      return Promise.all(results.map(async result => ({ sourceId: `web-${(await sha256(result.url)).slice(7, 23)}`,
        url: result.url, title: result.title, excerpt: result.excerpt.slice(0, limits.maxSourceCharacters * 2),
        retrievedAt, contentHash: await sha256(result.excerpt) })));
    }
  });

  return Object.freeze({
    provider,
    state: snapshot,
    enabled: () => settings.enabled && Boolean(settings.url),
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    /** A new server or credential turns search off: permission names the server it was given for. */
    configure({ url = settings.url, token = settings.token, tool = settings.tool } = {}) {
      const trimmed = url.trim();
      assert(!trimmed || /^https:\/\//.test(trimmed) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(trimmed),
        'Use an https:// MCP server URL (http:// only for localhost)');
      const changed = trimmed !== settings.url || token !== settings.token;
      status = changed ? { state: 'idle', message: '' } : status;
      save({ ...settings, url: trimmed, token, tool: tool.trim(), ...(changed ? { enabled: false, enabledAt: null } : {}) });
    },
    setEnabled(enabled) {
      assert(!enabled || settings.url, 'Add an MCP server URL first');
      save({ ...settings, enabled: Boolean(enabled), enabledAt: enabled ? now() : null });
    },
    /** Connects, lists tools and reports which one search would call. */
    async check(signal) {
      status = { state: 'checking', message: `Connecting to ${host(settings.url)}` }; notify();
      try {
        const tool = await resolveTool(signal);
        status = { state: 'ready', message: `Search uses ${tool.name} on ${host(settings.url)}` };
      } catch (error) { status = { state: 'failed', message: error.message }; }
      notify();
      return status;
    }
  });
}
