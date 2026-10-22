// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZERO_GEMINI_MODEL, ZERO_GEMINI_FUNCTION_PATH, ZERO_GEMINI_AGENT_THROTTLE } from '../../self/config/zero-inference.js';

const location = { hostname: 'replo.id', protocol: 'https:', origin: 'https://replo.id' };
const config = { provider: 'gemini', id: ZERO_GEMINI_MODEL };
const messages = [{ role: 'user', content: 'Read the note' }];
const tools = [{ type: 'function', function: { name: 'Read', description: 'Read a VFS file',
  parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } }];
const json = (value, init) => new Response(JSON.stringify(value), init);
const reply = (overrides = {}) => json({ provider: 'gemini', model: ZERO_GEMINI_MODEL,
  content: JSON.stringify({ content: 'Done', toolCalls: [] }), ...overrides });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let createZeroProvider, sdk, fetch, generate;

// Only external I/O is replaced. The real zero-inference auth bootstrap, identity
// binding, token acquisition and named getZeroAccessHeaders import run in each test.
const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('location', location);
  sdk = { getIdToken: vi.fn(async () => 'firebase-id-token'), getToken: vi.fn(async () => ({ token: 'app-check-token' })) };
  vi.stubGlobal('__zeroTestSdk', sdk);
  vi.stubGlobal('REPLOID_FIREBASE_APP_MODULE_URL', moduleUrl('export const getApps=()=>[]; export const initializeApp=(options)=>({options});'));
  vi.stubGlobal('REPLOID_FIREBASE_AUTH_MODULE_URL', moduleUrl('export const getAuth=()=>({currentUser:{getIdToken:()=>globalThis.__zeroTestSdk.getIdToken()}});'));
  vi.stubGlobal('REPLOID_FIREBASE_APP_CHECK_MODULE_URL', moduleUrl('export class ReCaptchaV3Provider {} export const initializeAppCheck=()=>({}); export const getToken=()=>globalThis.__zeroTestSdk.getToken();'));
  generate = vi.fn(async () => reply());
  fetch = vi.fn(async (url, options) => {
    if (url === '/__/firebase/init.json') return json({ projectId: 'fixture-project', appId: 'fixture-app' });
    if (url === '/config/zero-access.json') return json({ schema: 'reploid.zero-access/v1',
      projectId: 'fixture-project', appId: 'fixture-app', appCheck: { provider: 'recaptcha-v3', siteKey: 'fixture-site-key' } });
    return generate(url, options);
  });
  vi.stubGlobal('fetch', fetch);
  ({ createZeroProvider } = await import('../../self/zero/provider.js'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const chat = (provider = createZeroProvider(), settings = config, input = messages, control) => provider.chat(input, settings, 'req_one', control);

describe('compact Zero managed provider', () => {
  it('uses the existing Firebase Auth/App Check boundary and exact same-origin route without serializing credentials', async () => {
    const result = await chat(undefined, { ...config, tools, apiKey: 'private-api-key', headers: { Authorization: 'wrong-credential' } });
    expect(result).toEqual({ content: 'Done', toolCalls: [], provider: 'gemini', model: ZERO_GEMINI_MODEL, requestedModel: ZERO_GEMINI_MODEL });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/__/firebase/init.json', '/config/zero-access.json', ZERO_GEMINI_FUNCTION_PATH]);
    const [url, options] = generate.mock.calls[0];
    expect(url).toBe('/zero/gemini');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store' });
    expect(options.headers.get('Authorization')).toBe('Bearer firebase-id-token');
    expect(options.headers.get('X-Firebase-AppCheck')).toBe('app-check-token');
    expect(JSON.parse(options.body)).toMatchObject({ provider: 'gemini', model: ZERO_GEMINI_MODEL });
    expect(JSON.parse(options.body).messages[0].content).toContain(JSON.stringify(tools));
    expect(JSON.stringify({ body: JSON.parse(options.body), result })).not.toMatch(/private-api-key|wrong-credential|firebase-id-token|app-check-token/);
  });

  it.each(['id-token', 'app-check'])('requires %s before sending inference', async missing => {
    if (missing === 'id-token') sdk.getIdToken.mockResolvedValue('');
    else sdk.getToken.mockResolvedValue({ token: '' });
    await expect(chat()).rejects.toThrow('credentials');
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves auth failure and mismatched application configuration without fallback', async () => {
    fetch.mockImplementation(async () => json({ projectId: 'fixture-project', appId: 'different-app' }));
    await expect(chat()).rejects.toThrow('does not match');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'openai' }, { provider: 'automatic' }, { model: 'another-model' }, { id: 'another-model' },
    { endpoint: 'https://attacker.example/zero/gemini' }, { url: '//attacker.example/zero/gemini' },
    { endpoint: '/zero/gemini?apiKey=secret' }, { endpoint: '/api/chat' }, { serverType: 'direct' },
    { allowedFallbackModels: ['another-model'] }
  ])('rejects arbitrary selection before auth: %j', async overrides => {
    await expect(chat(undefined, { ...config, ...overrides })).rejects.toThrow('canonical managed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts only the canonical absolute endpoint but still sends a fixed relative URL', async () => {
    await chat(undefined, { ...config, endpoint: location.origin + ZERO_GEMINI_FUNCTION_PATH });
    expect(generate.mock.calls[0][0]).toBe(ZERO_GEMINI_FUNCTION_PATH);
  });

  it('serializes native assistant calls and tool replies with role, name and call identity intact', async () => {
    const call = { id: 'read_1', name: 'Read', args: { path: '/notes.txt' } };
    const input = [messages[0], { role: 'assistant', content: 'Checking', toolCalls: [call] },
      { role: 'tool', name: 'Read', tool_call_id: 'read_1', content: 'Untrusted file content' }];
    generate.mockResolvedValue(reply({ content: JSON.stringify({ content: 'Checking again', toolCalls: [call] }) }));
    const result = await chat(undefined, { ...config, tools }, input);
    const wire = JSON.parse(generate.mock.calls[0][1].body).messages;
    expect(wire.slice(1).map(message => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(JSON.parse(wire[2].content)).toEqual(input[1]);
    expect(JSON.parse(wire[3].content)).toEqual(input[2]);
    expect(result.toolCalls).toEqual([call]);
  });

  it('accepts a fully fenced JSON envelope but never extracts code or calls from prose', async () => {
    generate.mockResolvedValue(reply({ content: '```json\n{"content":"OK","toolCalls":[]}\n```' }));
    await expect(chat()).resolves.toMatchObject({ content: 'OK', toolCalls: [] });
  });

  it.each([
    'I ran Read successfully', '{"content":"ok","toolCalls":[]} trailing text',
    'Before\n```json\n{"content":"ok","toolCalls":[]}\n```', '{"content":"ok"}',
    '{"content":"ok","toolCalls":[],"eval":"alert(1)"}',
    '{"content":"ok","toolCalls":[{"id":"1","name":"Read","args":"{}"}]}',
    '{"content":"ok","toolCalls":[{"id":"1","name":"Read","args":{},"error":"invalid"}]}',
    '{"content":"ok","toolCalls":[{"id":"1","name":"Read","args":{}},{"id":"1","name":"Read","args":{}}]}'
  ])('rejects malformed or ambiguous model envelopes: %s', async content => {
    generate.mockResolvedValue(reply({ content }));
    await expect(chat()).rejects.toThrow(/envelope/);
  });

  it.each([{ model: 'replacement' }, { requestedModel: 'replacement' }, { provider: 'openai' }, { content: null }])(
    'rejects changed response identity: %j', async overrides => {
      generate.mockResolvedValue(reply(overrides));
      await expect(chat()).rejects.toThrow('response identity');
    });

  it.each([401, 403, 404, 429, 503])('retains HTTP %i for malformed error bodies', async status => {
    generate.mockResolvedValue(new Response('<html>Unavailable</html>', { status }));
    await expect(chat()).rejects.toMatchObject({ status, message: `Managed Zero unavailable (${status})` });
  });

  it('retains provider error and retry delay without automatic retry or model fallback', async () => {
    generate.mockResolvedValue(json({ error: 'Quota exhausted', retryAfterMs: 15000 }, { status: 429 }));
    await expect(chat()).rejects.toMatchObject({ status: 429, message: 'Quota exhausted', retryAfterMs: 15000 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized latest request with a recoverable context error before acquiring credentials', async () => {
    await expect(chat(undefined, config, [{ role: 'user', content: 'x'.repeat(120001) }])).rejects.toMatchObject({ code: 'context_limit', message: expect.stringContaining('latest user exchange') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps all system instructions and the most recent whole exchanges without mutating full history', async () => {
    const history = [{ role: 'system', content: 'Preserve work' }, ...Array.from({ length: 40 }, (_, i) => [
      { role: 'user', content: `Question ${i}` }, { role: 'assistant', content: `Answer ${i}` }
    ]).flat(), { role: 'system', content: 'Keep attribution' }, { role: 'user', content: 'Current question' }];
    const original = structuredClone(history);
    await chat(undefined, config, history);
    const wire = JSON.parse(generate.mock.calls[0][1].body).messages;
    expect(wire).toHaveLength(64);
    expect(wire.slice(1, 3)).toEqual([history[0], history.at(-2)]);
    expect(wire.slice(3)).toEqual([...history.slice(21, -2), history.at(-1)]);
    expect(history).toEqual(original);
  });

  it('drops oldest whole exchanges for the character budget, never a tool call without all replies', async () => {
    const calls = [{ id: 'read1', name: 'Read', args: { path: '/first' } }, { id: 'read2', name: 'Read', args: { path: '/second' } }];
    const exchange = [
      { role: 'user', content: 'Read both notes' }, { role: 'assistant', content: '', toolCalls: calls },
      { role: 'tool', name: 'Read', tool_call_id: 'read1', content: 'x'.repeat(25000) },
      { role: 'tool', name: 'Read', tool_call_id: 'read2', content: 'y'.repeat(25000) },
      { role: 'assistant', content: 'Both notes read' }
    ];
    const history = [{ role: 'user', content: 'Old question' }, { role: 'assistant', content: 'old'.repeat(25000) },
      ...exchange, { role: 'user', content: 'Continue' }];
    await chat(undefined, config, history);
    const options = generate.mock.calls[0][1], wire = JSON.parse(options.body).messages;
    expect(wire.slice(1).map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant', 'user']);
    expect(JSON.parse(wire[2].content).toolCalls).toEqual(calls);
    expect(wire.slice(3, 5).map(message => JSON.parse(message.content))).toEqual(exchange.slice(2, 4));
    expect(wire.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(120000);
    expect(new TextEncoder().encode(options.body).length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('drops a whole old tool-heavy exchange rather than retaining orphaned results to fill the budget', async () => {
    const calls = Array.from({ length: 30 }, (_, i) => ({ id: `call${i}`, name: 'Read', args: {} }));
    const batch = [{ role: 'user', content: 'Old batch' }, { role: 'assistant', content: '', toolCalls: calls },
      ...calls.map(call => ({ role: 'tool', name: call.name, tool_call_id: call.id, content: 'result' }))];
    const history = [...batch, ...Array.from({ length: 16 }, (_, i) => [
      { role: 'user', content: `Question ${i}` }, { role: 'assistant', content: `Answer ${i}` }
    ]).flat(), { role: 'user', content: 'Current question' }];
    await chat(undefined, config, history);
    expect(JSON.parse(generate.mock.calls[0][1].body).messages.slice(1)).toEqual(history.slice(batch.length));
  });

  it('never slices the latest tool-heavy exchange when it alone exceeds the message budget', async () => {
    const calls = Array.from({ length: 62 }, (_, i) => ({ id: `call${i}`, name: 'Read', args: {} }));
    const input = [{ role: 'user', content: 'Current batch' }, { role: 'assistant', content: '', toolCalls: calls },
      ...calls.map(call => ({ role: 'tool', name: call.name, tool_call_id: call.id, content: 'result' }))];
    await expect(chat(undefined, config, input)).rejects.toMatchObject({ code: 'context_limit' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: 'user', content: 4 }],
    [{ role: 'user', content: 'old', toolCalls: [] }],
    [{ role: 'user', content: 'old' }, { role: 'tool', content: 'orphan', name: 'Read', tool_call_id: 'none' }],
    [{ role: 'user', content: 'old' }, { role: 'assistant', content: '', toolCalls: [{ id: 'missing', name: 'Read', args: {} }] }],
    [{ role: 'user', content: 'old' }, { role: 'assistant', content: '', toolCalls: [{ id: 'bad', name: 'Read', args: null }] }]
  ].map(old => [old]))('rejects malformed older history before it can be omitted: %j', async old => {
    const history = [...old, ...Array.from({ length: 40 }, () => messages[0]), { role: 'user', content: 'latest' }];
    await expect(chat(undefined, config, history)).rejects.toThrow(/managed Zero/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([31, 40])('continues the actual agent after %i saved exchanges while retaining its complete stored history', async count => {
    const { createZeroAgent } = await import('../../self/zero/agent.js');
    const history = Array.from({ length: count }, (_, i) => [
      { role: 'user', content: `Question ${i}` }, { role: 'assistant', content: `Answer ${i}` }
    ]).flat();
    let saved = JSON.stringify({ schema: 'reploid.zero/v1', messages: history });
    const agent = await createZeroAgent({ config: { ...config, systemPrompt: 'Preserve work' }, provider: createZeroProvider(),
      tools: { schemas: () => [], execute: vi.fn(), dispose: vi.fn() },
      store: { read: async () => saved, write: async (_path, value) => { saved = value; } } });
    try {
      const result = await agent.run('Continue this conversation');
      expect(result.status).toBe('completed');
      expect(result.messages).toEqual([...history, { role: 'user', content: 'Continue this conversation' }, { role: 'assistant', content: 'Done' }]);
      expect(JSON.parse(saved).messages).toEqual(result.messages);
      const wire = JSON.parse(generate.mock.calls[0][1].body).messages;
      expect(wire).toHaveLength(63);
      expect(wire.at(-1)).toEqual({ role: 'user', content: 'Continue this conversation' });
      expect(wire.slice(2, -1)).toEqual(history.slice(-60));
    } finally { await agent.dispose(); }
  });

  it('bounds declared and streamed response bytes', async () => {
    generate.mockResolvedValue(new Response('{}', { headers: { 'Content-Length': String(2 * 1024 * 1024) } }));
    await expect(chat()).rejects.toThrow('exceeds limit');
    generate.mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
    await expect(chat()).rejects.toThrow('exceeds limit');
  });

  it('cancels before auth and never sends context', async () => {
    await expect(chat(undefined, config, messages, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels during auth and rejects its late completion before fetch', async () => {
    const token = deferred();
    sdk.getIdToken.mockReturnValue(token.promise);
    const controller = new AbortController();
    const pending = chat(undefined, config, messages, { signal: controller.signal });
    await vi.waitFor(() => expect(sdk.getIdToken).toHaveBeenCalled());
    controller.abort();
    token.resolve('late-token');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('snapshots public payload before asynchronous auth and cannot be retargeted', async () => {
    const token = deferred();
    sdk.getIdToken.mockReturnValue(token.promise);
    const settings = { ...config, tools: structuredClone(tools) }, input = structuredClone(messages);
    const pending = chat(undefined, settings, input);
    await vi.waitFor(() => expect(sdk.getIdToken).toHaveBeenCalled());
    settings.provider = 'openai'; settings.model = 'other'; settings.endpoint = 'https://attacker.example';
    settings.tools[0].function.name = 'Changed'; input[0].content = 'Changed';
    token.resolve('token');
    await pending;
    const wire = JSON.parse(generate.mock.calls[0][1].body);
    expect(wire.provider).toBe('gemini');
    expect(wire.messages[1]).toEqual(messages[0]);
    expect(wire.messages[0].content).toContain('Read');
    expect(wire.messages[0].content).not.toContain('Changed');
  });

  it('passes cancellation to fetch and rejects even a successful late transport', async () => {
    const response = deferred(); generate.mockReturnValue(response.promise);
    const controller = new AbortController();
    const pending = chat(undefined, config, messages, { signal: controller.signal });
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    controller.abort(); response.resolve(reply());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('checks cancellation after reading a delayed response body', async () => {
    let release;
    const stream = new ReadableStream({ start(controller) { release = () => {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ provider: 'gemini', model: ZERO_GEMINI_MODEL,
        content: '{"content":"late","toolCalls":[]}' }))); controller.close();
    }; } });
    generate.mockResolvedValue(new Response(stream));
    const controller = new AbortController();
    const pending = chat(undefined, config, messages, { signal: controller.signal });
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces the existing minimum interval and cancels waits without another request', async () => {
    vi.useFakeTimers();
    const provider = createZeroProvider();
    await chat(provider);
    const controller = new AbortController();
    const pending = chat(provider, config, messages, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(ZERO_GEMINI_AGENT_THROTTLE.minProviderRequestIntervalMs - 1);
    expect(generate).toHaveBeenCalledTimes(1);
    controller.abort(); await rejected;
    expect(vi.getTimerCount()).toBe(0);
    const next = chat(provider);
    await vi.advanceTimersByTimeAsync(1); await next;
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe('compact Zero external provider preservation', () => {
  const externalConfig = { provider: 'external', id: 'connected-agent', tools };
  const externalReply = () => json({ requestId: 'req_one', sessionId: 'zero:test',
    provider: 'external', model: 'connected-agent', content: 'Ready', toolCalls: [] });
  const local = () => createZeroProvider({ getLocation: () => ({ hostname: '127.0.0.1', protocol: 'http:' }), getSessionId: () => 'zero:test' });

  it('remains loopback-only and cannot fall back to managed inference', async () => {
    await expect(chat(undefined, externalConfig)).rejects.toThrow('loopback');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps native history conversion and existing request/session binding without credential serialization', async () => {
    generate.mockResolvedValue(externalReply());
    const input = [{ role: 'assistant', content: '', toolCalls: [{ id: 'call1', name: 'Read', args: { path: '/note' } }] }];
    await chat(local(), { ...externalConfig, apiKey: 'never-send' }, input);
    const [url, options] = generate.mock.calls[0], body = JSON.parse(options.body);
    expect(url).toBe('/api/external-brain/generate');
    expect(body).toMatchObject({ requestId: 'req_one', sessionId: 'zero:test', modelId: 'connected-agent', tools });
    expect(body.messages[0].tool_calls).toEqual([{ id: 'call1', type: 'function', function: { name: 'Read', arguments: '{"path":"/note"}' } }]);
    expect(options.body).not.toContain('never-send');
    expect(sdk.getIdToken).not.toHaveBeenCalled();
  });

  it('retains cancellation DELETE and never delivers late reasoning', async () => {
    const response = deferred();
    generate.mockImplementation(url => url.endsWith('/generate') ? response.promise : Promise.resolve(externalReply()));
    const controller = new AbortController();
    const pending = chat(local(), externalConfig, messages, { signal: controller.signal });
    controller.abort(); response.resolve(externalReply());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate.mock.calls[1]).toEqual(['/api/external-brain/requests/req_one', expect.objectContaining({ method: 'DELETE' })]);
  });
});
