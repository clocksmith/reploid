/** A minimal client for a remote MCP server over the Streamable HTTP transport: initialize once,
 * list tools and call one. Responses may be JSON or an event stream; the session id the server
 * assigns is sent back on later requests. It connects only when a method is called. */
const PROTOCOL_VERSION = '2025-06-18';
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** The JSON-RPC message answering `id` from a server-sent event stream. */
async function readEventStream(response, id) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const message = JSON.parse(data);
        if (message.id === id) return message;
      }
    }
  } finally { reader.releaseLock(); }
  throw new Error('The MCP server closed the stream without answering');
}

export function createMcpClient({ url, token = '', fetch = globalThis.fetch.bind(globalThis), clientInfo = { name: 'reploid', version: '1' } }) {
  assert(/^https?:\/\//.test(url), 'MCP server URL must start with http:// or https://');
  let sessionId = null, initialized = null, nextId = 1, protocolVersion = PROTOCOL_VERSION;
  async function post(body, signal) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocolVersion };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    sessionId = response.headers.get('mcp-session-id') || sessionId;
    return response;
  }
  async function request(method, params, signal) {
    const id = nextId++;
    const response = await post({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, signal);
    assert(response.ok, `The MCP server answered ${response.status} to ${method}`);
    const message = (response.headers.get('content-type') || '').includes('text/event-stream')
      ? await readEventStream(response, id) : await response.json();
    assert(!message.error, `MCP ${method} failed: ${message.error?.message}`);
    return message.result;
  }
  function initialize(signal) {
    initialized ??= (async () => {
      const result = await request('initialize', { protocolVersion, capabilities: {}, clientInfo }, signal);
      protocolVersion = result?.protocolVersion || protocolVersion;
      const ack = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
      assert(ack.ok || ack.status === 202, `The MCP server answered ${ack.status} to initialization`);
      return result;
    })().catch(error => { initialized = null; sessionId = null; throw error; });
    return initialized;
  }
  return Object.freeze({
    url,
    async listTools(signal) { await initialize(signal); return (await request('tools/list', {}, signal))?.tools || []; },
    async callTool(name, args, signal) {
      await initialize(signal);
      const result = await request('tools/call', { name, arguments: args }, signal);
      assert(!result?.isError, `The MCP tool ${name} reported an error: ${(result?.content || []).map(block => block.text).filter(Boolean).join(' ').slice(0, 200)}`);
      return result;
    }
  });
}
