// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { startFleetBrowserBridge } from '../../server/fleet/browser-bridge.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import tunnelWorker from '../../server/fleet/cloudflare-tunnel-worker.js';
import { createPrivateComputers } from '../../apps/poolday/host/private-computers.js';
const identity = 'sha256:' + 'a'.repeat(64), requester = 'peer:' + '1'.repeat(24), provider = 'peer:' + '2'.repeat(24);
const origin = 'http://localhost:8000', token = 'pairing-secret-for-owned-test-host-only-1234';
const model = { id: 'tiny', identity, name: 'Tiny', availability: 'ready' };
const snapshot = { schema: 'reploid.fleet-browser/v1', poolIdentity: 'sha256:' + 'b'.repeat(64), requester: { name: 'Mac', participantId: requester },
  models: [model], computers: [{ id: 'bee', name: 'Miles', online: true, participantIds: [provider] }] };
const host = () => ({ browserState: vi.fn(async () => structuredClone(snapshot)), balances: vi.fn(async () => ({ accounts: [] })), cancel: vi.fn(),
  generate: vi.fn(async (request, delta, route) => {
    route({ recipientIdentity: provider, requestId: 'work' }); delta('Hello');
    return { modelId: model.id, modelIdentity: identity, adapterIdentities: [], content: 'Hello',
      execution: { placement: 'peer-whole-request', providerIdentity: provider }, serviceCredit: { charge: 1, settledAt: Date.now() } }; }) });
const fetchImpl = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } });
it('requires exact origin and pairing, streams the real host result and retains credit evidence', async () => {
  const native = host(), bridge = await startFleetBrowserBridge({ host: native, origins: [origin], token });
  const client = createPrivateComputers({ storage: null, fetchImpl });
  try {
    expect((await fetch(bridge.url + '/state', { method: 'POST', body: '{}', headers: { Origin: 'https://unpaired.test', Authorization: `Bearer ${token}` } })).status).toBe(400);
    expect((await fetch(bridge.url + '/state', { method: 'POST', body: '{}', headers: { Origin: origin } })).status).toBe(400);
    await client.connect(bridge.url, token);
    expect(client.models()[0].source).toBeUndefined();
    const onState = vi.fn(), onDelta = vi.fn(), requestApproval = vi.fn(async () => true);
    const result = await client.execute({ threadId: 'thread', attemptId: 'attempt', model: client.models()[0], messages: [{ role: 'user', content: 'Hello' }], permissions: { sharingScope: 'mesh' } },
      { signal: new AbortController().signal, onState, onDelta, requestApproval });
    expect(requestApproval.mock.calls[0][0].privateDelegation.computers[provider]).toBe('Miles');
    expect(onDelta.mock.calls[0][0].text).toBe('Hello');
    expect(result.execution.peerId).toBe(provider); expect(result.execution.serviceCredit.charge).toBe(1);
    expect(native.generate.mock.calls[0][0].model).toEqual({ id: model.id, identity });
    expect(onState.mock.calls.some(([row]) => row.execution.peerId === provider)).toBe(true);
    await expect(client.execute({ threadId: 'thread', attemptId: 'attempt', model: client.models()[0], messages: [], permissions: { sharingScope: 'mesh' } },
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
    await expect(client.execute({ threadId: 't', attemptId: 'cancel', model: client.models()[0], messages: [{ role: 'user', content: 'x' }], permissions: { sharingScope: 'mesh' } },
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
      { threadId: 't-https', attemptId: 'a-https', model: client.models()[0], messages: [{ role: 'user', content: 'Hi' }], permissions: { sharingScope: 'mesh' } },
      { signal: new AbortController().signal, requestApproval: async () => true, onState: row => states.push(structuredClone(row)), onDelta: d => deltas.push(d.text) }
    );
    expect(deltas.join('')).toBe('Streamed over HTTPS');
    expect(states.some(row => row.status === 'queued' && row.execution?.admission?.queuePosition === 1)).toBe(true);
    expect(result.execution.admission.queuedMs).toBe(120);
    expect(result.execution.serviceCredit.charge).toBe(3);

    const recovered = await client.recover({ reservationId: 'service:test:1', messages: [{ role: 'user', content: 'Hi' }] });
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
        { threadId: 't-rot', attemptId, model: client.models()[0], messages: [{ role: 'user', content: 'Hi' }], permissions: { sharingScope: 'mesh' } },
        controls()
      );
      expect(res.content).toBe(`ok:${attemptId}`);
    }
    await expect(client.execute(
      { threadId: 't-rot', attemptId: 'att-3', model: client.models()[0], messages: [{ role: 'user', content: 'Dup' }], permissions: { sharingScope: 'mesh' } },
      controls()
    )).rejects.toThrow('already used');

    const fourth = await client.execute(
      { threadId: 't-rot', attemptId: 'att-4', model: client.models()[0], messages: [{ role: 'user', content: 'Fourth' }], permissions: { sharingScope: 'mesh' } },
      controls()
    );
    expect(fourth.content).toBe('ok:att-4');
  } finally {
    client.close();
    await bridge.close();
  }
});
