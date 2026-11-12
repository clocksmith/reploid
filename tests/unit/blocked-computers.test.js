import { describe, expect, it, vi } from 'vitest';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';
import { bindNetworkControls, projectNetworkPeers, renderConnectionControl,
  renderSharingControls } from '../../apps/poolday/ui/pool-home/network-controls.js';
import { renderComputerDiagnostic } from '../../apps/poolday/ui/pool-home/computer-preferences-view.js';
import policy from '../../apps/poolday/config/computer-preferences.json' with { type: 'json' };

const key = 'peer:' + 'a'.repeat(24);
const storage = () => { const values = new Map(); return { values, getItem: name => values.get(name) ?? null,
  setItem: (name, value) => values.set(name, value) }; };
const modelIdentity = 'sha256:' + 'a'.repeat(64);

/** One requester (index 0) and N providers of the same model, joined by an in-memory transport. */
async function fixture({ providers = 2, blocked = () => [] } = {}) {
  const count = providers + 1;
  const identities = await Promise.all(Array.from({ length: count }, () => createSigningIdentity({ algorithm: 'Ed25519' })));
  const handlers = Array.from({ length: count }, () => new Map()), wire = [];
  const send = (from, to, type, payload) => {
    payload = structuredClone(payload); wire.push({ from, to, type });
    queueMicrotask(() => Promise.resolve(handlers[to].get(type)?.('connection-' + from, payload)).catch(() => {}));
    return true;
  };
  const meshes = identities.map((identity, i) => {
    const listeners = new Map(), events = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
    };
    return createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'block-test', generationTimeoutMs: 300 } } }), ports: {
      instanceId: 'instance-' + i, modelConfig: i ? { id: 'model' } : null,
      ...(i === 0 ? { getBlockedComputers: blocked } : {}),
      getExecutionState: () => ({ phase: i ? 'ready' : 'idle', modelIdentity, adapterIdentities: [] }),
      authorize: async () => true, events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
      generate: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'answer from ' + i,
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 1, generatedTokenCount: 1, stopReason: 'eos-token' } }),
      createTransport: () => ({ init: async () => true, disconnect() {}, _getPeerId: () => 'connection-' + i,
        getPeerBinding: peer => ({ local: 'certificate-' + i, remote: 'certificate-' + String(peer).split('-')[1] }),
        onMessage: (type, fn) => handlers[i].set(type, fn),
        broadcast: (type, payload) => { for (let to = 0; to < count; to++) if (to !== i) send(i, to, type, payload); return true; },
        sendToPeer: (peer, type, payload) => send(i, Number(String(peer).split('-')[1]), type, payload) })
    } });
  });
  for (const mesh of meshes) await mesh.connect();
  for (const mesh of meshes.slice(1)) mesh.refreshAdvertisement();
  const requester = meshes[0];
  await vi.waitFor(() => expect(requester.getSwarmSnapshot().peers.filter(peer => peer.readiness === 'ready')).toHaveLength(providers));
  const requestsTo = () => wire.filter(message => message.type === 'reploid:generation-request').map(message => message.to);
  const ask = () => requester.generate([{ role: 'user', content: 'prompt' }], null, { modelId: 'model', modelIdentity });
  const readvertise = () => { for (const mesh of meshes.slice(1)) mesh.refreshAdvertisement(); };
  return { identities, requester, wire, requestsTo, ask, readvertise, close: () => Promise.all(meshes.map(mesh => mesh.close())) };
}

describe('requester provider choice with a block list', () => {
  it('never sends a request to a computer blocked by its verified identity', async () => {
    let blocked = [];
    const f = await fixture({ blocked: () => blocked });
    try {
      // Identities are proven in the background one at a time, on advertisements.
      await vi.waitFor(() => { f.readvertise(); expect(f.requester.getSwarmSnapshot().peers.every(peer => peer.identityVerified)).toBe(true); });
      for (const [blockedIndex, other] of [[1, 2], [2, 1]]) {
        blocked = [f.identities[blockedIndex].peerId];
        const before = f.requestsTo().length;
        for (let i = 0; i < 3; i++) expect((await f.ask()).content).toBe('answer from ' + other);
        expect(f.requestsTo().slice(before)).toEqual([other, other, other]);
        expect(f.requester.getSwarmSnapshot().peers.find(peer => peer.peerId === 'connection-' + blockedIndex).blocked).toBe(true);
        expect(f.requester.getSwarmSnapshot().peers.find(peer => peer.peerId === 'connection-' + other).blocked).toBeUndefined();
      }
    } finally { await f.close(); }
  });

  it('asks a not-yet-identified candidate to prove its identity before choosing it, and passes over a blocked one', async () => {
    let blocked = [];
    const f = await fixture({ blocked: () => blocked });
    try {
      const unknown = f.requester.getSwarmSnapshot().peers.find(peer => !peer.identityVerified);
      expect(unknown).toBeTruthy();
      const index = Number(unknown.peerId.split('-')[1]), other = 3 - index;
      blocked = [f.identities[index].peerId];
      for (let i = 0; i < 3; i++) expect((await f.ask()).content).toBe('answer from ' + other);
      expect(f.requestsTo()).toEqual([other, other, other]);
    } finally { await f.close(); }
  });

  it('honours a block recorded against a connection id', async () => {
    const f = await fixture({ blocked: () => ['connection-1'] });
    try {
      expect((await f.ask()).content).toBe('answer from 2');
      expect(f.requestsTo()).toEqual([2]);
    } finally { await f.close(); }
  });

  it('finds no provider, and sends nothing, when the only provider is blocked', async () => {
    let blocked = [];
    const f = await fixture({ providers: 1, blocked: () => blocked });
    try {
      blocked = [f.identities[1].peerId];
      await vi.waitFor(() => expect(f.requester.getSwarmSnapshot().peers[0].blocked).toBe(true));
      expect(f.requester.hasAvailableProvider('model')).toBe(false);
      await expect(f.ask()).rejects.toThrow('No remote host slot available');
      expect(f.requestsTo()).toEqual([]);
      blocked = [];
      expect((await f.ask()).content).toBe('answer from 1');
    } finally { await f.close(); }
  });

  it('does not count a blocked computer as capacity for its model', () => {
    const model = { id: 'model', identity: modelIdentity };
    const peer = { peerId: 'a', model: 'model', modelIdentity, readiness: 'ready', hasInference: true, availableSlots: 1 };
    expect(projectChatCatalog({ models: [model], peers: [peer] })[0]).toMatchObject({ availability: 'ready', providerIds: ['a'] });
    expect(projectChatCatalog({ models: [model], peers: [{ ...peer, blocked: true }] })[0])
      .toMatchObject({ availability: 'unavailable', providerIds: [] });
  });
});

describe('blocked computers in local preferences', () => {
  it('stores the verified identity, restores it, and unblocks by either id', async () => {
    const store = storage();
    const preferences = createComputerPreferences({ storage: store, verifyPeer: async () => key });
    await preferences.block('wire-a');
    expect(preferences.getBlocked()).toEqual([key]);
    await preferences.block('wire-b', { participantId: key });
    expect(preferences.getState().blocked).toEqual([key]);
    expect(JSON.parse(store.values.get(policy.storageKey)).blocked).toEqual([key]);
    const restored = createComputerPreferences({ storage: store });
    expect(restored.getBlocked()).toEqual([key]);
    restored.unblock('wire-c', { participantId: key });
    expect(restored.getBlocked()).toEqual([]);
    expect(createComputerPreferences({ storage: store }).getBlocked()).toEqual([]);
  });

  it('falls back to the connection id when no identity can be proven, and keeps saved names', async () => {
    const store = storage();
    const named = createComputerPreferences({ storage: store, verifyPeer: async () => key });
    await named.rename('wire', 'Desk');
    const preferences = createComputerPreferences({ storage: store, verifyPeer: async () => { throw new Error('no proof'); } });
    await preferences.block('wire-a');
    expect(preferences.getBlocked()).toEqual(['wire-a']);
    expect(preferences.getState().names).toEqual({ [key]: 'Desk' });
    preferences.unblock('wire-a');
    expect(preferences.getBlocked()).toEqual([]);
  });

  it('reads a store written before blocking existed and rejects a malformed list', () => {
    const store = storage();
    store.setItem(policy.storageKey, JSON.stringify({ schema: policy.schema, names: {}, baseline: null }));
    expect(createComputerPreferences({ storage: store }).getBlocked()).toEqual([]);
    store.setItem(policy.storageKey, JSON.stringify({ schema: policy.schema, names: {}, baseline: null, blocked: ['a', 'a'] }));
    const invalid = createComputerPreferences({ storage: store });
    expect(invalid.getBlocked()).toEqual([]); expect(invalid.getState().error).toContain('blocked');
  });

  it('does not block when storage is unavailable', async () => {
    const preferences = createComputerPreferences({ storage: null });
    await expect(preferences.block('wire-a')).rejects.toThrow('not saved');
    expect(preferences.getBlocked()).toEqual([]);
  });
});

describe('Computers panel block control', () => {
  it('blocks and unblocks from the row, shows Blocked, and stops counting the computer as ready', async () => {
    const state = { models: [], network: { connections: [{ id: 'wire', attemptId: '1', phase: 'connected' }],
      consumer: { peers: [{ peerId: 'wire', attemptId: '1', participantId: key, identityVerified: true, model: 'Qwen', readiness: 'ready' }] } } };
    const session = { getState: () => state, subscribe(listener) { listener(state); return () => {}; } };
    const store = storage(), preferences = createComputerPreferences({ storage: store, verifyPeer: async () => key });
    const root = document.createElement('div');
    root.innerHTML = renderConnectionControl() + renderSharingControls() + renderComputerDiagnostic()
      + '<div><p data-peer-readiness></p><ul data-insp-device-list></ul></div><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
    const dispose = bindNetworkControls(root, session, { computers: preferences });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      const row = root.querySelector('[data-computer-id="wire"]'), button = row.querySelector('details [data-computer-block-toggle]');
      expect(button.textContent).toBe('Block'); expect(row.querySelector('[data-computer-block]').hidden).toBe(false);
      expect(root.querySelector('[data-peer-readiness]').textContent).toContain('1 computer ready');
      button.click(); await settle();
      expect(preferences.getBlocked()).toEqual([key]);
      expect(row.querySelector('[data-computer-status]').textContent).toBe('Blocked');
      expect(row.dataset.blocked).toBe('true'); expect(button.textContent).toBe('Unblock');
      expect(row.querySelector('[data-computer-block-note]').textContent).toContain('can still see the network');
      expect(root.querySelector('[data-peer-readiness]').textContent).toContain('0 computers ready');
      button.click(); await settle();
      expect(preferences.getBlocked()).toEqual([]);
      expect(row.querySelector('[data-computer-status]').textContent).toBe('Ready'); expect(button.textContent).toBe('Block');
    } finally { dispose(); await preferences.close(); }
  });

  it('marks a row the mesh reports as blocked, and offers no control without a preferences store', () => {
    const state = { models: [], network: { consumer: { peers: [{ peerId: 'wire', model: 'Qwen', readiness: 'ready', blocked: true }] } } };
    expect(projectNetworkPeers(state)[0]).toMatchObject({ blocked: true, phase: 'blocked', status: 'Blocked' });
    expect(projectNetworkPeers({ ...state, blockedComputers: new Set(['other']) })[0].blocked).toBe(true);
    const session = { getState: () => state, subscribe(listener) { listener(state); return () => {}; } };
    const root = document.createElement('div');
    root.innerHTML = renderConnectionControl() + renderSharingControls()
      + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
    const dispose = bindNetworkControls(root, session);
    try { expect(root.querySelector('[data-computer-block]').hidden).toBe(true); } finally { dispose(); }
  });
});
