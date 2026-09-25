import { createRemoteGenerationRequests } from './remote-generation-requests.js';
import { createMeshPeerIdentity } from './peer-identity.js';
import { requireResolvedConfig, snapshotJson } from '../config/index.js';
import { createPeerAdvertisement, createSwarmController } from './swarm-coordination.js';
import { rankProviderPeers, applyReceiptToContribution } from './contribution.js';
import { createReceiptDraft, countersignReceipt, signReceiptDraft, verifyReceipt } from '../artifacts/receipt.js';

const estimateTokens = text => Math.ceil((typeof text === 'string' ? text : JSON.stringify(text)).length / 4);

// Preserves the legacy swarm-generation protocol. Receipts are signed records,
// not independent evaluation, durable job replay, or hardware attestation.
export function createLegacyGenerationMesh({ config, ports }) {
  const policy = requireResolvedConfig(config);
  for (const name of ['authorize', 'createTransport', 'generate']) {
    if (typeof ports?.[name] !== 'function') throw new TypeError(`Mesh port ${name} is required`);
  }
  if (!ports.identity || !ports.events || !ports.eventBus || !ports.utils) throw new TypeError('Mesh identity, event and utility ports are required');
  const { instanceId, modelConfig, utils, eventBus } = ports;
  const bridgeEvents = ports.events;
  const swarmEnabled = policy.mesh.enabled;
  const REMOTE_GENERATION_TIMEOUT_MS = policy.mesh.generationTimeoutMs;
  const swarmController = createSwarmController();
  const receiptHistory = [];
  const inbound = new Map(), completed = new Map();
  const subscriptions = [];
  const providerWaiters = new Set();
  const reservedProviders = new Set();
  let closed = false, identityBundle = null, swarmTransport = ports.transport || null;
  let peerIdentity = null;
  let pendingFreshIdentity = ports.forceFreshIdentity === true;
  const remoteRequests = createRemoteGenerationRequests({ timeoutMs: REMOTE_GENERATION_TIMEOUT_MS,
    maxPending: policy.mesh.maxPendingJobs,
    sendCancel: (peerId, requestId) => swarmTransport?.sendToPeer(peerId, 'reploid:generation-cancel', { requestId }) });
  let swarmInitPromise = null, swarmInitialized = false, swarmHandlersRegistered = false;
  const executionState = () => ports.getExecutionState?.() || { phase: modelConfig ? 'ready' : 'idle', modelIdentity: null };
  const ready = () => !!modelConfig && executionState().phase === 'ready';
  const chooseCompatibleProvider = (modelId, includeBusy = false, modelIdentity = null) => rankProviderPeers(swarmController.listPeers())
    .find(peer => peer.readiness === 'ready' && (!modelIdentity || peer.modelIdentity === modelIdentity) && (!modelId || peer.model === modelId) && (includeBusy || (!reservedProviders.has(peer.peerId) && peer.availableSlots !== 0))
      && (policy.models.contract === null
      || JSON.stringify(snapshotJson(peer.modelContract ?? null)) === JSON.stringify(policy.models.contract))) || null;

  const getTransportState = () => ({
    connectionState: swarmTransport?.getConnectionState?.() || 'disconnected',
    transport: swarmTransport?.getTransportType?.() || null
  });

  const getSwarmSnapshot = () => ({
    instanceId,
    ...swarmController.getState({
      swarmEnabled,
      hasInference: ready()
    }),
    ...getTransportState(),
    peerId: identityBundle?.peerId || null,
    peers: snapshotJson(swarmController.listPeers())
  });

  const emitSwarmState = () => {
    const snapshot = getSwarmSnapshot();
    bridgeEvents.emit('swarm-state', snapshot);
    if (snapshot.providerCount > 0) {
      bridgeEvents.emit('provider-ready', snapshot);
    }
    return snapshot;
  };

  const syncIdentityDocument = async () => ports.identity.sync(identityBundle, { instanceId, swarmEnabled, hasInference: ready() });

  const advertiseSelf = () => {
    if (closed || !swarmEnabled || !swarmTransport || !identityBundle) return null;
    const advertisement = createPeerAdvertisement({
      peerId: identityBundle.peerId,
      swarmEnabled,
      hasInference: ready(),
      capabilities: ['generation'],
      contribution: identityBundle.contribution,
      updatedAt: Date.now()
    });
    advertisement.model = modelConfig?.id || null;
    advertisement.readiness = executionState().phase;
    advertisement.modelIdentity = executionState().modelIdentity;
    advertisement.availableSlots = ready() ? Math.max(0, policy.mesh.maxInboundJobs - inbound.size) : 0;
    advertisement.modelContract = policy.models.contract;
    advertisement.identityProtocol = 1;
    swarmTransport.broadcast('reploid:peer-advertisement', advertisement);
    return advertisement;
  };

  const updateProviderContribution = async (receipt) => {
    if (!identityBundle) return;
    const priorHistory = [...receiptHistory];
    receiptHistory.push(receipt);
    identityBundle.contribution = applyReceiptToContribution(
      identityBundle.contribution,
      receipt,
      priorHistory
    );
    await ports.identity.save(identityBundle);
    await syncIdentityDocument();
    advertiseSelf();
    emitSwarmState();
  };

  const updateConsumerReceiptCount = async () => {
    if (!identityBundle) return;
    const summary = identityBundle.contribution || {};
    identityBundle.contribution = {
      ...summary,
      receiptsConsumed: Math.max(0, Number(summary.receiptsConsumed || 0)) + 1,
      updatedAt: Date.now()
    };
    await ports.identity.save(identityBundle);
    await syncIdentityDocument();
  };

  const waitForProvider = (modelId, signal, timeoutMs = REMOTE_GENERATION_TIMEOUT_MS, modelIdentity = null) => {
    if (chooseCompatibleProvider(modelId, false, modelIdentity)) return Promise.resolve(true);
    return new Promise(resolve => {
      let unsubscribe = () => {};
      const finish = available => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort);
        providerWaiters.delete(finish); resolve(available);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      providerWaiters.add(finish);
      unsubscribe = bridgeEvents.on('provider-ready', () => { if (chooseCompatibleProvider(modelId, false, modelIdentity)) finish(true); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) finish(false);
    });
  };

  const chooseProvider = async (modelId, signal, modelIdentity) => {
    const deadline = Date.now() + REMOTE_GENERATION_TIMEOUT_MS;
    while (!closed && Date.now() < deadline) {
      signal?.throwIfAborted();
      const provider = chooseCompatibleProvider(modelId, false, modelIdentity);
      if (provider) { reservedProviders.add(provider.peerId); return provider; }
      if (!await waitForProvider(modelId, signal, deadline - Date.now(), modelIdentity)) break;
    }
    signal?.throwIfAborted();
    return null;
  };

  const handlePeerAdvertisement = (remotePeerId, payload = {}) => {
    try { payload = snapshotJson(payload); } catch { return; }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return;
    if (!Number.isFinite(payload.updatedAt)) return;
    const next = swarmController.upsertPeer({
      ...payload,
      peerId: remotePeerId
    });
    if (next) {
      next.model = typeof payload.model === 'string' ? payload.model : null;
      next.readiness = ['loading', 'ready', 'idle', 'failed', 'stopping'].includes(payload.readiness) ? payload.readiness : 'unavailable';
      next.modelIdentity = payload.modelIdentity || null;
      next.availableSlots = Number.isSafeInteger(payload.availableSlots) && payload.availableSlots > 0 ? payload.availableSlots : 0;
      next.modelContract = payload.modelContract || null;
      next.identityProtocol = payload.identityProtocol === 1 ? 1 : null;
    }
    if (next?.role === 'provider') {
      bridgeEvents.emit('provider-ready', next);
    }
    emitSwarmState();
  };

  const handleGenerationUpdate = (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload.requestId, remotePeerId);
    if (!pending || pending.processing) return;
    const chunk = String(payload.chunk || '');
    if (!chunk) return;
    try { pending.onUpdate?.(chunk); }
    catch (error) { remoteRequests.settle(pending, { error, cancel: true }); }
  };

  const handleGenerationResult = async (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload.requestId, remotePeerId);
    if (!pending || pending.processing) return;
    pending.processing = true;
    const current = () => remoteRequests.get(pending.requestId, remotePeerId) === pending;
    try {
      payload = snapshotJson(payload);
      const response = payload.response && typeof payload.response === 'object'
        ? payload.response
        : { content: String(payload.content || ''), raw: String(payload.raw || payload.content || ''),
            model: payload.model || null, provider: payload.provider || null, timestamp: payload.timestamp || Date.now() };
      if ((pending.modelId && response.model !== pending.modelId)
        || (pending.modelIdentity && response.modelIdentity !== pending.modelIdentity)) {
        throw new Error('Remote response substituted the requested model');
      }
      if (payload.receipt) {
        const verified = await verifyReceipt(payload.receipt);
        if (!current()) return;
        if (!verified.valid || payload.receipt.jobHash !== `request:${pending.requestId}`
          || payload.receipt.consumer !== identityBundle?.peerId || payload.receipt.model !== response.model) {
          throw new Error('Remote receipt is invalid or does not bind this request');
        }
        const countersigned = await countersignReceipt(payload.receipt, identityBundle);
        if (!current()) return;
        swarmTransport.sendToPeer(remotePeerId, 'reploid:receipt', { receipt: countersigned });
        await updateConsumerReceiptCount();
      } else if (policy.models.contract !== null) {
        throw new Error('Remote execution receipt is missing');
      }
      remoteRequests.settle(pending, { response });
    } catch (error) { remoteRequests.settle(pending, { error }); }
  };

  const handleGenerationError = (remotePeerId, payload = {}) => {
    remoteRequests.settle(remoteRequests.get(payload.requestId, remotePeerId), {
      error: new Error(String(payload.error || 'Remote generation failed'))
    });
  };

  const handleReceipt = async (_remotePeerId, payload = {}) => {
    if (!payload?.receipt || !identityBundle) return;
    const verification = await verifyReceipt(payload.receipt);
    if (!verification.valid) return;
    if (payload.receipt.provider !== identityBundle.peerId) return;
    await updateProviderContribution(payload.receipt);
  };

  const handleGenerationRequest = async (remotePeerId, payload = {}) => {
    if (closed || !policy.mesh.executeJobs || !ready() || !swarmEnabled || !swarmTransport || !identityBundle) return;

    try { payload = snapshotJson(payload); } catch { return; }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return;
    const requestId = String(payload.requestId || '').trim();
    const consumer = String(payload.consumer || remotePeerId).trim() || remotePeerId;
    const targetProvider = payload.provider ? String(payload.provider).trim() : null;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!requestId || !messages.length) return;
    if (targetProvider && targetProvider !== identityBundle.peerId && targetProvider !== swarmTransport._getPeerId?.()) return;
    if ((payload.model && payload.model !== modelConfig.id)
      || (payload.modelIdentity && payload.modelIdentity !== executionState().modelIdentity)) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Requested model is unavailable' });
      return;
    }
    if (policy.models.contract !== null && JSON.stringify(snapshotJson(payload.modelContract ?? null)) !== JSON.stringify(policy.models.contract)) return;
    if (await ports.authorize({ action: 'mesh.execute', peerId: remotePeerId, request: snapshotJson(payload) }) !== true) return;
    if (closed || !ready()) return;
    const key = `${remotePeerId}:${requestId}`;
    if (completed.has(key)) {
      const previous = completed.get(key);
      swarmTransport.sendToPeer(remotePeerId, previous.type, previous.payload);
      return;
    }
    if (inbound.has(key)) return;
    if (inbound.size >= policy.mesh.maxInboundJobs) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Provider is busy' });
      return;
    }
    const controller = new AbortController();
    inbound.set(key, controller);
    advertiseSelf();
    const deadline = setTimeout(() => controller.abort(new Error('Remote job deadline exceeded')), policy.mesh.generationTimeoutMs);

    try {
      const generated = await ports.generate(messages, (chunk) => {
        if (closed || controller.signal.aborted) return;
        swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-update', {
          requestId,
          chunk
        });
      }, { signal: controller.signal });
      controller.signal.throwIfAborted();
      const response = snapshotJson(generated);
      if (response.model !== modelConfig.id || (payload.modelIdentity && response.modelIdentity !== payload.modelIdentity)) {
        throw new Error('Provider execution identity mismatch');
      }

      const receipt = await signReceiptDraft(
        await createReceiptDraft({
          provider: identityBundle.peerId,
          consumer,
          jobHash: `request:${requestId}`,
          model: response.model,
          inputTokens: estimateTokens(messages),
          outputTokens: estimateTokens(response.raw || response.content || '')
        }),
        identityBundle
      );
      controller.signal.throwIfAborted();
      if (closed) return;

      const result = { requestId, response, receipt };
      completed.set(key, { type: 'reploid:generation-result', payload: result });
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-result', result);
    } catch (error) {
      const payload = { requestId, error: error?.message || String(error) };
      if (!closed) completed.set(key, { type: 'reploid:generation-error', payload });
      swarmTransport?.sendToPeer(remotePeerId, 'reploid:generation-error', payload);
    } finally {
      while (completed.size > policy.mesh.maxRetainedJobs) completed.delete(completed.keys().next().value);
      clearTimeout(deadline);
      inbound.delete(key);
      advertiseSelf();
    }
  };

  const initialize = async () => {
    if (closed) throw new Error('Mesh is closed');
    if (swarmEnabled && await ports.authorize({ action: 'mesh.connect', roomId: policy.mesh.roomId }) !== true) {
      throw new Error('Host denied mesh connection');
    }
    if (identityBundle && (!swarmEnabled || swarmInitialized)) {
      return getSwarmSnapshot();
    }
    if (swarmInitPromise) return swarmInitPromise;

    swarmInitPromise = (async () => {
      identityBundle = await ports.identity.ensure({
        instanceId,
        swarmEnabled,
        hasInference: ready(),
        forceNew: pendingFreshIdentity
      });
      pendingFreshIdentity = false;

      if (!swarmEnabled) {
        return getSwarmSnapshot();
      }

      if (!swarmTransport) {
        swarmTransport = ports.createTransport();
      }

      if (!swarmHandlersRegistered) {
        peerIdentity = createMeshPeerIdentity({ transport: swarmTransport, getIdentity: () => identityBundle,
          roomId: policy.mesh.roomId, timeoutMs: REMOTE_GENERATION_TIMEOUT_MS, maxPending: policy.mesh.maxPendingJobs });
        swarmTransport.onMessage('reploid:peer-advertisement', handlePeerAdvertisement);
        swarmTransport.onMessage('reploid:generation-request', handleGenerationRequest);
        swarmTransport.onMessage('reploid:generation-update', handleGenerationUpdate);
        swarmTransport.onMessage('reploid:generation-result', handleGenerationResult);
        swarmTransport.onMessage('reploid:generation-error', handleGenerationError);
        swarmTransport.onMessage('reploid:generation-cancel', (peerId, payload = {}) => {
          inbound.get(`${peerId}:${String(payload.requestId || '')}`)?.abort(new Error('Requester stopped this job'));
        });
        swarmTransport.onMessage('reploid:receipt', handleReceipt);

        subscriptions.push(eventBus.on('swarm:peer-connected', () => {
          advertiseSelf();
          emitSwarmState();
        }, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-joined', () => {
          advertiseSelf();
          emitSwarmState();
        }, 'self-bridge'));
        const retirePeer = ({ peerId }) => {
          peerIdentity?.retirePeer(peerId);
          swarmController.removePeer(peerId);
          remoteRequests.retirePeer(peerId);
          for (const [key, controller] of inbound) if (key.startsWith(`${peerId}:`)) controller.abort(new Error('Requester disconnected'));
          emitSwarmState();
        };
        subscriptions.push(eventBus.on('swarm:peer-left', retirePeer, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-disconnected', retirePeer, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:state-change', () => {
          emitSwarmState();
        }, 'self-bridge'));
        swarmHandlersRegistered = true;
      }

      swarmInitialized = await swarmTransport.init();
      if (swarmInitialized) {
        advertiseSelf();
      }

      return emitSwarmState();
    })().finally(() => {
      swarmInitPromise = null;
    });

    return swarmInitPromise;
  };

  const rotateIdentity = async (input = {}) => {
    if (!identityBundle) {
      await initialize();
    }

    identityBundle = await ports.identity.rotate({
      ...input,
      instanceId,
      retireLegacy: input.retireLegacy !== false
    });
    await syncIdentityDocument();
    if (swarmEnabled && swarmInitialized) {
      advertiseSelf();
    }
    return emitSwarmState();
  };


  const generate = async (messages, onUpdate, { signal, modelId, modelIdentity = null, requestContext = null } = {}) => {
    if (closed) throw new Error('Mesh is closed');
    signal?.throwIfAborted();
    messages = snapshotJson(messages);
    requestContext = snapshotJson(requestContext);
    if (modelConfig) {
      if (modelId && modelId !== modelConfig.id) throw new Error('Requested model is unavailable');
      return ports.generate(messages, onUpdate || null, { signal });
    }

    if (!swarmEnabled) {
      throw new Error('No model selected');
    }

    await initialize();
    const provider = await chooseProvider(modelId, signal, modelIdentity);
    if (!provider?.peerId || !swarmTransport || !identityBundle) {
      throw new Error('No remote host slot available');
    }

    try {
      if (remoteRequests.size >= policy.mesh.maxPendingJobs) throw new Error('Pending remote job limit exceeded');
      const connectionBinding = JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null);
      const recipientIdentity = provider.identityProtocol === 1 ? await peerIdentity.verify(provider.peerId, signal) : null;
      if (await ports.authorize({ action: 'mesh.dispatch', peerId: provider.peerId, messages: snapshotJson(messages),
        recipientIdentity, requestContext: snapshotJson(requestContext) }) !== true) {
        throw new Error('Host denied remote prompt disclosure');
      }
      signal?.throwIfAborted();
      if (closed) throw new Error('Mesh is closed');
      const currentProvider = swarmController.listPeers().find(peer => peer.peerId === provider.peerId);
      if (!currentProvider || currentProvider.readiness !== 'ready' || currentProvider.availableSlots === 0
        || JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null) !== connectionBinding
        || currentProvider.model !== provider.model || currentProvider.modelIdentity !== provider.modelIdentity) {
        throw new Error('Selected contributor is no longer ready; retry requires new placement');
      }
      const requestId = utils.generateId('swarmreq');
      return await remoteRequests.start({ requestId, modelId, modelIdentity,
        providerPeerId: provider.peerId, onUpdate, signal }, () =>
        swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-request', {
          requestId, consumer: identityBundle.peerId, provider: provider.peerId,
          model: modelId || provider.model || null, modelIdentity,
          modelContract: policy.models.contract, messages
        }));
    } finally {
      reservedProviders.delete(provider.peerId);
      emitSwarmState();
    }
  };


  const close = async () => {
    if (closed) return;
    closed = true;
    peerIdentity?.close();
    for (const finish of providerWaiters) finish(false);
    remoteRequests.close();
    for (const controller of inbound.values()) controller.abort(new Error('Mesh closed'));
    inbound.clear();
    completed.clear();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
    swarmTransport?.disconnect();
    if (swarmInitPromise) await swarmInitPromise.catch(() => {});
    swarmTransport?.disconnect();
  };
  return Object.freeze({ connect: initialize, initialize, generate, rotateIdentity, getSwarmSnapshot,
    refreshAdvertisement: () => { advertiseSelf(); return emitSwarmState(); },
    hasAvailableProvider: modelId => !closed && !!chooseCompatibleProvider(modelId, true), close, on: bridgeEvents.on });
}
