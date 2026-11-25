// @vitest-environment node
// A whole-model mesh of one requester and named providers on a simulated network: each frame takes `latencyMs`,
// and `link(frame)` may drop or duplicate it. `wire` keeps every frame that was sent, dropped or not.
import { expect, vi } from 'vitest';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';

export const MODEL = 'model', MODEL_IDENTITY = 'sha256:' + 'a'.repeat(64);

export async function createLossyMesh({ providers = ['provider'], latencyMs = 5, link = () => 'deliver', mesh = {},
  executeMs = 20, legacy = () => false } = {}) {
  const names = ['requester', ...providers];
  const identities = Object.fromEntries(await Promise.all(names.map(async name => [name, await createSigningIdentity({ algorithm: 'Ed25519' })])));
  const handlers = Object.fromEntries(names.map(name => [name, new Map()]));
  const wire = [], errors = [], executions = [], authorizations = [], receipts = [];
  const meshes = {};
  const binding = (self, peer) => ({ local: `cert:${self}>${peer}`, remote: `cert:${peer}>${self}` });
  const deliver = (from, to, type, payload) => {
    payload = structuredClone(payload);
    // A host that predates the delivery protocol: its advertisement has no delivery version and its
    // frames carry no delivery fields, whichever side it is.
    if (legacy(from)) { delete payload.deliveryProtocol; delete payload.deliveryProtocols; delete payload.delivery; }
    const frame = { from, to, type, payload, at: performance.now() };
    const action = link(frame);
    frame.action = action;
    wire.push(frame);
    if (action === 'drop') return true;
    const copies = action === 'duplicate' ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      setTimeout(async () => {
        try { await handlers[to].get(type)?.(from, structuredClone(payload)); } catch (error) { errors.push(error); }
      }, latencyMs);
    }
    return true;
  };
  for (const name of names) {
    const listeners = new Map(), events = {
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event).delete(fn); },
      emit(event, value) { for (const fn of listeners.get(event) || []) fn(value); }
    };
    const provider = name !== 'requester';
    meshes[name] = createPeerGenerationMesh({
      config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: provider, roomId: 'lossy', ...mesh } } }),
      ports: {
        instanceId: 'instance-' + name, modelConfig: provider ? { id: MODEL } : null, admitsBeforeDisclosure: true,
        getExecutionState: () => ({ phase: provider ? 'ready' : 'idle', modelIdentity: MODEL_IDENTITY, adapterIdentities: [] }),
        authorize: async input => { authorizations.push({ node: name, action: input.action, requestId: input.request?.requestId ?? input.requestId ?? null }); return true; },
        events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
        identity: { ensure: async () => identities[name], sync: async () => {}, save: async () => {} },
        onReceipt: async receipt => { receipts.push({ node: name, receipt }); },
        generate: async (_messages, update, controls) => {
          executions.push({ node: name, requestId: controls.requestId });
          await new Promise(resolve => setTimeout(resolve, executeMs));
          update('actual ');
          update('answer');
          return { model: MODEL, modelIdentity: MODEL_IDENTITY, adapterIdentities: [], content: 'actual answer',
            completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 2, stopReason: 'eos-token' } };
        },
        createTransport: () => ({ init: async () => true, disconnect() {}, getPeerId: () => name,
          getPeerStates: () => names.filter(peer => peer !== name).map(peer => ({ id: peer, attemptId: `attempt:${[name, peer].sort().join('-')}`,
            phase: 'connected', transport: 'webrtc', channelState: 'open' })),
          getPeerBinding: peer => names.includes(peer) && peer !== name ? binding(name, peer) : null,
          onMessage: (type, fn) => handlers[name].set(type, fn),
          broadcast: (type, payload) => { for (const peer of names) if (peer !== name) deliver(name, peer, type, payload); return names.length - 1; },
          sendToPeer: (peer, type, payload) => names.includes(peer) && deliver(name, peer, type, payload) })
      }
    });
  }
  for (const name of names) await meshes[name].connect();
  for (const name of providers) meshes[name].refreshAdvertisement();
  await vi.waitFor(() => expect(meshes.requester.getSwarmSnapshot().peers.filter(peer => peer.readiness === 'ready'))
    .toHaveLength(providers.length));
  const frames = (type, filter = {}) => wire.filter(frame => frame.type === type && Object.entries(filter).every(([key, value]) => frame[key] === value));
  return {
    meshes, identities, wire, errors, executions, authorizations, receipts, frames,
    /** One whole-model request; resolves with the result (or the error) and time to first token from the call. */
    async ask() {
      const startedAt = performance.now();
      let firstTokenMs = null;
      try {
        const result = await meshes.requester.generate([{ role: 'user', content: 'prompt' }], () => {
          firstTokenMs ??= performance.now() - startedAt;
        }, { modelId: MODEL, modelIdentity: MODEL_IDENTITY,
          privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) });
        return { result, firstTokenMs, totalMs: performance.now() - startedAt };
      } catch (error) { return { error, firstTokenMs, totalMs: performance.now() - startedAt }; }
    },
    close: async () => { await Promise.all(Object.values(meshes).map(item => item.close())); }
  };
}
