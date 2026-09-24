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
  const pendingRemoteRequests = new Map(), inbound = new Map(), completed = new Map();
  const subscriptions = [];
  const providerWaiters = new Set();
  const reservedProviders = new Set();
  let closed = false, identityBundle = null, swarmTransport = ports.transport || null;
  let pendingFreshIdentity = ports.forceFreshIdentity === true;
  let swarmInitPromise = null, swarmInitialized = false, swarmHandlersRegistered = false;
  const chooseCompatibleProvider = (modelId, includeBusy = false) => rankProviderPeers(swarmController.listPeers())
    .find(peer => (!modelId || peer.model === modelId) && (includeBusy || (!reservedProviders.has(peer.peerId) && peer.availableSlots !== 0))
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
      hasInference: !!modelConfig
    }),
    ...getTransportState(),
    peerId: identityBundle?.peerId || null,
    peers: swarmController.listPeers()
  });

  const emitSwarmState = () => {
    const snapshot = getSwarmSnapshot();
    bridgeEvents.emit('swarm-state', snapshot);
    if (snapshot.providerCount > 0) {
      bridgeEvents.emit('provider-ready', snapshot);
    }
    return snapshot;
  };

  const syncIdentityDocument = async () => ports.identity.sync(identityBundle, { instanceId, swarmEnabled, hasInference: !!modelConfig });

  const advertiseSelf = () => {
    if (closed || !swarmEnabled || !swarmTransport || !identityBundle) return null;
    const advertisement = createPeerAdvertisement({
      peerId: identityBundle.peerId,
      swarmEnabled,
      hasInference: !!modelConfig,
      capabilities: ['generation'],
      contribution: identityBundle.contribution,
      updatedAt: Date.now()
    });
    advertisement.model = modelConfig?.id || null;
    advertisement.availableSlots = Math.max(0, policy.mesh.maxInboundJobs - inbound.size);
    advertisement.modelContract = policy.models.contract;
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

  const waitForProvider = (modelId, signal, timeoutMs = REMOTE_GENERATION_TIMEOUT_MS) => {
    if (chooseCompatibleProvider(modelId)) return Promise.resolve(true);
    return new Promise(resolve => {
      let unsubscribe = () => {};
      const finish = available => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort);
        providerWaiters.delete(finish); resolve(available);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      providerWaiters.add(finish);
      unsubscribe = bridgeEvents.on('provider-ready', () => { if (chooseCompatibleProvider(modelId)) finish(true); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) finish(false);
    });
  };

  const chooseProvider = async (modelId, signal) => {
    const deadline = Date.now() + REMOTE_GENERATION_TIMEOUT_MS;
    while (!closed && Date.now() < deadline) {
      signal?.throwIfAborted();
      const provider = chooseCompatibleProvider(modelId);
      if (provider) { reservedProviders.add(provider.peerId); return provider; }
      if (!await waitForProvider(modelId, signal, deadline - Date.now())) break;
    }
    signal?.throwIfAborted();
    return null;
  };

  const handlePeerAdvertisement = (remotePeerId, payload = {}) => {
    const next = swarmController.upsertPeer({
      ...payload,
      peerId: remotePeerId
    });
    if (next) {
      next.model = payload.model || null;
      next.availableSlots = payload.availableSlots === undefined ? 1 : Math.max(0, Number(payload.availableSlots) || 0);
      next.modelContract = payload.modelContract || null;
    }
    if (next?.role === 'provider') {
      bridgeEvents.emit('provider-ready', next);
    }
    emitSwarmState();
  };

  const handleGenerationUpdate = (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;
    const chunk = String(payload.chunk || '');
    if (!chunk) return;
    pending.chunks.push(chunk);
    pending.onUpdate?.(chunk);
  };

  const handleGenerationResult = async (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;

    if (payload.receipt) {
      const verified = await verifyReceipt(payload.receipt);
      if (!verified.valid || payload.receipt.jobHash !== `request:${pending.requestId}`
        || payload.receipt.consumer !== identityBundle?.peerId) {
        clearTimeout(pending.timeoutId);
        pendingRemoteRequests.delete(pending.requestId);
        pending.reject(new Error('Remote receipt is invalid or does not bind this request'));
        return;
      }
    } else if (policy.models.contract !== null) {
      clearTimeout(pending.timeoutId);
      pendingRemoteRequests.delete(pending.requestId);
      pending.reject(new Error('Remote execution receipt is missing'));
      return;
    }
    if (closed || pendingRemoteRequests.get(pending.requestId) !== pending) return;
    clearTimeout(pending.timeoutId);
    pendingRemoteRequests.delete(pending.requestId);

    const response = payload.response && typeof payload.response === 'object'
      ? payload.response
      : { content: String(payload.content || ''), raw: String(payload.raw || payload.content || ''),
          model: payload.model || null, provider: payload.provider || null, timestamp: payload.timestamp || Date.now() };
    if (pending.modelId && response.model !== pending.modelId) {
      pending.reject(new Error('Remote response substituted the requested model'));
      return;
    }

    try {
    if (payload.receipt && identityBundle && swarmTransport) {
      const countersigned = await countersignReceipt(payload.receipt, identityBundle);
      swarmTransport.sendToPeer(remotePeerId, 'reploid:receipt', {
        receipt: countersigned
      });
      await updateConsumerReceiptCount();
    }

    pending.resolve(response);
    } catch (error) { pending.reject(error); }
  };

  const handleGenerationError = (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;
    clearTimeout(pending.timeoutId);
    pendingRemoteRequests.delete(pending.requestId);
    pending.reject(new Error(String(payload.error || 'Remote generation failed')));
  };

  const handleReceipt = async (_remotePeerId, payload = {}) => {
    if (!payload?.receipt || !identityBundle) return;
    const verification = await verifyReceipt(payload.receipt);
    if (!verification.valid) return;
    if (payload.receipt.provider !== identityBundle.peerId) return;
    await updateProviderContribution(payload.receipt);
  };

  const handleGenerationRequest = async (remotePeerId, payload = {}) => {
    if (closed || !policy.mesh.executeJobs || !modelConfig || !swarmEnabled || !swarmTransport || !identityBundle) return;

    const requestId = String(payload.requestId || '').trim();
    const consumer = String(payload.consumer || remotePeerId).trim() || remotePeerId;
    const targetProvider = payload.provider ? String(payload.provider).trim() : null;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!requestId || !messages.length) return;
    if (targetProvider && targetProvider !== identityBundle.peerId && targetProvider !== swarmTransport._getPeerId?.()) return;
    if (payload.model && payload.model !== modelConfig.id) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Requested model is unavailable' });
      return;
    }
    if (policy.models.contract !== null && JSON.stringify(snapshotJson(payload.modelContract ?? null)) !== JSON.stringify(policy.models.contract)) return;
    if (await ports.authorize({ action: 'mesh.execute', peerId: remotePeerId, request: snapshotJson(payload) }) !== true) return;
    const key = `${remotePeerId}:${requestId}`;
    if (completed.has(key)) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-result', completed.get(key));
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
      const response = await ports.generate(messages, (chunk) => {
        swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-update', {
          requestId,
          chunk
        });
      }, { signal: controller.signal });
      controller.signal.throwIfAborted();

      const receipt = await signReceiptDraft(
        await createReceiptDraft({
          provider: identityBundle.peerId,
          consumer,
          jobHash: `request:${requestId}`,
          model: response.model || modelConfig.id,
          inputTokens: estimateTokens(messages),
          outputTokens: estimateTokens(response.raw || response.content || '')
        }),
        identityBundle
      );

      const result = { requestId, response, receipt };
      completed.set(key, result);
      while (completed.size > policy.mesh.maxRetainedJobs) completed.delete(completed.keys().next().value);
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-result', result);
    } catch (error) {
      swarmTransport?.sendToPeer(remotePeerId, 'reploid:generation-error', {
        requestId,
        error: error?.message || String(error)
      });
    } finally {
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
        hasInference: !!modelConfig,
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
          swarmController.removePeer(peerId);
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


  const generate = async (messages, onUpdate, { signal, modelId, requestContext = null } = {}) => {
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
    const provider = await chooseProvider(modelId, signal);
    if (!provider?.peerId || !swarmTransport || !identityBundle) {
      throw new Error('No remote host slot available');
    }

    try {
    if (pendingRemoteRequests.size >= policy.mesh.maxPendingJobs) throw new Error('Pending remote job limit exceeded');
    if (await ports.authorize({ action: 'mesh.dispatch', peerId: provider.peerId, messages: snapshotJson(messages),
      requestContext: snapshotJson(requestContext) }) !== true) {
      throw new Error('Host denied remote prompt disclosure');
    }
    signal?.throwIfAborted();
    if (closed) throw new Error('Mesh is closed');
    const requestId = utils.generateId('swarmreq');
    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pending = pendingRemoteRequests.get(requestId);
        pendingRemoteRequests.delete(requestId);
        if (pending) swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-cancel', { requestId });
        pending?.reject(new Error('Timed out waiting for remote host slot response'));
      }, REMOTE_GENERATION_TIMEOUT_MS);

      const abort = () => {
        clearTimeout(timeoutId);
        pendingRemoteRequests.delete(requestId);
        swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-cancel', { requestId });
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      const settle = fn => value => { signal?.removeEventListener('abort', abort); fn(value); };
      pendingRemoteRequests.set(requestId, {
        requestId,
        modelId,
        providerPeerId: provider.peerId,
        onUpdate,
        chunks: [],
        timeoutId,
        resolve: settle(resolve),
        reject: settle(reject)
      });

      const sent = swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-request', {
        requestId,
        consumer: identityBundle.peerId,
        provider: provider.peerId,
        model: modelId || provider.model || null,
        modelContract: policy.models.contract,
        messages
      });

      if (!sent) {
        clearTimeout(timeoutId);
        pendingRemoteRequests.delete(requestId);
        settle(reject)(new Error('Failed to send swarm generation request'));
      }
    });
    } finally {
      reservedProviders.delete(provider.peerId);
      emitSwarmState();
    }
  };


  const close = async () => {
    if (closed) return;
    closed = true;
    for (const finish of providerWaiters) finish(false);
    for (const pending of pendingRemoteRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Mesh closed'));
    }
    pendingRemoteRequests.clear();
    for (const controller of inbound.values()) controller.abort(new Error('Mesh closed'));
    inbound.clear();
    completed.clear();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
    swarmTransport?.disconnect();
    if (swarmInitPromise) await swarmInitPromise.catch(() => {});
    swarmTransport?.disconnect();
  };
  return Object.freeze({ connect: initialize, initialize, generate, rotateIdentity, getSwarmSnapshot,
    hasAvailableProvider: modelId => !closed && !!chooseCompatibleProvider(modelId, true), close, on: bridgeEvents.on });
}
