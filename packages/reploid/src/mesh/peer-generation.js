import { publicPreparationProgress } from './preparation-progress.js';
import { publicProviderHardware } from './provider-hardware.js';
import { identifyComputer } from './computer-identity.js';
import computerPolicy from './computer-identity.policy.json' with { type: 'json' };
import { createRemoteGenerationRequests } from './remote-generation-requests.js';
import { createMeshPeerIdentity } from './peer-identity.js';
import { requireResolvedConfig, snapshotJson } from '../config/index.js';
import { createPeerAdvertisement, createSwarmController } from './swarm-coordination.js';
import { rankProviderPeers, applyReceiptToContribution } from './contribution.js';
import { createReceiptDraft, countersignReceipt, signReceiptDraft, verifyReceipt } from '../artifacts/receipt.js';
import { measureWholeModelReceipt, matchesWholeModelReceipt } from '../artifacts/whole-model-receipt.js';
import { hashJson } from '../artifacts/signatures.js';
import { signGenerationTerminal, verifyGenerationTerminal } from '../artifacts/generation-terminal.js';
import { createGenerationRecovery, createMemoryGenerationJournal } from './generation-recovery.js';

const adapterSet = value => {
  if (!Array.isArray(value) || value.length > 1 || value.some(id => !/^sha256:[a-f0-9]{64}$/.test(id))) {
    throw new Error('Invalid adapter selection');
  }
  return [...value];
};
const supportsAdapters = (peer, selected) => selected.every(id => (peer.adapterIdentities || []).includes(id));
const modelBinding = (model, modelIdentity = null) => Object.freeze({ model, modelIdentity });
const matchesRequestedModel = (actual, requested) => (!requested.model || actual.model === requested.model)
  && (!requested.modelIdentity || actual.modelIdentity === requested.modelIdentity);
const sameModelBinding = (actual, expected) => actual.model === expected.model
  && actual.modelIdentity === expected.modelIdentity;

// Whole-request generation by authorized peers over the swarm protocol: advertisement,
// provider choice, streamed requests, receipts and recovery. Receipts are signed records,
// not independent evaluation, durable job replay, or hardware attestation.
export function createPeerGenerationMesh({ config, ports }) {
  const policy = requireResolvedConfig(config);
  for (const name of ['authorize', 'createTransport', 'generate']) {
    if (typeof ports?.[name] !== 'function') throw new TypeError(`Mesh port ${name} is required`);
  }
  if (!ports.identity || !ports.events || !ports.eventBus || !ports.utils) throw new TypeError('Mesh identity, event and utility ports are required');
  const { instanceId, utils, eventBus } = ports;
  const modelConfig = snapshotJson(ports.modelConfig ?? null);
  const bridgeEvents = ports.events;
  const swarmEnabled = policy.mesh.enabled;
  const REMOTE_GENERATION_TIMEOUT_MS = policy.mesh.generationTimeoutMs;
  const swarmController = createSwarmController();
  const receiptHistory = [], observedPeers = new Map();
  const contextProviders = new Map();
  const identificationAttempts = new Map(), identifying = new Set();
  let observationSequence = 0;
  const inbound = new Map(), completed = new Map();
  const inboundSettlements = new Set();
  const receiptSettlements = new Set();
  const executions = new Set();
  const lifetime = new AbortController();
  const subscriptions = [];
  const providerWaiters = new Set();
  const reservedProviders = new Set();
  let closing = null;
  let closed = false, identityBundle = null, swarmTransport = ports.transport || null;
  let peerIdentity = null;
  let recovery = null;
  const generationJournal = ports.generationJournal || createMemoryGenerationJournal(policy.mesh.maxRetainedJobs);
  let pendingFreshIdentity = ports.forceFreshIdentity === true;
  const remoteRequests = createRemoteGenerationRequests({ timeoutMs: REMOTE_GENERATION_TIMEOUT_MS,
    maxPending: policy.mesh.maxPendingJobs,
    sendCancel: (peerId, requestId) => swarmTransport?.sendToPeer(peerId, 'reploid:generation-cancel', { requestId }) });
  let swarmInitPromise = null, swarmInitialized = false, swarmHandlersRegistered = false;
  const executionState = () => ports.getExecutionState?.() || { phase: modelConfig ? 'ready' : 'idle', modelIdentity: null };
  const ready = () => !closed && !!modelConfig && executionState().phase === 'ready';
  const currentModelBinding = () => modelBinding(modelConfig?.id || null, executionState().modelIdentity);
  const bindingAvailable = (binding, adapters) => sameModelBinding(currentModelBinding(), binding)
    && supportsAdapters(executionState(), adapters);
  const executeBound = async (messages, onUpdate, controls, binding) => {
    const adapters = adapterSet(controls.adapterIdentities);
    const assertBinding = () => {
      if (!bindingAvailable(binding, adapters)) {
        throw new Error('Provider execution binding changed');
      }
    };
    assertBinding();
    const response = snapshotJson(await ports.generate(messages, chunk => {
      assertBinding();
      return onUpdate?.(chunk);
    }, { ...controls, adapterIdentities: [...adapters] }));
    assertBinding();
    if (!response || !matchesRequestedModel(response, binding)) {
      throw new Error('Provider execution identity mismatch');
    }
    if (JSON.stringify(response.adapterIdentities || []) !== JSON.stringify(adapters)) {
      throw new Error('Provider adapter execution identity mismatch');
    }
    return response;
  };
  const generateBound = (messages, onUpdate, controls, binding) => {
    const signal = AbortSignal.any([lifetime.signal, ...(controls.signal ? [controls.signal] : [])]);
    signal.throwIfAborted();
    const pending = executeBound(messages, chunk => {
      if (!signal.aborted) return onUpdate?.(chunk);
    }, { ...controls, signal }, binding).then(response => {
      signal.throwIfAborted();
      return response;
    });
    executions.add(pending);
    const settled = () => executions.delete(pending);
    pending.then(settled, settled);
    return pending;
  };
  const chooseCompatibleProvider = (modelId, includeBusy = false, modelIdentity = null, adapters = [], preferred = null) => {
    const eligible = rankProviderPeers(swarmController.listPeers())
    .filter(peer => supportsAdapters(peer, adapters) && peer.readiness === 'ready' && (!modelIdentity || peer.modelIdentity === modelIdentity) && (!modelId || peer.model === modelId) && (includeBusy || (!reservedProviders.has(peer.peerId) && peer.availableSlots !== 0))
      && (policy.models.contract === null
      || JSON.stringify(snapshotJson(peer.modelContract ?? null)) === JSON.stringify(policy.models.contract)));
    return eligible.find(peer => peer.peerId === preferred) || eligible[0] || null;
  };

  const getTransportState = () => ({
    connectionState: swarmTransport?.getConnectionState?.() || 'disconnected',
    transport: swarmTransport?.getTransportType?.() || null,
    connections: swarmTransport?.getPeerStates?.() || []
  });

  const getSwarmSnapshot = () => ({
    instanceId,
    ...swarmController.getState({
      swarmEnabled,
      hasInference: ready()
    }),
    ...getTransportState(),
    peerId: identityBundle?.peerId || null,
    peers: snapshotJson(swarmController.listPeers().map(peer => {
      const participantId = peerIdentity?.getVerified(peer.peerId) || null;
      // Never promote identity fields supplied by an advertisement into verified labels.
      return { ...(observedPeers.get(peer.peerId) || peer), participantId, identityVerified: !!participantId };
    }))
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
    advertisement.observationSession = instanceId;
    advertisement.observationSequence = ++observationSequence;
    advertisement.readiness = executionState().phase;
    const activity = executionState().activity;
    advertisement.activity = activity ? { phase: activity.phase,
      completed: Number.isSafeInteger(activity.completed) ? activity.completed : 0,
      failure: activity.error ? { phase: activity.phase, message: 'Model preparation or execution failed on this computer.' } : null } : null;
    advertisement.preparation = advertisement.readiness === 'loading' ? publicPreparationProgress(executionState().progress) : null;
    advertisement.modelIdentity = executionState().modelIdentity;
    advertisement.hardware = publicProviderHardware(executionState().hardware);
    advertisement.adapterIdentities = executionState().adapterIdentities || [];
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

  const waitForProvider = (modelId, signal, timeoutMs = REMOTE_GENERATION_TIMEOUT_MS, modelIdentity = null, adapters = []) => {
    if (chooseCompatibleProvider(modelId, false, modelIdentity, adapters)) return Promise.resolve(true);
    return new Promise(resolve => {
      let unsubscribe = () => {};
      const finish = available => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort);
        providerWaiters.delete(finish); resolve(available);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      providerWaiters.add(finish);
      unsubscribe = bridgeEvents.on('provider-ready', () => { if (chooseCompatibleProvider(modelId, false, modelIdentity, adapters)) finish(true); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) finish(false);
    });
  };

  const chooseProvider = async (modelId, signal, modelIdentity, adapters, preferred = null) => {
    const deadline = Date.now() + REMOTE_GENERATION_TIMEOUT_MS;
    while (!closed && Date.now() < deadline) {
      signal?.throwIfAborted();
      const provider = chooseCompatibleProvider(modelId, false, modelIdentity, adapters, preferred);
      if (provider) { reservedProviders.add(provider.peerId); return snapshotJson(provider); }
      if (!await waitForProvider(modelId, signal, deadline - Date.now(), modelIdentity, adapters)) break;
    }
    signal?.throwIfAborted();
    return null;
  };

  const handlePeerAdvertisement = (remotePeerId, payload = {}) => {
    try { payload = snapshotJson(payload); } catch { return; }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return;
    if (!Number.isFinite(payload.updatedAt)) return;
    delete payload.participantId;
    delete payload.identityVerified;
    try { adapterSet(payload.adapterIdentities || []); } catch { return; }
    const next = swarmController.upsertPeer({
      ...payload,
      peerId: remotePeerId
    });
    if (next) {
      next.activity = payload.activity && ['idle', 'loading', 'ready', 'executing', 'stopping', 'failed'].includes(payload.activity.phase)
        ? { phase: payload.activity.phase, completed: Number.isSafeInteger(payload.activity.completed) ? payload.activity.completed : 0,
          failure: payload.activity.failure ? { message: 'Model preparation or execution failed on this computer.' } : null } : null;
      next.model = typeof payload.model === 'string' ? payload.model : null;
      next.readiness = ['loading', 'ready', 'executing', 'idle', 'failed', 'stopping'].includes(payload.readiness) ? payload.readiness : 'unavailable';
      next.preparation = next.readiness === 'loading' ? publicPreparationProgress(payload.preparation) : null;
      next.modelIdentity = payload.modelIdentity || null;
      next.hardware = publicProviderHardware(payload.hardware);
      next.adapterIdentities = payload.adapterIdentities || [];
      next.availableSlots = Number.isSafeInteger(payload.availableSlots) && payload.availableSlots > 0 ? payload.availableSlots : 0;
      next.modelContract = payload.modelContract || null;
      next.identityProtocol = payload.identityProtocol === 1 ? 1 : null;
    }
    if (next) {
      const connection = swarmTransport?.getPeerStates?.().find(peer => peer.id === remotePeerId);
      const previous = observedPeers.get(remotePeerId);
      const sameAttempt = (previous?.attemptId ?? null) === (connection?.attemptId ?? null);
      const ordered = !sameAttempt || !previous || (payload.observationSession === previous.observationSession
        && Number.isSafeInteger(payload.observationSequence) && Number.isSafeInteger(previous.observationSequence)
        ? payload.observationSequence > previous.observationSequence : payload.updatedAt >= previous.updatedAt);
      if (ordered && (!connection || !['disconnected', 'failed'].includes(connection.phase))) {
        observedPeers.set(remotePeerId, { ...snapshotJson(next), attemptId: connection?.attemptId || null,
          observationSession: payload.observationSession ?? null, observationSequence: payload.observationSequence ?? null });
      }
    }
    if (next?.role === 'provider') {
      bridgeEvents.emit('provider-ready', next);
    }
    emitSwarmState();
    const channel = swarmTransport?.getPeerBinding?.(remotePeerId);
    const attemptId = swarmTransport?.getPeerStates?.().find(peer => peer.id === remotePeerId)?.attemptId ?? null;
    const identificationKey = JSON.stringify([attemptId, channel]);
    if (!closed && next?.identityProtocol === 1 && channel && peerIdentity
      && !peerIdentity.getVerified(remotePeerId) && identifying.size < computerPolicy.maxBackgroundProofs
      && identificationAttempts.get(remotePeerId) !== identificationKey) {
      identificationAttempts.set(remotePeerId, identificationKey);
      const pending = peerIdentity.observe(remotePeerId, lifetime.signal).catch(() => null);
      identifying.add(pending);
      pending.finally(() => identifying.delete(pending));
    }
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
      // Only this verifier may attach execution evidence to the returned result.
      delete response.executionReceipt;
      if (!matchesRequestedModel(response, modelBinding(pending.modelId, pending.modelIdentity))) {
        throw new Error('Remote response substituted the requested model');
      }
      if (JSON.stringify(response.adapterIdentities || []) !== JSON.stringify(pending.adapterIdentities)) {
        throw new Error('Remote response substituted the requested adapter');
      }
      if (payload.receipt) {
        const verified = await verifyReceipt(payload.receipt);
        if (!current()) return;
        if (!verified.valid || payload.receipt.jobHash !== `request:${pending.requestId}`
          || payload.receipt.consumer !== identityBundle?.peerId || payload.receipt.model !== response.model) {
          throw new Error('Remote receipt is invalid or does not bind this request');
        }
        if (Number(payload.receipt.version) === 2 && (!pending.providerIdentity || payload.receipt.provider !== pending.providerIdentity
          || !await matchesWholeModelReceipt(payload.receipt, pending.messages, response))) {
          throw new Error('Measured receipt differs from the admitted request or provider output');
        }
        const countersigned = await countersignReceipt(payload.receipt, identityBundle);
        if (!current()) return;
        swarmTransport.sendToPeer(remotePeerId, 'reploid:receipt', { receipt: countersigned });
        await updateConsumerReceiptCount();
        response.executionReceipt = countersigned;
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
    if (!verification.valid || !verification.consumerValid) return;
    if (payload.receipt.provider !== identityBundle.peerId) return;
    await ports.onReceipt?.(snapshotJson(payload.receipt));
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
    const contextId = payload.contextId ?? null;
    if (contextId !== null && (typeof contextId !== 'string' || !contextId || contextId.length > 256)) return;

    if (!requestId || requestId.length > 512 || !messages.length) return;
    let adapters;
    try { adapters = adapterSet(payload.adapterIdentities || []); } catch { return; }
    if (targetProvider && targetProvider !== identityBundle.peerId && targetProvider !== swarmTransport._getPeerId?.()) return;
    const binding = currentModelBinding();
    if (!matchesRequestedModel(binding, payload) || !supportsAdapters(executionState(), adapters)) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Requested model is unavailable' });
      return;
    }
    if (policy.models.contract !== null && JSON.stringify(snapshotJson(payload.modelContract ?? null)) !== JSON.stringify(policy.models.contract)) return;
    if (await ports.authorize({ action: 'mesh.execute', peerId: remotePeerId, request: snapshotJson(payload) }) !== true) return;
    if (closed) return;
    if (!ready() || !bindingAvailable(binding, adapters)) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', {
        requestId, error: 'Provider execution binding changed during authorization'
      });
      return;
    }
    const key = `${remotePeerId}:${requestId}`;
    // A replay cannot evade the durable fence by downgrading its protocol flag.
    const earlierAdmission = !payload.recoverable && await generationJournal.get({ provider: identityBundle.peerId, consumer, requestId });
    if (closed || !ready() || !bindingAvailable(binding, adapters)) return;
    if (earlierAdmission) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Previously admitted execution requires recovery' });
      return;
    }
    if (!payload.recoverable && completed.has(key)) {
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
    let finishSettlement;
    const settlement = new Promise(resolve => { finishSettlement = resolve; });
    inboundSettlements.add(settlement);
    const deadline = setTimeout(() => controller.abort(new Error('Remote job deadline exceeded')), policy.mesh.generationTimeoutMs);

    let recoveryBinding = null, claimedRecovery = false, retainedResult = false;
    try {
      // An asserted consumer string cannot select somebody else's decoder memory.
      const contextOwner = contextId ? await peerIdentity.verify(remotePeerId, controller.signal) : null;
      if (contextId && (!contextOwner || contextOwner !== consumer)) throw Error('Generation context consumer identity changed');
      if (payload.recoverable === true) {
        if (await peerIdentity.verify(remotePeerId, controller.signal) !== consumer) throw Error('Generation consumer identity changed');
        recoveryBinding = { requestId, provider: identityBundle.peerId, consumer, model: binding.model,
          modelIdentity: binding.modelIdentity, adapterIdentities: adapters, inputDigest: await hashJson(messages) };
        claimedRecovery = await generationJournal.claim(recoveryBinding);
        if (!claimedRecovery) {
          const previous = await generationJournal.get(recoveryBinding);
          if (JSON.stringify(previous?.binding) !== JSON.stringify(recoveryBinding)) throw Error('Generation replay binding changed');
          if (previous?.outcome) swarmTransport.sendToPeer(remotePeerId, previous.outcome.type, previous.outcome.payload);
          else swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Execution unresolved; query recovery without repeating it' });
          return;
        }
      }
      advertiseSelf();
      const response = await generateBound(messages, (chunk) => {
        if (closed || controller.signal.aborted) return;
        swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-update', {
          requestId,
          chunk
        });
      }, { signal: controller.signal, adapterIdentities: adapters, requestId, consumer, contextOwner, contextId }, binding);
      controller.signal.throwIfAborted();

      const receipt = await signReceiptDraft(
        await createReceiptDraft({
          provider: identityBundle.peerId,
          consumer,
          jobHash: `request:${requestId}`,
          model: response.model,
          inputTokens: 0,
          outputTokens: 0,
          status: 'unmetered',
          ...await measureWholeModelReceipt(messages, response)
        }),
        identityBundle
      );
      controller.signal.throwIfAborted();
      if (closed) return;

      const result = { requestId, response, receipt };
      if (recoveryBinding) {
        await generationJournal.finish(recoveryBinding, { type: 'reploid:generation-result', payload: result });
        retainedResult = true;
      }
      completed.set(key, { type: 'reploid:generation-result', payload: result });
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-result', result);
    } catch (error) {
      const payload = { requestId, error: error?.message || String(error) };
      if (claimedRecovery && !retainedResult && typeof ports.settleGeneration === 'function') {
        try {
          // A rejected promise alone cannot prove GPU cleanup. The owning host
          // must confirm reset/disposal before this terminal record is signed.
          if (await ports.settleGeneration() === true) {
            payload.terminal = await signGenerationTerminal(recoveryBinding,
              controller.signal.reason?.code === 'REQUESTER_CANCELLED' ? 'cancelled' : 'failed', identityBundle);
            await generationJournal.finish(recoveryBinding, { type: 'reploid:generation-error', payload });
            await ports.onGenerationTerminal?.(snapshotJson(payload.terminal));
          }
        } catch { /* No terminal proof: retain the admission fence and uncertainty. */ }
      }
      if (!closed) {
        completed.set(key, { type: 'reploid:generation-error', payload });
        swarmTransport?.sendToPeer(remotePeerId, 'reploid:generation-error', payload);
      }
    } finally {
      while (completed.size > policy.mesh.maxRetainedJobs) completed.delete(completed.keys().next().value);
      clearTimeout(deadline);
      inbound.delete(key);
      inboundSettlements.delete(settlement);
      finishSettlement();
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
          roomId: policy.mesh.roomId, timeoutMs: REMOTE_GENERATION_TIMEOUT_MS, maxPending: policy.mesh.maxPendingJobs,
          onVerified: () => { if (!closed) emitSwarmState(); } });
        recovery = createGenerationRecovery({ transport: swarmTransport, getIdentity: () => identityBundle,
          verifyPeer: (peer, signal) => peerIdentity.verify(peer, signal), journal: generationJournal,
          timeoutMs: REMOTE_GENERATION_TIMEOUT_MS, maxPending: policy.mesh.maxPendingJobs });
        swarmTransport.onMessage('reploid:peer-advertisement', handlePeerAdvertisement);
        swarmTransport.onMessage('reploid:generation-request', handleGenerationRequest);
        swarmTransport.onMessage('reploid:generation-update', handleGenerationUpdate);
        swarmTransport.onMessage('reploid:generation-result', handleGenerationResult);
        swarmTransport.onMessage('reploid:generation-error', handleGenerationError);
        swarmTransport.onMessage('reploid:generation-cancel', (peerId, payload = {}) => {
          inbound.get(`${peerId}:${String(payload.requestId || '')}`)?.abort(Object.assign(new Error('Requester stopped this job'), { code: 'REQUESTER_CANCELLED' }));
        });
        swarmTransport.onMessage('reploid:receipt', (peer, payload) => {
          if (closed) return;
          const pending = handleReceipt(peer, payload);
          receiptSettlements.add(pending);
          pending.then(() => receiptSettlements.delete(pending), () => receiptSettlements.delete(pending));
          return pending;
        });

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
          observedPeers.delete(peerId);
          identificationAttempts.delete(peerId);
          remoteRequests.retirePeer(peerId);
          for (const [key, controller] of inbound) if (key.startsWith(`${peerId}:`)) controller.abort(new Error('Requester disconnected'));
          emitSwarmState();
        };
        subscriptions.push(eventBus.on('swarm:peer-left', retirePeer, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-disconnected', retirePeer, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:state-change', () => {
          emitSwarmState();
        }, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-progress', emitSwarmState, 'self-bridge'));
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


  const generate = async (messages, onUpdate, { signal, modelId, modelIdentity = null, adapterIdentities = [], requestContext = null } = {}) => {
    if (closed) throw new Error('Mesh is closed');
    signal?.throwIfAborted();
    messages = snapshotJson(messages);
    requestContext = snapshotJson(requestContext);
    const contextId = requestContext?.contextId ?? null;
    if (contextId !== null && (typeof contextId !== 'string' || !contextId || contextId.length > 256)) throw Error('Invalid generation context ID');
    adapterIdentities = adapterSet(adapterIdentities);
    if (modelConfig) {
      const binding = currentModelBinding();
      if (!ready() || !matchesRequestedModel(binding, modelBinding(modelId, modelIdentity))) {
        throw new Error('Requested model is unavailable');
      }
      if (!supportsAdapters(executionState(), adapterIdentities)) throw new Error('Requested adapter is unavailable');
      return generateBound(messages, onUpdate, { signal, adapterIdentities, contextOwner: 'local', contextId }, binding);
    }

    if (!swarmEnabled) {
      throw new Error('No model selected');
    }

    await initialize();
    const affinityKey = contextId ? JSON.stringify([contextId, modelId, modelIdentity, adapterIdentities]) : null;
    const provider = await chooseProvider(modelId, signal, modelIdentity, adapterIdentities, contextProviders.get(affinityKey));
    if (!provider?.peerId || !swarmTransport || !identityBundle) {
      // An adapter request never falls back to the base model or another adapter.
      throw new Error(adapterIdentities.length ? 'No contributor serves the requested adapter. The base model was not used.'
        : 'No remote host slot available');
    }

    // Bind automatic selection to the selected advertisement, not an open-ended request.
    modelId ||= provider.model;
    modelIdentity ||= provider.modelIdentity || null;
    try {
      if (remoteRequests.size >= policy.mesh.maxPendingJobs) throw new Error('Pending remote job limit exceeded');
      const connectionBinding = JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null);
      const recipientIdentity = provider.identityProtocol === 1 ? await peerIdentity.verify(provider.peerId, signal) : null;
      const requestId = utils.generateId('swarmreq');
      if (await ports.authorize({ action: 'mesh.dispatch', peerId: provider.peerId, modelId, modelIdentity, messages: snapshotJson(messages),
        requestId, recipientIdentity, adapterIdentities: [...adapterIdentities], requestContext: snapshotJson(requestContext) }) !== true) {
        throw new Error('Host denied remote prompt disclosure');
      }
      signal?.throwIfAborted();
      if (closed) throw new Error('Mesh is closed');
      const currentProvider = swarmController.listPeers().find(peer => peer.peerId === provider.peerId);
      if (!currentProvider || currentProvider.readiness !== 'ready' || currentProvider.availableSlots === 0
        || JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null) !== connectionBinding
        || currentProvider.model !== provider.model || currentProvider.modelIdentity !== provider.modelIdentity
        || !supportsAdapters(currentProvider, adapterIdentities)) {
        throw new Error('Selected contributor is no longer ready; retry requires new placement');
      }
      const result = await remoteRequests.start({ requestId, modelId, modelIdentity, adapterIdentities,
        providerPeerId: provider.peerId, providerIdentity: recipientIdentity, messages, onUpdate, signal }, () =>
        swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-request', {
          requestId, consumer: identityBundle.peerId, provider: provider.peerId,
          ...(contextId && provider.identityProtocol === 1 ? { contextId } : {}),
          model: modelId || provider.model || null, modelIdentity, adapterIdentities,
          modelContract: policy.models.contract, messages, ...(requestContext?.recoverable === true ? { recoverable: true } : {})
        }));
      if (affinityKey) {
        contextProviders.delete(affinityKey);
        contextProviders.set(affinityKey, provider.peerId);
        while (contextProviders.size > policy.mesh.maxRetainedJobs) contextProviders.delete(contextProviders.keys().next().value);
      }
      return result;
    } finally {
      reservedProviders.delete(provider.peerId);
      emitSwarmState();
    }
  };

  const recoverGeneration = async (reference, messages, signal) => {
    await initialize(); signal?.throwIfAborted();
    reference = snapshotJson(reference); messages = snapshotJson(messages);
    if (!reference?.requestId || !reference.providerIdentity || !reference.providerId) throw Error('Bound recovery reference required');
    const binding = { requestId: reference.requestId, provider: reference.providerIdentity, consumer: identityBundle.peerId,
      model: reference.modelId, modelIdentity: reference.modelIdentity, adapterIdentities: adapterSet(reference.adapterIdentities),
      inputDigest: await hashJson(messages) };
    const outcome = await recovery.read(reference, signal);
    signal?.throwIfAborted();
    if (closed) throw Error('Mesh closed during recovery');
    if (!outcome) return { status: 'unresolved' };
    const payload = outcome.payload;
    if (payload?.requestId !== reference.requestId) throw Error('Recovery request identity changed');
    if (outcome.type === 'reploid:generation-error') {
      if (!await verifyGenerationTerminal(payload.terminal, binding)) throw Error('Unverified recovery cleanup');
      return { status: payload.terminal.status, terminal: payload.terminal };
    }
    const response = payload.response, receipt = payload.receipt;
    const verified = receipt && await verifyReceipt(receipt);
    if (outcome.type !== 'reploid:generation-result' || receipt?.version !== 2 || !verified?.providerValid
      || !matchesRequestedModel(response, modelBinding(binding.model, binding.modelIdentity))
      || receipt.provider !== binding.provider || receipt.consumer !== binding.consumer || receipt.model !== binding.model
      || receipt.jobHash !== `request:${binding.requestId}` || receipt.modelIdentity !== binding.modelIdentity
      || JSON.stringify(receipt.adapterIdentities) !== JSON.stringify(binding.adapterIdentities)
      || !await matchesWholeModelReceipt(receipt, messages, response)) throw Error('Unverified recovered completion');
    response.executionReceipt = await countersignReceipt(receipt, identityBundle);
    signal?.throwIfAborted();
    if (closed) throw Error('Mesh closed during recovery');
    swarmTransport.sendToPeer(reference.providerId, 'reploid:receipt', { receipt: response.executionReceipt });
    return { status: 'completed', response };
  };

  const close = () => {
    if (closing) return closing;
    // Withdraw admission immediately; cancellation is a request, not settlement.
    closed = true;
    closing = Promise.resolve().then(async () => {
      lifetime.abort(new Error('Mesh closed'));
      peerIdentity?.close();
      const recoveryClose = recovery?.close();
      for (const finish of providerWaiters) finish(false);
      remoteRequests.close();
      for (const controller of inbound.values()) controller.abort(new Error('Mesh closed'));
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
      swarmTransport?.disconnect();
      // Keep every close caller waiting while an admitted executor drains, even
      // when its cancellation port cannot interrupt the current GPU operation.
      await Promise.all([recoveryClose, ...identifying, ...inboundSettlements, ...receiptSettlements, ...[...executions].map(pending => pending.catch(() => {})),
        ...(swarmInitPromise ? [swarmInitPromise.catch(() => {})] : [])]);
      completed.clear();
      identificationAttempts.clear();
      swarmTransport?.disconnect();
    });
    return closing;
  };
  return Object.freeze({ connect: initialize, initialize, generate, recoverGeneration, rotateIdentity, getSwarmSnapshot,
    identifyComputer: (peerId, options = {}) => {
      if (closed || !peerIdentity) throw new Error('Peer identity verification is unavailable');
      return identifyComputer(peerId, { ...options,
        hardware: swarmController.listPeers().find(peer => peer.peerId === peerId)?.hardware,
        verifyPeer: (id, signal) => peerIdentity.verify(id, signal) });
    },
    verifyPeerIdentity: (peerId, signal) => {
      if (closed || !peerIdentity) throw new Error('Peer identity verification is unavailable');
      return peerIdentity.verify(peerId, signal);
    },
    refreshAdvertisement: () => { advertiseSelf(); return emitSwarmState(); },
    hasAvailableProvider: modelId => !closed && !!chooseCompatibleProvider(modelId, true), close, on: bridgeEvents.on });
}
