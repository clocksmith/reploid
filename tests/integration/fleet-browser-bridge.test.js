// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { startFleetBrowserBridge } from '../../server/fleet/browser-bridge.js';
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
