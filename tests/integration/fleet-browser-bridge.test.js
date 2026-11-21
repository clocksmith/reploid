import { createExecutionPolicy, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { startFleetBrowserBridge } from '../../server/fleet/browser-bridge.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import tunnelWorker from '../../server/fleet/cloudflare-tunnel-worker.js';
import { createPrivateComputers } from '../../apps/poolday/host/private-computers.js';
const identity = 'sha256:' + 'a'.repeat(64), requester = 'peer:' + '1'.repeat(24), provider = 'peer:' + '2'.repeat(24);
const origin = 'http://localhost:8000', token = 'pairing-secret-for-owned-test-host-only-1234';
const model = { id: 'tiny', identity, name: 'Tiny', availability: 'ready' };
const currentProtocol = 'reploid.paired-route/v3';
const plaintextPolicy = (recipients = { kind: 'open', ids: [] }) => createExecutionPolicy({
  placement: 'network-allowed', recipients, computation: 'plaintext'
});
const wholeRoute = plaintextExecutionRoute({ model }, { recipients: [requester, provider],
  route: { schema: 'reploid.paired-whole-route/v1', requester, providerIdentity: provider } });
const snapshot = { privacyProtocol: currentProtocol, schema: 'reploid.fleet-browser/v1', poolIdentity: 'sha256:' + 'b'.repeat(64), requester: { name: 'Mac', participantId: requester },
  models: [{ ...model, executionRoutes: [{ selection: { id: model.id, identity: model.identity }, route: wholeRoute }] }], computers: [{ id: 'bee', name: 'Miles', online: true, participantIds: [provider] }] };
const host = () => ({ browserState: vi.fn(async () => structuredClone(snapshot)), balances: vi.fn(async () => ({ accounts: [] })), cancel: vi.fn(),
  generate: vi.fn(async (request, delta, route) => {
    route({ recipientIdentity: provider, requestId: 'work' }); delta('Hello');
    return { modelId: model.id, modelIdentity: identity, adapterIdentities: [], content: 'Hello',
      execution: { placement: 'peer-whole-request', providerIdentity: provider }, serviceCredit: { charge: 1, settledAt: Date.now() } }; }) });
const fetchImpl = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });

it.each(['disconnect', 'close'])('does not disclose after %s during pending authorization', async action => {
  const calls = [], gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const client = createPrivateComputers({ storage: null, fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return Response.json(snapshot);
  } });
  try {
    await client.connect('http://127.0.0.1:18784', token);
    const pending = client.execute({ threadId: 't', attemptId: 'pending', model: client.models()[0],
      messages: [{ role: 'user', content: 'Fixture prompt' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() }, {
      signal: new AbortController().signal, requestApproval: () => { entered.resolve(); return gate.promise; }, onState() {}, onDelta() {}
    });
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
    await expect(client.connect('http://127.0.0.1:18785', token)).rejects.toThrow();
    await client[action]();
    // Cancellation releases the attempt even if its approval never settles.
    await rejected;
    if (action === 'disconnect') await client.connect('http://127.0.0.1:18785', token);
    else await expect(client.connect('http://127.0.0.1:18785', token)).rejects.toThrow();
    gate.resolve(true);
    await Promise.resolve();
    expect(calls.filter(call => call.path === '/generate')).toEqual([]);
  } finally { client.close(); }
});

it('snapshots request and disclosure bindings before a callback can mutate them', async () => {
  const calls = [];
  const client = createPrivateComputers({ storage: null, fetchImpl: async (url, init) => {
    if (url.endsWith('/state')) return Response.json(snapshot);
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ result: { modelId: model.id, modelIdentity: identity,
      adapterIdentities: [], content: 'Fixture answer', execution: {} } }) + '\n');
  } });
  try {
    await client.connect('http://127.0.0.1:18784', token);
    const request = { threadId: 't', attemptId: 'snapshot', model: client.models()[0],
      messages: [{ role: 'user', content: 'Original fixture' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() };
    await client.execute(request, { signal: new AbortController().signal, onState() {}, onDelta() {}, requestApproval: async preview => {
      request.messages[0].content = 'Changed'; preview.input.messages[0].content = 'Changed again';
      preview.privateDelegation.poolIdentity = 'changed'; return true;
    } });
    expect(calls[0]).toMatchObject({ poolIdentity: snapshot.poolIdentity, messages: [{ content: 'Original fixture' }] });
  } finally { client.close(); }
});
it('requires exact origin and pairing, streams the real host result and retains credit evidence', async () => {
  const native = host(), bridge = await startFleetBrowserBridge({ host: native, origins: [origin], token });
  const client = createPrivateComputers({ storage: null, fetchImpl });
  try {
    expect((await fetch(bridge.url + '/state', { method: 'POST', body: '{}', headers: { Origin: 'https://unpaired.test', Authorization: `Bearer ${token}` } })).status).toBe(400);
    expect((await fetch(bridge.url + '/state', { method: 'POST', body: '{}', headers: { Origin: origin } })).status).toBe(400);
    await client.connect(bridge.url, token);
    expect(client.models()[0].source).toBeUndefined();
    const onState = vi.fn(), onDelta = vi.fn(), requestApproval = vi.fn(async () => true);
    const result = await client.execute({ threadId: 'thread', attemptId: 'attempt', model: client.models()[0], messages: [{ role: 'user', content: 'Hello' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      { signal: new AbortController().signal, onState, onDelta, requestApproval });
    expect(requestApproval.mock.calls[0][0].privateDelegation.computers[provider]).toBe('Miles');
    expect(onDelta.mock.calls[0][0].text).toBe('Hello');
    expect(result.execution.peerId).toBe(provider); expect(result.execution.serviceCredit.charge).toBe(1);
    expect(native.generate.mock.calls[0][0].model).toEqual({ id: model.id, identity });
    expect(onState.mock.calls.some(([row]) => row.execution.peerId === provider)).toBe(true);
    await expect(client.execute({ threadId: 'thread', attemptId: 'attempt', model: client.models()[0], messages: [], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      { signal: new AbortController().signal, onState, onDelta, requestApproval })).rejects.toThrow();
    expect(native.generate).toHaveBeenCalledTimes(1);
  } finally { client.close(); await bridge.close(); }
});
it('rejects enrollment changes and never substitutes public capacity or downloads', async () => {
  const native = host(), bridge = await startFleetBrowserBridge({ host: native, origins: [origin], token });
  const client = createPrivateComputers({ storage: null, fetchImpl });
  try {
    await client.connect(bridge.url, token); const selected = client.models()[0];
    native.browserState.mockResolvedValue({ ...snapshot, poolIdentity: 'changed' });
    await client.refresh(); expect(client.state().connected).toBe(false); expect(client.models()[0].availability).toBe('unavailable');
    await expect(client.execute({ model: selected }, {})).rejects.toThrow('unavailable');
    expect(native.generate).not.toHaveBeenCalled();
  } finally { client.close(); await bridge.close(); }
});
it('cancels the owned request on stream loss without inventing a refund or completion', async () => {
  const native = host(); let rejectRun;
  native.generate.mockImplementation(async (_, delta, route) => { route({ recipientIdentity: provider, requestId: 'work' }); delta('Partial'); await new Promise((_, reject) => { rejectRun = reject; }); });
  native.cancel.mockImplementation(() => rejectRun?.(Error('Stopped')));
  const bridge = await startFleetBrowserBridge({ host: native, origins: [origin], token });
  const client = createPrivateComputers({ storage: null, fetchImpl });
  try {
    await client.connect(bridge.url, token); const controller = new AbortController(), states = [];
    await expect(client.execute({ threadId: 't', attemptId: 'cancel', model: client.models()[0], messages: [{ role: 'user', content: 'x' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      { signal: controller.signal, requestApproval: async () => true, onState: row => states.push(row), onDelta: () => controller.abort() })).rejects.toThrow();
    await vi.waitFor(() => expect(native.cancel).toHaveBeenCalledWith('cancel'));
    expect(states.at(-1).execution.serviceCredit.status).toBe('pending');
  } finally { client.close(); await bridge.close(); }
});

it('pairs over authenticated HTTPS /bridge via the Cloudflare tunnel Worker with strict secret/origin isolation and live queue state', async () => {
  const apiToken = 'text-api-bearer-secret-separate-from-browser-5678';
  const hostedOrigin = 'https://replo.id';
  const native = {
    ...host(),
    identity: { peerId: requester },
    allowsModel: () => true,
    enrolledRecipients: async () => new Set([provider]),
    runAccountedGeneration: vi.fn(),
    receipt: vi.fn(async () => ({ binding: { consumer: requester, model: { id: model.id, identity }, mode: 'whole-model',
      providers: [{ participantId: provider }] } })),
    recover: vi.fn(async ({ reservationId }) => ({ status: 'completed', serviceCredit: { id: reservationId, charge: 2, settledAt: 123 } })),
    textParticipant: { roomId: 'private-room', executionClass: 'private-pool', getState: () => ({ models: [] }), generate: vi.fn() }
  };
  native.generate = vi.fn(async (_request, delta, route, onAdmission) => {
    onAdmission({ status: 'queued', queuePosition: 1, queuedCount: 2, queuedAt: 100 });
    route({ recipientIdentity: provider, requestId: 'work-https' });
    delta('Streamed ');
    delta('over HTTPS');
    return {
      modelId: model.id, modelIdentity: identity, adapterIdentities: [], content: 'Streamed over HTTPS',
      execution: { placement: 'peer-whole-request', providerIdentity: provider, admission: { queuedMs: 120 } },
      serviceCredit: { charge: 3, settledAt: Date.now() }
    };
  });
  const api = await startFleetTextApi({
    host: native,
    token: apiToken,
    browserBridge: { token, origins: [hostedOrigin] }
  });
  const baseOrigin = new URL(api.url).origin;
  const env = {
    FLEET_API: {
      fetch: req => {
        const rewritten = new URL(req.url);
        return fetch(new Request(baseOrigin + rewritten.pathname, {
          method: req.method,
          headers: req.headers,
          ...(req.method === 'POST' ? { body: req.body, duplex: 'half' } : {}),
          signal: req.signal
        }));
      }
    }
  };
  const workerFetch = (url, init = {}) => tunnelWorker.fetch(new Request(url, {
    ...init,
    headers: { ...(init.headers || {}), Origin: hostedOrigin }
  }), env);
  const client = createPrivateComputers({ storage: null, fetchImpl: workerFetch });
  try {
    // Browser CORS preflight succeeds without Authorization for the paired origin and rejects unpaired origins.
    const preflight = await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/bridge/state', {
      method: 'OPTIONS',
      headers: { Origin: hostedOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' }
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(hostedOrigin);

    const badOriginPreflight = await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/bridge/state', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }
    }), env);
    expect(badOriginPreflight.status).toBe(400);

    // Secrets are never interchangeable between /bridge/* and /v1/*.
    expect((await workerFetch('https://reploid-fleet-api.reploid.workers.dev/bridge/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` }, body: '{}'
    })).status).toBe(400);
    expect((await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/v1/models', {
      headers: { Authorization: `Bearer ${token}` }
    }), env)).status).toBe(401);

    // Full HTTPS pairing, streaming with live queue state, and recovery without local insecure HTTP.
    await client.connect('https://reploid-fleet-api.reploid.workers.dev/bridge', token);
    expect(client.state().connected).toBe(true);
    const states = [], deltas = [];
    const result = await client.execute(
      { threadId: 't-https', attemptId: 'a-https', model: client.models()[0], messages: [{ role: 'user', content: 'Hi' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      { signal: new AbortController().signal, requestApproval: async () => true, onState: row => states.push(structuredClone(row)), onDelta: d => deltas.push(d.text) }
    );
    expect(deltas.join('')).toBe('Streamed over HTTPS');
    expect(states.some(row => row.status === 'queued' && row.execution?.admission?.queuePosition === 1)).toBe(true);
    expect(result.execution.admission.queuedMs).toBe(120);
    expect(result.execution.serviceCredit.charge).toBe(3);

    const recovery = { reservationId: 'service:test:1', messages: [{ role: 'user', content: 'Hi' }] };
    await expect(client.recover(recovery)).rejects.toThrow('Original recovery binding');
    expect(native.recover).not.toHaveBeenCalled();
    const recovered = await client.recover({ ...recovery, privacyBinding: native.generate.mock.calls[0][0].privacyBinding });
    expect(recovered.status).toBe('completed');
  } finally {
    client.close();
    await api.close();
  }
});

it('rotates oldest settled attempt identifiers past maxSeenAttempts while rejecting recent and active duplicates', async () => {
  const native = host();
  native.generate = vi.fn(async request => ({
    modelId: model.id, modelIdentity: identity, adapterIdentities: [], content: `ok:${request.attemptId}`,
    execution: { placement: 'peer-whole-request', providerIdentity: provider },
    serviceCredit: { charge: 1, settledAt: Date.now() }
  }));
  const bridge = await startFleetBrowserBridge({ host: native, token, origins: [origin], maxConcurrent: 2, maxSeenAttempts: 3 });
  const client = createPrivateComputers({ storage: null, fetchImpl: (url, init = {}) =>
    fetch(url, { ...init, headers: { ...(init.headers || {}), Origin: origin } }) });
  try {
    await client.connect(bridge.url, token);
    const controls = () => ({ signal: new AbortController().signal, requestApproval: async () => true, onState: () => {}, onDelta: () => {} });
    for (const attemptId of ['att-1', 'att-2', 'att-3']) {
      const res = await client.execute(
        { threadId: 't-rot', attemptId, model: client.models()[0], messages: [{ role: 'user', content: 'Hi' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
        controls()
      );
      expect(res.content).toBe(`ok:${attemptId}`);
    }
    await expect(client.execute(
      { threadId: 't-rot', attemptId: 'att-3', model: client.models()[0], messages: [{ role: 'user', content: 'Dup' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      controls()
    )).rejects.toThrow('already used');

    const fourth = await client.execute(
      { threadId: 't-rot', attemptId: 'att-4', model: client.models()[0], messages: [{ role: 'user', content: 'Fourth' }], permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      controls()
    );
    expect(fourth.content).toBe('ok:att-4');
  } finally {
    client.close();
    await bridge.close();
  }
});

it('validates every paired v3 route recipient before transmitting prompt messages', async () => {
  const native = host();
  const route = plaintextExecutionRoute({ model }, { recipients: [requester, provider],
    route: { schema: 'reploid.paired-whole-route/v1', requester, providerIdentity: provider } });
  const current = { ...structuredClone(snapshot), privacyProtocol: currentProtocol,
    models: [{ ...model, executionRoutes: [{ selection: { id: model.id, identity: model.identity }, route }] }] };
  native.browserState.mockImplementation(async () => structuredClone(current));
  const bridge = await startFleetBrowserBridge({ host: native, token, origins: [origin] });
  const calls = [];
  const client = createPrivateComputers({ storage: null, fetchImpl: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) }); return fetchImpl(url, init);
  } });
  try {
    await client.connect(bridge.url, token);
    const input = { threadId: 'thread', attemptId: 'blocked', model: client.models()[0], messages: [{ role: 'user', content: 'secret' }],
      permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy({ kind: 'named', ids: [requester] }) };
    const controls = { signal: new AbortController().signal, requestApproval: async () => true, onState() {}, onDelta() {} };
    await expect(client.execute(input, controls)).rejects.toThrow('No paired route');
    expect(calls.filter(call => call.path.endsWith('/generate'))).toEqual([]);
    expect(native.generate).not.toHaveBeenCalled();
    input.privacy = plaintextPolicy({ kind: 'named', ids: [provider] });
    await expect(client.execute(input, controls)).rejects.toThrow('No paired route');
    expect(calls.filter(call => call.path.endsWith('/generate'))).toEqual([]);
    expect(native.generate).not.toHaveBeenCalled();
    input.attemptId = 'allowed';
    input.privacy = plaintextPolicy({ kind: 'named', ids: [requester, provider] });
    const result = await client.execute(input, controls);
    expect(result.content).toBe('Hello');
    expect(native.generate.mock.calls[0][0].privacyBinding.route.hops.map(hop => hop.recipient)).toEqual([requester, provider]);
    expect(result.execution.privacy.cryptographic).toBe('unavailable');
  } finally { client.close(); await bridge.close(); }
});

it.each([undefined, 'reploid.paired-route/v2'])('refuses a stale bridge advertisement (%s) before any prompt is sent', async privacyProtocol => {
  const seen = [];
  const client = createPrivateComputers({ storage: null, fetchImpl: async url => {
    seen.push(url); return Response.json({ ...snapshot, privacyProtocol });
  } });
  try {
    await expect(client.connect('http://127.0.0.1:18784', token)).rejects.toThrow('preflight');
    expect(client.state().connected).toBe(false);
    expect(seen.some(url => url.endsWith('/generate'))).toBe(false);
  } finally { client.close(); }
});

it.each([undefined, { schema: 'reploid.execution-policy/v1', profile: 'provider-visible' }])(
  'refuses absent or obsolete policy at the bridge before native dispatch (%s)', async privacy => {
    const native = host(), bridge = await startFleetBrowserBridge({ host: native, origins: [origin], token });
    try {
      const response = await fetchImpl(bridge.url + '/generate', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: 't', attemptId: 'stale', poolIdentity: snapshot.poolIdentity,
          model: { id: model.id, identity }, privacy, messages: [{ role: 'user', content: 'fixture only' }] }) });
      expect(response.status).toBe(400);
      expect(native.generate).not.toHaveBeenCalled();
    } finally { await bridge.close(); }
  });

it('does not send the prompt when the approved route disappears during consent', async () => {
  let state = snapshot;
  const paths = [];
  const client = createPrivateComputers({ storage: null, fetchImpl: async url => {
    paths.push(new URL(url).pathname);
    return Response.json(state);
  } });
  try {
    await client.connect('http://127.0.0.1:18784', token);
    await expect(client.execute({ threadId: 't', attemptId: 'superseded', model: client.models()[0],
      messages: [{ role: 'user', content: 'Fixture prompt' }], permissions: { sharingScope: 'mesh' },
      privacy: plaintextPolicy() }, {
      signal: new AbortController().signal, onState() {}, onDelta() {}, requestApproval: async () => {
        state = { ...snapshot, models: [{ ...model, executionRoutes: [] }] };
        return true;
      }
    })).rejects.toThrow('route changed; nothing was sent');
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths.every(path => path === '/state')).toBe(true);
  } finally { client.close(); }
});

it('refuses a paired advertisement that labels its remote coordinator as local', async () => {
  const route = plaintextExecutionRoute({ model }, { local: true, recipients: [requester] });
  const state = { ...structuredClone(snapshot), privacyProtocol: currentProtocol,
    models: [{ ...model, executionRoutes: [{ selection: model, route }] }] };
  const sent = [];
  const client = createPrivateComputers({ storage: null, fetchImpl: async (url, init) => { sent.push(url); return Response.json(state); } });
  try {
    await client.connect('http://127.0.0.1:18784', token);
    await expect(client.execute({ threadId: 't', attemptId: 'forged', model: client.models()[0], messages: [{ content: 'secret' }],
      permissions: { sharingScope: 'mesh' }, privacy: plaintextPolicy() },
      { signal: new AbortController().signal, requestApproval: async () => true, onState() {}, onDelta() {} })).rejects.toThrow('No paired route');
    expect(sent.some(url => url.endsWith('/generate'))).toBe(false);
  } finally { client.close(); }
});
