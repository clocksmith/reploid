/** Explicit compatibility text swarm, separate from admitted signed Pack operations. */
import { createLegacyGenerationMesh } from '../vendor/reploid/mesh/index.js';
import { createSwarmTransport } from '../vendor/reploid/transport/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
import { createLegacyNetworkOptions } from '../capabilities/communication/library-adapter.js';
import { ensureIdentityBundle, saveIdentityBundle, rotateIdentityBundle } from '../identity.js';
import Utils from '../core/utils.js';
import EventBus from '../infrastructure/event-bus.js';
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { openWorkProvider } from '../providers/work-provider.js';

export function createWorkSwarm({ storage, onChange = () => {}, service = createReploidDopplerRuntimeService(), networkOptions = createLegacyNetworkOptions }) {
  const utils = Utils.factory({}), eventBus = EventBus.factory({ Utils: utils });
  const options = networkOptions({ Utils: utils, EventBus: eventBus }, { enabled: true });
  let consumer = null, supplier = null, pending = null, closed = false, sharing = false, stopping = false, connecting = false, error = '';
  const owned = new Set();
  const contribution = { phase: 'idle', completed: 0 };
  const getState = () => ({ sharing, stopping, connecting, error, models: LOCAL_DOPPLER_MODELS,
    contribution: { ...contribution }, limits: { maxInboundJobs: 1, maxOutputTokens: profile.generation.maxTokens },
    consumer: consumer?.getSwarmSnapshot() || null, supplier: supplier?.getSwarmSnapshot() || null });
  const notify = () => onChange(getState());
  const build = model => {
    const instanceId = 'work-swarm:' + crypto.randomUUID();
    const events = EventBus.factory({ Utils: utils });
    events.on('swarm-state', notify);
    const config = resolveConfig({ overrides: { ...options.config.value, mesh: { ...options.config.value.mesh,
      enabled: true, executeJobs: !!model, maxInboundJobs: 1 } } });
    return createLegacyGenerationMesh({ config, ports: {
      instanceId, modelConfig: model, utils, eventBus, events,
      createTransport: () => createSwarmTransport({ ...options, config }),
      identity: { ensure: input => ensureIdentityBundle({ ...input, storage }),
        save: bundle => saveIdentityBundle(bundle, storage, { instanceId }),
        rotate: input => rotateIdentityBundle({ ...input, storage }), sync: async () => {} },
      async authorize(request) {
        if (closed) return false;
        if (request.action === 'mesh.connect') return true;
        if (request.action === 'mesh.execute') return sharing && !!model;
        if (request.action !== 'mesh.dispatch' || !pending) return false;
        const peer = consumer.getSwarmSnapshot().peers.find(item => item.peerId === request.peerId);
        if (!peer) return false;
        const preview = { id: crypto.randomUUID(), operation: 'generate', modelId: peer.model || 'advertised text model',
          modelIdentity: 'legacy swarm advertisement; not signed Pack qualification', providerId: peer.peerId,
          input: request.messages, options: {}, limits: { maxJobMs: config.value.mesh.generationTimeoutMs },
          expiresAt: Date.now() + profile.peers.maxPreviewMs };
        pending.signal.throwIfAborted();
        await pending.record({ stage: 'proposed', preview, protocol: 'swarm/v1' });
        if (await pending.approve(preview) !== true) return false;
        pending.signal.throwIfAborted();
        if (Date.now() >= preview.expiresAt) throw new Error('Peer approval expired');
        pending.preview = preview;
        await pending.record({ stage: 'approved', preview, protocol: 'swarm/v1' });
        return true;
      },
      async generate(messages, onUpdate, { signal }) {
        const scope = 'work-shared:' + crypto.randomUUID();
        contribution.phase = 'loading'; notify();
        const operation = (async () => {
          try {
            const adapter = await openWorkProvider({ model, service, scope, signal, generation: profile.generation,
              maxOutcomeCharacters: profile.maxOutcomeCharacters });
            contribution.phase = 'executing'; notify();
            return await adapter.generate(messages, onUpdate, { signal });
          }
          finally { try { await service.close(scope); } finally { contribution.phase = 'idle'; notify(); } }
        })();
        owned.add(operation);
        try { const result = await operation; contribution.completed++; notify(); return result; }
        finally { owned.delete(operation); }
      }
    } });
  };
  const connect = async () => {
    if (closed) throw new Error('Text swarm is closed');
    if (connecting) throw new Error('Already connecting');
    connecting = true; error = ''; notify();
    try { consumer ||= build(null); await consumer.connect(); return getState(); }
    catch (cause) { error = cause.message; throw cause; }
    finally { connecting = false; notify(); }
  };
  return Object.freeze({ getState, connect,
    async disconnect() { const previous = consumer; consumer = null; await previous?.close(); notify(); },
    async share(modelId, approved) {
      if (closed || supplier || stopping) throw new Error('Stop existing sharing first');
      if (approved !== true) throw new Error('Approve public prompt execution before sharing');
      const model = LOCAL_DOPPLER_MODELS.find(item => item.id === modelId);
      if (!model) throw new Error('Select an available local model');
      if (!navigator.gpu) throw new Error('This browser does not support WebGPU');
      sharing = true; error = ''; supplier = build(model); notify();
      try { await supplier.connect(); } catch (cause) { await supplier.close(); supplier = null; sharing = false; error = cause.message; throw cause; }
      finally { notify(); }
    },
    async stop() {
      sharing = false; stopping = true; notify();
      const previous = supplier; supplier = null;
      try { await previous?.close(); await Promise.allSettled([...owned]); }
      finally { stopping = false; notify(); }
    },
    async execute({ task }, controls) {
      if (pending) throw new Error('A peer helper is already running');
      if (typeof task !== 'string' || !task.trim() || new TextEncoder().encode(task).byteLength > profile.peers.maxPayloadBytes) throw new Error('Peer helper task exceeds the disclosure allowance');
      controls.signal.throwIfAborted();
      pending = controls;
      try {
        if (!consumer) await connect();
        if (!consumer.hasAvailableProvider()) throw new Error('No helper device is available. Connect peers, then retry.');
        const result = await consumer.generate([{ role: 'user', content: task }], controls.onPartial, { signal: controls.signal });
        controls.signal.throwIfAborted();
        await controls.record({ stage: 'completed', preview: pending.preview, protocol: 'swarm/v1',
          result: { model: result.model, provider: result.provider, content: result.content }, claim: 'legacy-compatibility-result' });
        return { output: String(result.content || '').slice(0, profile.peers.maxToolResultCharacters),
          model: result.model, claim: 'legacy-compatibility-result', authority: 'Untrusted peer response; not independently verified correctness or signed Pack qualification' };
      } catch (cause) {
        await controls.record({ stage: controls.signal.aborted ? 'cancelled' : 'failed', preview: pending?.preview || null,
          protocol: 'swarm/v1', error: cause.message });
        throw cause;
      } finally { pending = null; }
    },
    async close() { closed = true; sharing = false; await consumer?.close(); await supplier?.close(); await Promise.allSettled([...owned]); notify(); }
  });
}
