// @vitest-environment node
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createExternalBrainRouter } from '../../server/external-brain.js';

const fixtures = [];
const requestSchema = 'reploid.external-brain.request/v1';
const responseSchema = 'reploid.external-brain.response/v1';
const readFileTool = {
  type: 'function',
  function: {
    name: 'ReadFile',
    description: 'Read one VFS file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }
};

const generation = (requestId = 'req_123_abc', overrides = {}) => ({
  schema: requestSchema,
  requestId,
  sessionId: 'session_123',
  modelId: 'dot-reasoner',
  messages: [{ role: 'user', content: 'Read /notes.txt' }],
  tools: [readFileTool],
  ...overrides
});

const decision = (requestId = 'req_123_abc', overrides = {}) => ({
  schema: responseSchema,
  requestId,
  sessionId: 'session_123',
  content: 'I will read the file.',
  ...overrides
});

async function start(options = {}, { remoteAddress } = {}) {
  const mailbox = createExternalBrainRouter({ timeoutMs: 2_000, ...options });
  const app = express();
  app.set('trust proxy', true);
  if (remoteAddress) {
    // The HTTP transport remains real. Only the socket peer is injected so this
    // negative boundary is reproducible on hosts without non-loopback interfaces.
    app.use((req, res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress });
      next();
    });
  }
  app.use('/api/external-brain', mailbox.router);
  // The mailbox must enforce its own smaller limit before an existing parser.
  app.use(express.json({ limit: '10mb' }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fixture = { base, server, mailbox };
  fixtures.push(fixture);
  return fixture;
}

function begin(base, path, { method = 'GET', body, headers = {}, chunked = false, deferEnd = false } = {}) {
  const serialized = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const sentHeaders = { 'X-Reploid-External-Brain': '1' };
  if (serialized !== undefined) {
    sentHeaders['Content-Type'] = 'application/json';
    if (!chunked) sentHeaders['Content-Length'] = Buffer.byteLength(serialized);
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete sentHeaders[key];
    else sentHeaders[key] = value;
  }
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(`${base}/api/external-brain${path}`, { method, headers: sentHeaders, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) });
        } catch (error) {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${text}`, { cause: error }));
        }
      });
    });
    request.on('error', reject);
    if (serialized !== undefined) request.write(serialized);
    if (!deferEnd) request.end();
  });
  return { request, response };
}

const send = (base, path, options) => begin(base, path, options).response;
const generate = (base, body = generation()) => begin(base, '/generate', { method: 'POST', body });
const respond = (base, body = decision(), pathId = body.requestId) => send(base, `/requests/${pathId}/respond`, { method: 'POST', body });
const cancel = (base, requestId = 'req_123_abc', sessionId = 'session_123') => send(base, `/requests/${requestId}`, {
  method: 'DELETE', body: { sessionId }
});

async function waitFor(base, predicate) {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const response = await send(base, '/requests');
    if (predicate(response.body)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Mailbox did not reach the expected state');
}

async function rawRequest(base, headers) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    let text = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => { text += chunk.toString(); });
    socket.on('end', () => resolve(text));
    socket.on('connect', () => socket.end([
      'GET /api/external-brain/status HTTP/1.0',
      ...headers,
      'Connection: close',
      '',
      ''
    ].join('\r\n')));
  });
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(({ server, mailbox }) => {
    mailbox.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }));
});

describe('external reasoning mailbox lifecycle', () => {
  it('exposes local readiness and holds generation until a correlated native-tool decision arrives', async () => {
    const { base } = await start();
    const status = await send(base, '/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: true, provider: 'external', pending: 0 });
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.headers['access-control-allow-origin']).toBeUndefined();

    const held = generate(base);
    let finished = false;
    held.response.then(() => { finished = true; });
    const listing = await waitFor(base, (state) => state.pending.length === 1);
    expect(finished).toBe(false);
    expect(listing.pending[0]).toMatchObject(generation());
    expect(listing.pending[0].deadlineAt).toBeGreaterThan(listing.pending[0].createdAt);
    expect(listing.settled).toEqual([]);

    const toolCalls = [{ id: 'call_1', name: 'ReadFile', args: { path: '/notes.txt' } }];
    expect((await respond(base, decision(undefined, { toolCalls }))).body).toEqual({
      requestId: 'req_123_abc', sessionId: 'session_123', status: 'completed'
    });
    expect(await held.response).toMatchObject({ status: 200, body: {
      requestId: 'req_123_abc', sessionId: 'session_123', model: 'dot-reasoner',
      provider: 'external', content: 'I will read the file.', raw: 'I will read the file.', toolCalls
    } });
    const settled = (await send(base, '/requests')).body;
    expect(settled.pending).toEqual([]);
    expect(settled.settled[0]).toMatchObject({ requestId: 'req_123_abc', status: 'completed' });
    expect(Object.keys(settled.settled[0]).sort()).toEqual([
      'createdAt', 'modelId', 'requestId', 'sessionId', 'settledAt', 'status'
    ]);
  });

  it('returns final text without native calls and supplies identities for calls that omit one', async () => {
    const { base } = await start();
    const text = generate(base, generation('text', { tools: [] }));
    await waitFor(base, (state) => state.pending.length === 1);
    await respond(base, decision('text', { content: 'Done.' }));
    expect((await text.response).body).toMatchObject({ content: 'Done.', raw: 'Done.', toolCalls: null });
    const tool = generate(base, generation('tool'));
    await waitFor(base, (state) => state.pending.length === 1);
    await respond(base, decision('tool', { content: '', toolCalls: [{ name: 'ReadFile', args: {} }] }));
    const result = (await tool.response).body;
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ id: expect.any(String), name: 'ReadFile', args: {} });
    expect(result.toolCalls[0].id.length).toBeGreaterThan(0);
  });

  it('rejects duplicate pending IDs, reused settled IDs and late decisions', async () => {
    const { base } = await start();
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect((await generate(base, generation(undefined, { sessionId: 'other_session' })).response).body.code).toBe('request_id_reused');
    await respond(base);
    expect((await held.response).status).toBe(200);
    expect(await respond(base)).toMatchObject({ status: 409, body: { code: 'request_settled', status: 'completed' } });
    expect(await generate(base).response).toMatchObject({ status: 409, body: { code: 'request_id_reused' } });
  });

  it('keeps the waiter intact after mismatched identities and unadvertised native tools', async () => {
    const { base } = await start();
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect(await respond(base, decision('other'), 'req_123_abc')).toMatchObject({ status: 400, body: { code: 'request_mismatch' } });
    expect(await respond(base, decision(undefined, { sessionId: 'other_session' }))).toMatchObject({ status: 409, body: { code: 'session_mismatch' } });
    expect(await respond(base, decision('missing'))).toMatchObject({ status: 404, body: { code: 'request_not_found' } });
    expect(await respond(base, decision(undefined, { toolCalls: [{ name: 'RunShell', args: {} }] }))).toMatchObject({ status: 400, body: { code: 'unknown_tool' } });
    expect((await send(base, '/requests')).body.pending).toHaveLength(1);
    await respond(base);
    expect((await held.response).status).toBe(200);
  });

  it('cancels only a matching session and explicitly fails the held browser response', async () => {
    const { base } = await start();
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect((await cancel(base, 'req_123_abc', 'wrong')).body.code).toBe('session_mismatch');
    expect((await send(base, '/requests/req_123_abc', { method: 'DELETE', body: {} })).status).toBe(400);
    expect(await cancel(base)).toMatchObject({ status: 200, body: { status: 'cancelled' } });
    expect(await held.response).toMatchObject({ status: 409, body: {
      code: 'external_brain_cancelled', requestId: 'req_123_abc', sessionId: 'session_123'
    } });
    expect((await respond(base)).body).toMatchObject({ code: 'request_settled', status: 'cancelled' });
    expect((await cancel(base)).body.code).toBe('request_settled');
    expect((await cancel(base, 'missing')).status).toBe(404);
  });

  it('settles disconnected browser sockets and rejects their stale decisions', async () => {
    const { base } = await start();
    const held = generate(base);
    const disconnected = held.response.catch((error) => error);
    await waitFor(base, (state) => state.pending.length === 1);
    held.request.destroy();
    await disconnected;
    const state = await waitFor(base, (value) => value.settled[0]?.status === 'disconnected');
    expect(state.pending).toEqual([]);
    expect((await respond(base)).body).toMatchObject({ code: 'request_settled', status: 'disconnected' });
  });

  it('times out explicitly and does not accept a late decision', async () => {
    const { base } = await start({ timeoutMs: 40 });
    expect(await generate(base).response).toMatchObject({ status: 504, body: {
      code: 'external_brain_timeout', requestId: 'req_123_abc', sessionId: 'session_123'
    } });
    expect((await respond(base)).body).toMatchObject({ code: 'request_settled', status: 'timed_out' });
    expect((await send(base, '/requests')).body.pending).toEqual([]);
  });

  it('fails all held responses on close and withdraws readiness', async () => {
    const { base, mailbox } = await start();
    const first = generate(base, generation('first'));
    const second = generate(base, generation('second'));
    await waitFor(base, (state) => state.pending.length === 2);
    mailbox.close();
    mailbox.close();
    for (const held of [first, second]) {
      expect(await held.response).toMatchObject({ status: 503, body: { code: 'external_brain_closed' } });
    }
    expect((await send(base, '/status')).status).toBe(503);
    expect((await respond(base, decision('first'))).status).toBe(503);
  });

  it('does not admit a request whose body finishes arriving after close', async () => {
    const { base, server, mailbox } = await start();
    const ingress = new Promise((resolve) => server.once('request', resolve));
    const body = JSON.stringify(generation());
    const held = begin(base, '/generate', {
      method: 'POST', body: body.slice(0, 1), deferEnd: true,
      headers: { 'Content-Length': Buffer.byteLength(body) }
    });
    await ingress;
    mailbox.close();
    held.request.end(body.slice(1));
    expect(await held.response).toMatchObject({ status: 503, body: { code: 'external_brain_closed' } });
  });

  it('bounds pending capacity and releases it only after settlement', async () => {
    const { base } = await start({ maxPending: 1 });
    const first = generate(base, generation('first'));
    await waitFor(base, (state) => state.pending.length === 1);
    expect(await generate(base, generation('second')).response).toMatchObject({ status: 429, body: { code: 'mailbox_full' } });
    await cancel(base, 'first');
    await first.response;
    const second = generate(base, generation('second'));
    await waitFor(base, (state) => state.pending[0]?.requestId === 'second');
    await respond(base, decision('second'));
    expect((await second.response).status).toBe(200);
  });

  it('retains bounded summaries without settled context or decisions', async () => {
    const { base } = await start({ maxSettled: 2 });
    for (const id of ['first', 'second', 'third']) {
      const held = generate(base, generation(id));
      await waitFor(base, (state) => state.pending.length === 1);
      await respond(base, decision(id));
      await held.response;
    }
    const state = (await send(base, '/requests')).body;
    expect(state.pending).toEqual([]);
    expect(state.settled.map((entry) => entry.requestId)).toEqual(['second', 'third']);
    for (const summary of state.settled) {
      expect(Object.keys(summary).sort()).toEqual(['createdAt', 'modelId', 'requestId', 'sessionId', 'settledAt', 'status']);
    }
    expect((await respond(base, decision('first'))).status).toBe(404);
    expect((await respond(base, decision('second'))).status).toBe(409);
  });
});

describe('external reasoning mailbox protocol admission', () => {
  it.each([
    ['wrong schema', { schema: 'wrong' }],
    ['missing request identity', { requestId: undefined }],
    ['malformed request identity', { requestId: 'a/b' }],
    ['oversized identity', { sessionId: 'x'.repeat(129) }],
    ['malformed model identity', { modelId: 'model\nother' }],
    ['empty messages', { messages: [] }],
    ['oversized message list', { messages: Array.from({ length: 257 }, () => ({ role: 'user', content: '' })) }],
    ['invalid message role', { messages: [{ role: 'admin', content: '' }] }],
    ['invalid message content', { messages: [{ role: 'user', content: 4 }] }],
    ['missing tools', { tools: undefined }],
    ['invalid tool type', { tools: [{ type: 'computer', function: { name: 'ReadFile' } }] }],
    ['invalid tool schema', { tools: [{ type: 'function', function: { name: 'ReadFile', parameters: [] } }] }],
    ['duplicate tool names', { tools: [readFileTool, readFileTool] }]
  ])('rejects %s before retaining a request', async (label, overrides) => {
    const { base } = await start();
    expect(await generate(base, generation(undefined, overrides)).response).toMatchObject({ status: 400, body: { code: 'invalid_request' } });
    expect((await send(base, '/requests')).body).toEqual({ pending: [], settled: [] });
  });

  it.each([
    ['wrong schema', { schema: 'wrong' }],
    ['malformed identity', { requestId: 'bad id' }],
    ['missing content', { content: undefined }],
    ['non-string content', { content: null }],
    ['non-array calls', { toolCalls: {} }],
    ['missing args', { toolCalls: [{ name: 'ReadFile' }] }],
    ['array args', { toolCalls: [{ name: 'ReadFile', args: [] }] }],
    ['serialized args', { toolCalls: [{ name: 'ReadFile', args: '{}' }] }],
    ['duplicate call IDs', { toolCalls: [{ id: 'same', name: 'ReadFile', args: {} }, { id: 'same', name: 'ReadFile', args: {} }] }]
  ])('rejects response %s without settling a valid request', async (label, overrides) => {
    const { base } = await start();
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect(await respond(base, decision(undefined, overrides), 'req_123_abc')).toMatchObject({ status: 400, body: { code: 'invalid_response' } });
    expect((await send(base, '/requests')).body.pending).toHaveLength(1);
    await cancel(base);
    await held.response;
  });

  it('rejects invalid JSON, media types and compressed bodies explicitly', async () => {
    const { base } = await start();
    expect(await send(base, '/generate', { method: 'POST', body: '{' })).toMatchObject({ status: 400, body: { code: 'invalid_json' } });
    expect((await send(base, '/generate', { method: 'POST', body: '[]' })).status).toBe(400);
    expect((await send(base, '/generate', { method: 'POST', body: '{}' , headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await send(base, '/generate', { method: 'POST', body: '{}', headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415);
  });

  it.each([false, true])('enforces a byte limit on %s chunked requests before the general parser', async (chunked) => {
    const { base } = await start();
    const body = generation(undefined, { messages: [{ role: 'user', content: 'é'.repeat(132_000) }] });
    expect(await send(base, '/generate', { method: 'POST', body, chunked })).toMatchObject({ status: 413, body: { code: 'body_too_large' } });
    expect((await send(base, '/requests')).body).toEqual({ pending: [], settled: [] });
  });

  it('applies the same body limit to decisions and leaves a valid waiter untouched', async () => {
    const { base } = await start();
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect((await respond(base, decision(undefined, { content: 'x'.repeat(262_144) }))).status).toBe(413);
    await respond(base);
    expect((await held.response).status).toBe(200);
  });

  it('rejects deeply nested context and decisions before retaining or serializing them', async () => {
    const { base } = await start();
    let nested = {};
    for (let i = 0; i < 70; i += 1) nested = { child: nested };
    expect((await generate(base, generation(undefined, {
      tools: [{ type: 'function', function: { name: 'ReadFile', parameters: nested } }]
    })).response).status).toBe(400);
    const held = generate(base);
    await waitFor(base, (state) => state.pending.length === 1);
    expect((await respond(base, decision(undefined, { toolCalls: [{ name: 'ReadFile', args: nested }] }))).status).toBe(400);
    await respond(base);
    expect((await held.response).status).toBe(200);
  });

  it.each([{ maxPending: 17 }, { maxPending: 0 }, { maxSettled: 65 }, { timeoutMs: 0 }, { timeoutMs: Infinity }])(
    'refuses configurations that widen or remove hard resource bounds: %j', (options) => {
      expect(() => createExternalBrainRouter(options)).toThrow(RangeError);
    }
  );
});

describe('external reasoning mailbox local boundary', () => {
  it.each(['example.com', 'localhost.evil', '127.0.0.1.evil', '127.1', '2130706433', '127.0.0.1:99999', 'user@localhost', 'localhost/']) (
    'rejects untrusted or ambiguous Host %s', async (host) => {
      const { base } = await start();
      expect(await send(base, '/status', { headers: { Host: host, 'X-Forwarded-Host': 'localhost' } })).toMatchObject({ status: 403, body: { code: 'local_only' } });
    }
  );

  it('rejects missing or duplicate boundary headers on actual HTTP sockets', async () => {
    const { base } = await start();
    const host = new URL(base).host;
    for (const headers of [
      ['X-Reploid-External-Brain: 1'],
      [`Host: ${host}`, 'Host: attacker.example', 'X-Reploid-External-Brain: 1'],
      [`Host: ${host}`, 'X-Reploid-External-Brain: 1', `Origin: ${base}`, `Origin: ${base}`],
      [`Host: ${host}`, 'X-Reploid-External-Brain: 1', 'X-Reploid-External-Brain: 1']
    ]) {
      expect(await rawRequest(base, headers)).toMatch(/^HTTP\/1\.1 403 /);
    }
  });

  it('requires absent or exactly matching Origin, never another loopback origin', async () => {
    const { base } = await start();
    expect((await send(base, '/status', { headers: { Origin: base } })).status).toBe(200);
    const host = new URL(base);
    for (const origin of [
      'null', '', 'https://attacker.example', `http://localhost:${host.port}`,
      'http://127.0.0.1:1', base.replace('http:', 'https:'), `${base}/`, `${base} attacker.example`
    ]) {
      expect(await send(base, '/status', { headers: { Origin: origin, 'X-Forwarded-Proto': 'https' } })).toMatchObject({ status: 403, body: { code: 'origin_denied' } });
    }
  });

  it('requires the explicit bridge header and does not grant cross-origin preflight', async () => {
    const { base } = await start();
    for (const value of [null, '0', 'true', '1, 1']) {
      expect(await send(base, '/status', { headers: { 'X-Reploid-External-Brain': value } })).toMatchObject({ status: 403, body: { code: 'bridge_header_required' } });
    }
    const preflight = await send(base, '/generate', { method: 'OPTIONS', headers: {
      Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'X-Reploid-External-Brain', 'X-Reploid-External-Brain': null
    } });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-headers']).toBeUndefined();
  });

  it.each(['203.0.113.10', '::ffff:192.0.2.10', '2001:db8::1'])(
    'denies socket peer %s even when Express trusts forged forwarded identity', async (remoteAddress) => {
      const { base } = await start({}, { remoteAddress });
      expect(await send(base, '/requests', { headers: {
        'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost', Forwarded: 'for=127.0.0.1;host=localhost'
      } })).toMatchObject({ status: 403, body: { code: 'local_only' } });
    }
  );

  it.each(['::1', '::ffff:127.0.0.1'])(
    'accepts loopback socket representation %s without trusting forwarded headers', async (remoteAddress) => {
      const { base } = await start({}, { remoteAddress });
      expect((await send(base, '/status', { headers: { 'X-Forwarded-For': '203.0.113.10' } })).status).toBe(200);
    }
  );
});
