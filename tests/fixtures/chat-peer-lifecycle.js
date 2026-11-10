import { vi, expect } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';
import profile from '../../apps/poolday/config/work-profile.json';

// Real workspace, execution adapter, mesh identity and receipt code. Transport and
// inference are controlled ports; this fixture does not qualify a physical model.
export async function createChatPeerLifecycle() {
  const identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  const adapter = { id: 'specialist', identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64) };
  const model = { id: 'model', name: 'Fixture model', provider: 'doppler', identity: adapter.baseModelIdentity,
    adapters: [adapter], availableAdapters: [adapter] };
  const endpoints = identities.map((identity, i) => ({ identity, id: 'connection-' + i, handlers: new Map(),
    listeners: new Map(), online: true, state: { phase: i ? 'ready' : 'idle', modelIdentity: model.identity,
      adapterIdentities: [adapter.identity], hardware: { vendor: 'Fixture', description: 'Reported GPU ' + i } } }));
  const wire = [], errors = [], calls = [], results = [], pending = new Map();
  let beforeApproval = async () => {}, run = async call => { call.update('answer'); return 'answer'; };
  const deliver = (from, to, type, payload) => {
    if (!endpoints[from].online || !endpoints[to].online) return false;
    payload = structuredClone(payload); wire.push({ from, to, type, payload });
    queueMicrotask(() => Promise.resolve(endpoints[to].handlers.get(type)?.(endpoints[from].id, payload)).catch(error => errors.push(error)));
    return true;
  };
  const meshes = endpoints.map((endpoint, i) => {
    const events = {
      on(name, fn) { if (!endpoint.listeners.has(name)) endpoint.listeners.set(name, new Set()); endpoint.listeners.get(name).add(fn); return () => endpoint.listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of endpoint.listeners.get(name) || []) fn(value); }
    };
    endpoint.events = events;
    return createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: {
      enabled: true, executeJobs: i > 0, roomId: 'track-a-controlled', generationTimeoutMs: 1500
    } } }), ports: {
      instanceId: endpoint.id, modelConfig: i ? { id: model.id } : null,
      getExecutionState: () => endpoint.state, events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => endpoint.identity, sync: async () => {}, save: async () => {} },
      async authorize(request) {
        if (request.action !== 'mesh.dispatch') return true;
        const controls = pending.get(request.requestContext?.id);
        if (!controls) return false;
        const preview = { id: crypto.randomUUID(), operation: 'generate', disclosure: 'public',
          modelId: request.modelId, modelIdentity: request.modelIdentity, adapterIdentities: request.adapterIdentities,
          providerId: request.peerId, recipientIdentity: request.recipientIdentity, input: request.messages, expiresAt: Date.now() + 10000 };
        controls.preview = preview;
        await beforeApproval(request);
        if (!await controls.approve(preview)) return false;
        await controls.record({ stage: 'approved', preview });
        return true;
      },
      async generate(messages, update, controls) {
        const call = { index: i, messages: structuredClone(messages), update, controls }; calls.push(call);
        const content = await run(call);
        return { model: model.id, provider: 'doppler', modelIdentity: endpoint.state.modelIdentity, hardware: structuredClone(endpoint.state.hardware),
          adapterIdentities: [...endpoint.state.adapterIdentities], content,
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
      },
      createTransport: () => ({ init: async () => true, disconnect() {}, _getPeerId: () => endpoint.id,
        getPeerBinding: peer => ({ local: 'certificate-' + i, remote: 'certificate-' + endpoints.findIndex(item => item.id === peer) }),
        onMessage: (type, fn) => endpoint.handlers.set(type, fn),
        broadcast: (type, payload) => endpoints.forEach((_, to) => { if (to !== i) deliver(i, to, type, payload); }),
        sendToPeer: (peer, type, payload) => deliver(i, endpoints.findIndex(item => item.id === peer), type, payload) })
    } });
  });
  for (const mesh of meshes) await mesh.connect();
  meshes.slice(1).forEach(mesh => mesh.refreshAdvertisement());
  await vi.waitFor(() => expect(meshes[0].getSwarmSnapshot().peers.filter(peer => peer.readiness === 'ready')).toHaveLength(2));
  // Host-port bridge mirrors work-swarm's preview/record contract; no discovery or GPU service is started.
  const swarm = { connect: async () => {}, hasProvider: () => true,
    async generate(messages, controls) {
      const id = crypto.randomUUID(), item = { ...controls }; pending.set(id, item);
      try {
        const result = await meshes[0].generate(messages, controls.onPartial, { signal: controls.signal,
          modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: controls.adapterIdentities, requestContext: { id } });
        results.push(structuredClone(result));
        return { ...result, peerId: item.preview.providerId };
      } finally { pending.delete(id); }
    }
  };
  const service = { open: vi.fn(() => { throw Error('Local fallback forbidden'); }), close: vi.fn() };
  const execution = createChatExecution({ service, swarm, models: [model], getModels: () => [model], profile });
  let saved;
  const store = { load: () => structuredClone(saved), save: value => { saved = structuredClone(value); } };
  const open = () => createChatWorkspace({ meshId: 'track-a-controlled', participantId: identities[0].peerId,
    store, execute: execution.execute });
  let app = open();
  return { model, adapter, endpoints, meshes, calls, results, wire, errors, service, store,
    get app() { return app; }, setRun(fn) { run = fn; }, setBeforeApproval(fn) { beforeApproval = fn; },
    async reload() { await app.close(); app = open(); },
    async advertise(index, update) {
      Object.assign(endpoints[index].state, update); meshes[index].refreshAdvertisement();
      const expected = { ...update };
      if (expected.phase) { expected.readiness = expected.phase; delete expected.phase; }
      await vi.waitFor(() => expect(meshes[0].getSwarmSnapshot().peers.find(peer => peer.peerId === endpoints[index].id)).toMatchObject(expected));
    },
    lose(index) {
      endpoints[index].online = false;
      endpoints[0].events.emit('swarm:peer-disconnected', { peerId: endpoints[index].id });
    },
    async close() { await app.close(); await execution.close(); await Promise.all(meshes.map(mesh => mesh.close())); }
  };
}
