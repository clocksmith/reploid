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
import { createWorkResidentProvider } from '../providers/work-resident-provider.js';
import { createWorkPeerOffers } from './work-peer-offers.js';

export function createWorkSwarm({ storage, evolution, onChange = () => {}, service = createReploidDopplerRuntimeService(), networkOptions = createLegacyNetworkOptions }) {
  const utils = Utils.factory({}), eventBus = EventBus.factory({ Utils: utils });
  const options = networkOptions({ Utils: utils, EventBus: eventBus }, { enabled: true });
  let consumer = null, supplier = null, closed = false, sharing = false, stopping = false, connecting = false, error = '';
  let connection = null;
  let disconnecting = null, sharingConnection = null, generation = 0, paused = false;
  let automaticAllowed = options.autoConnect !== false;
  const requests = new Map();
  let consumerTransport = null;
  let contributor = null, stoppingContribution = null;
  let contribution = { phase: 'idle', completed: 0, modelId: null, modelIdentity: null, progress: null };
  const getState = () => ({ sharing, stopping, connecting, paused, error, models: LOCAL_DOPPLER_MODELS,
    discoveryScope: options.discoveryScope,
    contribution: { ...contribution }, limits: { maxInboundJobs: 1, maxOutputTokens: profile.generation.maxTokens },
    consumer: consumer?.getSwarmSnapshot() || null, supplier: supplier?.getSwarmSnapshot() || null,
    offers: peerOffers?.getState() || null });
  const notify = () => onChange(getState());
  const peerOffers = evolution ? createWorkPeerOffers({ storage, evolution, roomId: options.config.value.mesh.roomId,
    getTransport: () => consumerTransport, onChange: notify }) : null;
  const build = (model, peerId, execution = null) => {
    const version = generation;
    const instanceId = 'work-swarm:' + crypto.randomUUID();
    const events = EventBus.factory({ Utils: utils });
    events.on('swarm-state', notify);
    const config = resolveConfig({ overrides: { ...options.config.value, mesh: { ...options.config.value.mesh,
      enabled: true, executeJobs: !!model, maxInboundJobs: 1 } } });
    return createLegacyGenerationMesh({ config, ports: {
      instanceId, modelConfig: model, utils, eventBus, events,
      getExecutionState: () => {
        const state = execution?.getState();
        return { phase: sharing && state?.ready ? 'ready' : state?.phase || 'idle',
          modelIdentity: state?.modelIdentity || null };
      },
      createTransport: () => {
        if (closed || paused || version !== generation) throw new Error('Text swarm connection stopped');
        const transport = createSwarmTransport({ ...options, config, ...(peerId ? { peerId } : {}) });
        if (!model) consumerTransport = transport;
        return transport;
      },
      identity: { ensure: input => ensureIdentityBundle({ ...input, storage }),
        save: bundle => saveIdentityBundle(bundle, storage, { instanceId }),
        rotate: input => rotateIdentityBundle({ ...input, storage }), sync: async () => {} },
      async authorize(request) {
        if (closed) return false;
        if (request.action === 'mesh.connect') return true;
        if (request.action === 'mesh.execute') return sharing && contributor === execution && execution?.getState().ready === true;
        const pending = requests.get(request.requestContext?.id);
        if (request.action !== 'mesh.dispatch' || !pending) return false;
        const peer = consumer.getSwarmSnapshot().peers.find(item => item.peerId === request.peerId);
        if (!peer) return false;
        const preview = { id: crypto.randomUUID(), operation: 'generate', modelId: peer.model || 'advertised text model',
          modelIdentity: peer.modelIdentity, adapterIdentities: [], providerId: peer.peerId,
          recipientIdentity: request.recipientIdentity || null, disclosure: 'public',
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
      generate: (messages, onUpdate, controls) => {
        if (!sharing || contributor !== execution) throw new Error('Contributor model is not ready');
        return execution.generate(messages, onUpdate, controls);
      }
    } });
  };
  const connectOnce = async () => {
    if (closed) throw new Error('Text swarm is closed');
    const version = generation;
    connecting = true; error = ''; notify();
    try {
      if (!consumer) {
        const peerId = await peerOffers?.acquire();
        if (closed || paused || version !== generation) throw new Error('Text swarm connection stopped');
        consumer = build(null, peerId);
        const active = consumer;
        await active.connect();
        if (closed || paused || version !== generation) { await active.close(); throw new Error('Text swarm connection stopped'); }
        await peerOffers?.attach();
      } else await consumer.connect();
      return getState();
    }
    catch (cause) { peerOffers?.close(); await consumer?.close(); consumer = null; consumerTransport = null; if (version === generation) error = cause.message; throw cause; }
    finally { connecting = false; notify(); }
  };
  const connect = async ({ automatic = false } = {}) => {
    if (disconnecting) await disconnecting;
    if (closed) throw new Error('Text swarm is closed');
    if (automatic && (!automaticAllowed || paused)) return getState();
    if (!automatic) {
      paused = false; automaticAllowed = true;
      storage?.setItem('REPLOID_SWARM_ENABLED', 'true');
    }
    if (!connection) connection = connectOnce().finally(() => { connection = null; });
    return connection;
  };
  const generate = async (messages, controls) => {
    if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > profile.peers.maxInferencePayloadBytes) {
      throw new Error('Request exceeds the peer disclosure allowance');
    }
    controls.signal.throwIfAborted();
    const id = crypto.randomUUID(), pending = { ...controls };
    requests.set(id, pending);
    try {
      await connect({ automatic: true });
      if (!consumer) throw new Error('Peer discovery is stopped');
      const result = await consumer.generate(messages, controls.onPartial, {
        signal: controls.signal, modelId: controls.modelId, modelIdentity: controls.modelIdentity, requestContext: { id }
      });
      controls.signal.throwIfAborted();
      if (typeof result.content !== 'string' || !result.content.trim() || result.content.length > profile.maxOutcomeCharacters) {
        throw new Error('Peer response exceeds the text result contract');
      }
      await controls.record({ stage: 'completed', preview: pending.preview, protocol: 'swarm/v1',
        result: { model: result.model, provider: result.provider, content: result.content }, claim: 'legacy-compatibility-result' });
      return { ...result, requestedModel: controls.modelId || pending.preview?.modelId,
        peerId: pending.preview?.providerId, execution: 'peer-whole-request' };
    } catch (cause) {
      await controls.record({ stage: controls.signal.aborted ? 'cancelled' : 'failed', preview: pending.preview || null,
        protocol: 'swarm/v1', error: cause.message });
      throw cause;
    } finally { requests.delete(id); }
  };
  const stopContribution = () => {
    if (stoppingContribution) return stoppingContribution;
    sharing = false; stopping = true;
    contribution = { ...contribution, phase: 'stopping' };
    const previous = supplier, execution = contributor, pending = sharingConnection;
    supplier = null; contributor = null;
    // Invalidate the resident before waiting for transport or loader settlement.
    const retiring = execution?.close();
    stoppingContribution = (async () => {
      const results = await Promise.allSettled([retiring, previous?.close(), pending]);
      const cleanupFailure = results[0]?.status === 'rejected' ? results[0].reason : null;
      contribution = { ...contribution, phase: cleanupFailure ? 'failed' : 'idle' };
      if (cleanupFailure) { error = cleanupFailure.message; throw cleanupFailure; }
    })().finally(() => { stoppingContribution = null; stopping = false; notify(); });
    notify(); return stoppingContribution;
  };
  const disconnect = ({ automatic = false } = {}) => {
    if (!automatic) { paused = true; storage?.setItem('REPLOID_SWARM_ENABLED', 'false'); }
    if (disconnecting) return disconnecting;
    generation++;
    const contributionStop = stopContribution();
    const previousConsumer = consumer;
    consumer = null; consumerTransport?.disconnect(); consumerTransport = null;
    peerOffers?.close();
    const pending = [connection, contributionStop, previousConsumer?.close()];
    disconnecting = (async () => {
      const results = await Promise.allSettled(pending);
      peerOffers?.close();
      if (results[1].status === 'rejected') throw results[1].reason;
    })().finally(() => { disconnecting = null; connecting = false; notify(); });
    notify();
    return disconnecting;
  };
  return Object.freeze({ getState, connect, disconnect,
    autoConnectEnabled: () => !closed && !paused && automaticAllowed,
    getInviteUrl: () => options.getInviteUrl(),
    generate,
    hasProvider: modelId => !!consumer?.hasAvailableProvider(modelId),
    allowCandidateOffers: allowed => peerOffers?.allowReceiving(allowed),
    sendCandidate: (candidateId, recipient) => peerOffers.send(candidateId, recipient),
    retryCandidate: transferId => peerOffers.retry(transferId),
    previewCandidate: transferId => peerOffers.preview(transferId),
    dismissCandidate: transferId => peerOffers.dismiss(transferId),
    async share(modelId, approved) {
      if (closed || supplier || stopping || sharingConnection) throw new Error('Stop existing sharing first');
      if (approved !== true) throw new Error('Approve public prompt execution before sharing');
      const model = LOCAL_DOPPLER_MODELS.find(item => item.id === modelId);
      if (!model) throw new Error('Select an available local model');
      if (!navigator.gpu) throw new Error('This browser does not support WebGPU');
      if (disconnecting || paused) throw new Error('Connect before contributing compute');
      const version = generation;
      const execution = createWorkResidentProvider({ model, service, generation: profile.generation,
        maxOutcomeCharacters: profile.maxOutcomeCharacters, onChange(state) {
          if (contributor !== execution || version !== generation) return;
          contribution = state;
          if (state.phase === 'failed') error = state.error;
          supplier?.refreshAdvertisement(); notify();
        } });
      contributor = execution; sharing = true; error = '';
      contribution = { ...execution.getState(), phase: 'loading' };
      const active = build(model, undefined, execution); supplier = active; notify();
      sharingConnection = (async () => {
        try {
          await active.connect();
          if (closed || contributor !== execution || version !== generation) throw new Error('Contribution stopped');
          await execution.prepare();
        } catch (cause) {
          await Promise.allSettled([active.close(), execution.close()]);
          if (supplier === active) {
            supplier = null; contributor = null; sharing = false;
            contribution = { ...execution.getState(), phase: 'failed' }; error = cause.message;
          }
          throw cause;
        } finally { sharingConnection = null; notify(); }
      })();
      await sharingConnection;
    },
    stop: stopContribution,
    async execute({ task }, controls) {
      if (typeof task !== 'string' || !task.trim() || new TextEncoder().encode(task).byteLength > profile.peers.maxPayloadBytes) throw new Error('Peer helper task exceeds the disclosure allowance');
        const result = await generate([{ role: 'user', content: task }], controls);
        return { output: String(result.content || '').slice(0, profile.peers.maxToolResultCharacters),
          model: result.model, claim: 'legacy-compatibility-result', authority: 'Untrusted peer response; not independently verified correctness or signed Pack qualification' };
    },
    async close() { closed = true; await disconnect({ automatic: true }); }
  });
}
