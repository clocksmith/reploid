/** Explicit compatibility text swarm, separate from admitted signed Pack operations. */
import { createLegacyGenerationMesh, createPartitionNetwork, createAutomaticPartitions } from '../vendor/reploid/mesh/index.js';
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
import { createWorkAdapterResolver } from '../providers/work-adapter.js';
import { createWorkPeerOffers } from './work-peer-offers.js';
import { createWorkModelFiles } from './work-model-files.js';
import { loadWorkPartition } from './work-partitions.js';
import partitionPolicy from '../config/partition-policy.json' with { type: 'json' };

export function createWorkSwarm({ storage, evolution, onChange = () => {}, service = createReploidDopplerRuntimeService(), networkOptions = createLegacyNetworkOptions,
  createModelFiles = createWorkModelFiles, createPartitions = createAutomaticPartitions }) {
  const utils = Utils.factory({}), eventBus = EventBus.factory({ Utils: utils });
  const options = networkOptions({ Utils: utils, EventBus: eventBus }, { enabled: true });
  let consumer = null, supplier = null, closed = false, sharing = false, stopping = false, connecting = false, error = '';
  let connection = null;
  let disconnecting = null, sharingConnection = null, generation = 0, paused = false;
  let automaticAllowed = options.autoConnect !== false;
  const requests = new Map(), partitionNetworks = new Set();
  let consumerTransport = null;
  let modelFiles = null, partitionMesh = null, consumerIdentity = null;
  const partitionListeners = new Set();
  const partitions = Object.freeze({
    getModels: () => partitionMesh?.getModels() || [],
    subscribe(listener) { partitionListeners.add(listener); listener(this.getModels()); return () => partitionListeners.delete(listener); },
    generate(request, controls) {
      if (!partitionMesh) throw new Error('Partition discovery is unavailable');
      return partitionMesh.generate(request, controls);
    }
  });
  let contributor = null, stoppingContribution = null, contributionEpoch = 0;
  let contribution = { phase: 'idle', completed: 0, modelId: null, modelIdentity: null, progress: null };
  const getState = () => ({ sharing, stopping, connecting, paused, error, models: LOCAL_DOPPLER_MODELS,
    discoveryScope: options.discoveryScope,
    contribution: { ...contribution }, limits: { maxInboundJobs: contribution.partition ? partitionPolicy.limits.maxConcurrentAttempts : 1, maxOutputTokens: profile.generation.maxTokens },
    consumer: consumer?.getSwarmSnapshot() || null, supplier: supplier?.getSwarmSnapshot() || null,
    offers: peerOffers?.getState() || null });
  const notify = () => onChange(getState());
  const peerOffers = evolution ? createWorkPeerOffers({ storage, evolution, roomId: options.config.value.mesh.roomId,
    getTransport: () => consumerTransport, onChange: notify }) : null;
  eventBus.on('swarm:peer-connected', () => modelFiles?.announce());
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
          modelIdentity: state?.modelIdentity || null, adapterIdentities: state?.adapterIdentities || [] };
      },
      createTransport: () => {
        if (closed || paused || version !== generation) throw new Error('Text swarm connection stopped');
        const transport = createSwarmTransport({ ...options, config, ...(peerId ? { peerId } : {}) });
        if (!model) consumerTransport = transport;
        return transport;
      },
      identity: { ensure: async input => {
        const bundle = await ensureIdentityBundle({ ...input, storage });
        if (!model) consumerIdentity = bundle; return bundle;
      },
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
          modelIdentity: peer.modelIdentity, adapterIdentities: request.adapterIdentities || [], providerId: peer.peerId,
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
        const adapters = (controls.adapterIdentities || []).map(identity => {
          const selected = model.adapters?.find(adapter => adapter.identity === identity);
          if (!selected) throw new Error('Adapter contribution is not authorized');
          return selected;
        });
        return execution.generate(messages, onUpdate, { ...controls, adapters });
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
        modelFiles = createModelFiles({ getTransport: () => consumerTransport, onChange: notify });
        await modelFiles.attach();
        partitionMesh = createPartitions({ identity: consumerIdentity, meshId: options.config.value.mesh.roomId,
          models: LOCAL_DOPPLER_MODELS.filter(model => model.source?.files.some(file => file.role === 'model-piece-index')),
          policy: partitionPolicy,
          peers: () => (consumerTransport?.getConnectedPeers() || []).map(peer => ({ ...peer, localTransportId: consumerTransport._getPeerId() })),
          createNetwork: openPartitionNetwork,
          loadProgram: (model, index, controls) => loadWorkPartition(modelFiles, model, index, controls),
          onChange(state) {
            if (state.offering || contribution.partition) {
              sharing = state.offering;
              contribution = { ...state, partition: true, completed: 0, modelIdentity: state.descriptor?.modelIdentity };
              if (state.error) error = state.error;
            }
            for (const listener of partitionListeners) listener(partitionMesh?.getModels() || []);
            notify();
          }
        });
        if (closed || paused || version !== generation) { await modelFiles.close(); throw new Error('File exchange connection stopped'); }
      } else await consumer.connect();
      return getState();
    }
    catch (cause) { await partitionMesh?.close(); partitionMesh = null; peerOffers?.close(); await modelFiles?.close(); modelFiles = null; await consumer?.close(); consumer = null; consumerTransport = null; if (version === generation) error = cause.message; throw cause; }
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
        signal: controls.signal, modelId: controls.modelId, modelIdentity: controls.modelIdentity,
        adapterIdentities: controls.adapterIdentities || [], requestContext: { id }
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
    contributionEpoch++;
    if (stoppingContribution) return stoppingContribution;
    sharing = false; stopping = true;
    contribution = { ...contribution, phase: 'stopping' };
    const previous = supplier, execution = contributor, pending = sharingConnection;
    supplier = null; contributor = null;
    // Invalidate the resident before waiting for transport or loader settlement.
    const retiring = execution?.close();
    stoppingContribution = (async () => {
      const results = await Promise.allSettled([retiring, previous?.close(), pending, partitionMesh?.stop()]);
      const cleanupFailure = [results[0], results[3]].find(result => result.status === 'rejected')?.reason || null;
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
    const partitionStop = partitionMesh?.close(); partitionMesh = null;
    const fileStop = modelFiles?.close(); modelFiles = null;
    const previousConsumer = consumer;
    consumer = null; consumerTransport?.disconnect(); consumerTransport = null;
    peerOffers?.close();
    const networkStops = [...partitionNetworks].map(network => network.close()); partitionNetworks.clear();
    const pending = [connection, contributionStop, previousConsumer?.close(), fileStop, partitionStop, ...networkStops];
    disconnecting = (async () => {
      const results = await Promise.allSettled(pending);
      peerOffers?.close();
      if (results[1].status === 'rejected') throw results[1].reason;
      if (results[3].status === 'rejected') throw results[3].reason;
      const partitionFailures = results.slice(4).filter(result => result.status === 'rejected').map(result => result.reason);
      if (partitionFailures.length) throw new AggregateError(partitionFailures, 'Partition network settlement failed');
    })().finally(() => { disconnecting = null; connecting = false; notify(); });
    notify();
    return disconnecting;
  };
  function openPartitionNetwork({ createEndpoint, maxPeers, timeoutMs, onPeer, label }) {
      if (closed || paused || !consumerTransport || !consumer) throw new Error('Connect before opening partition channels');
      const owner = consumer;
      const network = createPartitionNetwork({ transport: consumerTransport,
        verifyPeer: (peerId, signal) => owner.verifyPeerIdentity(peerId, signal), createEndpoint, maxPeers, timeoutMs, onPeer, label });
      const ownerNetwork = Object.freeze({ ...network,
        async close() { try { await network.close(); } finally { partitionNetworks.delete(ownerNetwork); } }
      });
      partitionNetworks.add(ownerNetwork);
      return ownerNetwork;
    }
  return Object.freeze({ getState, connect, disconnect, partitions,
    getPartitionState: () => partitionMesh?.getState() || null,
    getFileState: () => modelFiles?.getState() || { sharing: false, preparing: false },
    async shareFiles(model, approved) {
      await connect({ automatic: true });
      await modelFiles.share(model, approved, { retainedOnly: contribution.partition === true });
    },
    stopFiles: () => modelFiles?.stop(),
    autoConnectEnabled: () => !closed && !paused && automaticAllowed,
    getInviteUrl: () => options.getInviteUrl(),
    generate,
    hasProvider: modelId => !!consumer?.hasAvailableProvider(modelId),
    allowCandidateOffers: allowed => peerOffers?.allowReceiving(allowed),
    sendCandidate: (candidateId, recipient) => peerOffers.send(candidateId, recipient),
    retryCandidate: transferId => peerOffers.retry(transferId),
    previewCandidate: transferId => peerOffers.preview(transferId),
    dismissCandidate: transferId => peerOffers.dismiss(transferId),
    createPartitionNetwork: openPartitionNetwork,
    async share(modelId, approved, adapters = []) {
      if (closed || supplier || stopping || sharingConnection) throw new Error('Stop existing sharing first');
      if (approved !== true) throw new Error('Approve public prompt execution before sharing');
      const base = LOCAL_DOPPLER_MODELS.find(item => item.id === modelId);
      if (!base) throw new Error('Select an available local model');
      if (base.source?.files.some(file => file.role === 'model-piece-index')) {
        if (adapters.length) throw new Error('This partition plan does not support adapters');
        if (!navigator.gpu) throw new Error('This browser does not support WebGPU');
        const version = generation, epoch = contributionEpoch;
        sharingConnection = Promise.resolve().then(async () => {
          if (closed || paused || version !== generation || epoch !== contributionEpoch) throw new Error('Contribution stopped');
          await connect({ automatic: true });
          if (closed || paused || version !== generation || epoch !== contributionEpoch) throw new Error('Contribution stopped');
          if (!partitionMesh) throw new Error('Connect before contributing compute');
          await partitionMesh.contribute(modelId, approved);
        }).finally(() => { sharingConnection = null; notify(); });
        return sharingConnection;
      }
      if (!Array.isArray(adapters) || adapters.length > 1) throw new Error('Select at most one adapter');
      const model = { ...base, adapters: adapters.map(selected => {
        const entry = base.availableAdapters?.find(adapter => adapter.identity === selected.identity);
        if (!entry) throw new Error('Adapter is not in the contributor catalog');
        return structuredClone(entry);
      }) };
      if (!navigator.gpu) throw new Error('This browser does not support WebGPU');
      if (disconnecting || paused) throw new Error('Connect before contributing compute');
      const version = generation;
      const epoch = contributionEpoch;
      sharingConnection = Promise.resolve().then(async () => {
        let execution, active;
        try {
          if (closed || paused || version !== generation || epoch !== contributionEpoch) throw new Error('Contribution stopped');
          await connect({ automatic: true });
          if (closed || paused || version !== generation || epoch !== contributionEpoch) throw new Error('Contribution stopped');
          const files = modelFiles;
          execution = createWorkResidentProvider({ model, service, generation: profile.generation,
            resolveSource: (selected, controls) => files.prepareSource(selected, controls),
            resolveAdapter: createWorkAdapterResolver({ models: [base], acquire: files.acquireAdapter }),
            maxOutcomeCharacters: profile.maxOutcomeCharacters, onChange(state) {
              if (contributor !== execution || version !== generation) return;
              contribution = state;
              if (state.phase === 'failed') error = state.error;
              supplier?.refreshAdvertisement(); notify();
            } });
          contributor = execution; sharing = true; error = '';
          contribution = { ...execution.getState(), phase: 'loading' };
          active = build(model, undefined, execution); supplier = active; notify();
          await active.connect();
          if (closed || contributor !== execution || version !== generation) throw new Error('Contribution stopped');
          await execution.prepare();
        } catch (cause) {
          await Promise.allSettled([active?.close(), execution?.close()]);
          if (active && supplier === active) {
            supplier = null; contributor = null; sharing = false;
            contribution = { ...execution.getState(), phase: 'failed' }; error = cause.message;
          }
          throw cause;
        } finally { sharingConnection = null; notify(); }
      });
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
