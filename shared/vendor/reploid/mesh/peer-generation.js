import { validateExecutionOffers, eligibleExecutionOffers } from '../chat/execution-offers.js';
import { createExecutionPolicy, requestExecutionPolicy, assertAvailableExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute, sameExecutionBinding } from '../chat/execution-policy.js';
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
import { assertSettingsSupported, effectiveRequestDigest, isCanonicalGenerationSettings, normalizeGenerationSettings,
  normalizeGenerationSettingsCapability } from './generation-settings.js';

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
const digestValue = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

const PROMPT_COMMITMENT = /^sha256:[a-f0-9]{64}$/;
const ADMISSION_SALT = /^[a-f0-9]{64}$/;
// A salted commitment to what the caller wrote: the messages, and the settings (tool definitions and an
// output schema are the caller's text too). The provider that admits a request holds only this until they
// arrive; without the 256-bit salt it cannot be tested against guesses.
const promptCommitment = (salt, messages, settings) => {
  if (!ADMISSION_SALT.test(salt || '')) throw Error('Admission salt is invalid');
  return hashJson({ schema: 'reploid.prompt-commitment/v1', salt, messages, settings: settings ?? null });
};
const admissionSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

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
  const inbound = new Map(), inboundQueued = new Map(), completed = new Map();
  const validatingInbound = new Map();
  // Requests a provider admitted from their details alone and whose prompt has not arrived yet.
  const admitted = new Map(), admitting = new Set();
  const admitsBeforeDisclosure = ports.admitsBeforeDisclosure === true;
  const consumerOrder = [], consumerBuckets = new Map();
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
  // What this computer's own generate port enforces for per-request settings. Absent port: none.
  const settingsCapability = () => modelConfig ? normalizeGenerationSettingsCapability(ports.getGenerationSettingsCapability?.()) : null;
  // The receipt binding a requester expects for a request with settings: its own effective-request
  // digest, and the output constraint identity its host expects for those settings (null: no expectation).
  const expectedReceiptBinding = async (settings, settingsDigest) => {
    if (!settings) return undefined;
    const constraintIdentity = await ports.expectedConstraintIdentity?.(snapshotJson(settings)) ?? null;
    if (constraintIdentity !== null && !digestValue(constraintIdentity)) throw new Error('Expected constraint identity must be a sha256 digest');
    return { settingsDigest, constraintIdentity };
  };
  // The host's own check of a completed answer against the agreed settings (for example a tool call's
  // arguments), made before countersigning: an answer that breaks them is never accepted or settled.
  const resultHonoursSettings = async (response, settings) => !settings
    || await ports.acceptGenerationResult?.(snapshotJson(response), snapshotJson(settings)) !== false;
  // A receipt for a request with settings is version 3 and signs this requester's digest; one for a
  // request without settings is never version 3 and never names a settings digest or a constraint.
  const receiptBindsRequest = (receipt, response, settings, bound) => {
    if (!settings) return Number(receipt.version) !== 3 && receipt.settingsDigest === undefined && receipt.constraintIdentity === undefined;
    return Number(receipt.version) === 3 && receipt.settingsDigest === bound.settingsDigest
      && (bound.constraintIdentity === null || receipt.constraintIdentity === bound.constraintIdentity)
      && (response?.constraintIdentity ?? null) === (receipt.constraintIdentity ?? null)
      && (settings.maxOutputTokens === null || receipt.outputTokens <= settings.maxOutputTokens);
  };
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
  // The host's local block list: connection ids, or signing identities this requester verified on the
  // current channel. A requester-side choice only; nothing is sent to or withheld from the network.
  const blockedComputers = () => new Set(ports.getBlockedComputers?.() || []);
  // Computers that stopped answering on an open connection. They get no new work until they answer again.
  const unresponsivePeers = new Set();
  const isBlockedProvider = (peerId, blocked = blockedComputers()) => blocked.size > 0
    && (blocked.has(peerId) || blocked.has(peerIdentity?.getVerified(peerId)));
  // Identity and admission versions are compatibility gates, not evidence of protected computation.
  const privacyEligible = (peer, privacy, offerId = null) => {
    if (peer.identityProtocol !== 1 || peer.admissionProtocol !== 2 || !digestValue(peer.modelIdentity)) return false;
    if (!privacy) return true; // Readiness observation has no request or disclosure.
    const verified = peerIdentity?.getVerified(peer.peerId);
    if (!verified && privacy.recipients.kind !== 'open') return false;
    try { return eligibleExecutionOffers({ model: { id: peer.model, identity: peer.modelIdentity }, privacy },
      peer.executionOffers ?? [], [verified ?? peer.peerId]).some(offer => !offerId || offer.id === offerId); } catch { return false; }
  };
  // Why a provider was chosen, reported to the host with the disclosure it must approve.
  const placementChoices = new WeakMap();
  const placementCandidate = peer => ({ peerId: peer.peerId, verifiedIdentity: peerIdentity?.getVerified(peer.peerId) ?? null,
    contributionScore: peer.decayedScore ?? 0, availableSlots: peer.availableSlots ?? null });
  // A request with settings considers only providers whose own advertisement says they enforce them.
  const supportsSettings = (peer, settings) => {
    try { assertSettingsSupported(peer.generationSettings, settings); return true; } catch { return false; }
  };
  const chooseCompatibleProvider = (modelId, includeBusy = false, modelIdentity = null, adapters = [], preferred = null, privacy = null, offerId = null, settings = undefined) => {
    const blocked = blockedComputers();
    let eligible = rankProviderPeers(swarmController.listPeers().filter(peer => privacyEligible(peer, privacy, offerId)))
    .filter(peer => !isBlockedProvider(peer.peerId, blocked) && !unresponsivePeers.has(peer.peerId) && supportsAdapters(peer, adapters) && peer.readiness === 'ready' && (!modelIdentity || peer.modelIdentity === modelIdentity) && (!modelId || peer.model === modelId) && (includeBusy || (!reservedProviders.has(peer.peerId) && peer.availableSlots > 0))
      && (policy.models.contract === null
      || JSON.stringify(snapshotJson(peer.modelContract ?? null)) === JSON.stringify(policy.models.contract))
      && (!settings || supportsSettings(peer, settings)));
    // Optional host ranking: connection ids or identities proven on this channel, best first. Providers it
    // does not name keep the default order after it. It reorders eligible providers; it cannot add one.
    const order = eligible.length > 1 ? ports.rankProviders?.(eligible.map(placementCandidate), { modelId, modelIdentity }) : null;
    const ranked = Array.isArray(order) && order.length > 0;
    if (ranked) {
      const place = peer => { const at = order.findIndex(id => id === peer.peerId || id === peerIdentity?.getVerified(peer.peerId)); return at < 0 ? order.length : at; };
      eligible = eligible.map((peer, index) => ({ peer, index })).sort((a, b) => place(a.peer) - place(b.peer) || a.index - b.index).map(row => row.peer);
    }
    const affinity = eligible.find(peer => peer.peerId === preferred);
    const chosen = affinity || eligible[0] || null;
    if (chosen) placementChoices.set(chosen, { reason: affinity ? 'conversation-affinity' : ranked ? 'host-ranking' : 'default-order',
      candidates: eligible.map(placementCandidate) });
    return chosen;
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
      return { ...(observedPeers.get(peer.peerId) || peer), participantId, identityVerified: !!participantId,
        ...(isBlockedProvider(peer.peerId) ? { blocked: true } : {}),
        ...(unresponsivePeers.has(peer.peerId) ? { unresponsive: true } : {}) };
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

  const currentExecutionOffers = modelIdentity => {
    const declared = executionState().executionOffers;
    if (declared) return validateExecutionOffers(declared);
    return digestValue(modelIdentity) ? [{ schema: 'reploid.execution-offer/v1', id: 'ordinary-generation',
      backend: 'doppler-plaintext/v1', kind: 'plaintext', modelIdentities: [modelIdentity],
      operation: 'generate', protocol: null, evidence: null }] : [];
  };

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
    advertisement.executionOffers = currentExecutionOffers(advertisement.modelIdentity);
    advertisement.hardware = publicProviderHardware(executionState().hardware);
    advertisement.adapterIdentities = executionState().adapterIdentities || [];
    advertisement.availableSlots = ready() ? Math.max(0, policy.mesh.maxInboundJobs - inbound.size) : 0;
    advertisement.queuedJobs = inboundQueued.size;
    advertisement.modelContract = policy.models.contract;
    advertisement.identityProtocol = 1;
    // This provider can decide on a request from its details before the prompt is sent. Advertised only
    // by a host that answers `mesh.admit`, so other advertisements are unchanged.
    if (admitsBeforeDisclosure) advertisement.admissionProtocol = 2;
    // Advertised only by a host that enforces settings, so other advertisements are unchanged.
    const generationSettings = settingsCapability();
    if (generationSettings) advertisement.generationSettings = generationSettings;
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

  const waitForProvider = (modelId, signal, timeoutMs = REMOTE_GENERATION_TIMEOUT_MS, modelIdentity = null, adapters = [], privacy = null, offerId = null, settings = undefined) => {
    if (chooseCompatibleProvider(modelId, false, modelIdentity, adapters, null, privacy, offerId, settings)) return Promise.resolve(true);
    return new Promise(resolve => {
      let unsubscribe = () => {};
      const finish = available => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort);
        providerWaiters.delete(finish); resolve(available);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), timeoutMs);
      providerWaiters.add(finish);
      unsubscribe = bridgeEvents.on('provider-ready', () => { if (chooseCompatibleProvider(modelId, false, modelIdentity, adapters, null, privacy, offerId, settings)) finish(true); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) finish(false);
    });
  };

  const chooseProvider = async (modelId, signal, modelIdentity, adapters, preferred = null, privacy = null, offerId = null, settings = undefined) => {
    const deadline = Date.now() + REMOTE_GENERATION_TIMEOUT_MS;
    while (!closed && Date.now() < deadline) {
      signal?.throwIfAborted();
      const provider = chooseCompatibleProvider(modelId, false, modelIdentity, adapters, preferred, privacy, offerId, settings);
      if (provider) {
        reservedProviders.add(provider.peerId);
        const selected = snapshotJson(provider);
        placementChoices.set(selected, placementChoices.get(provider));
        return selected;
      }
      if (!await waitForProvider(modelId, signal, deadline - Date.now(), modelIdentity, adapters, privacy, offerId, settings)) break;
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
    try {
      adapterSet(payload.adapterIdentities || []);
      if (payload.executionOffers !== undefined) payload.executionOffers = validateExecutionOffers(payload.executionOffers);
    } catch { return; }
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
      if (payload.executionOffers !== undefined) next.executionOffers = payload.executionOffers;
      else delete next.executionOffers;
      next.hardware = publicProviderHardware(payload.hardware);
      next.adapterIdentities = payload.adapterIdentities || [];
      // A missing count is unknown, not zero. Placement still sends work only to a computer that reports a free slot.
      next.availableSlots = Number.isSafeInteger(payload.availableSlots) && payload.availableSlots >= 0 ? payload.availableSlots : null;
      next.queuedJobs = Number.isSafeInteger(payload.queuedJobs) && payload.queuedJobs > 0 ? payload.queuedJobs : 0;
      next.modelContract = payload.modelContract || null;
      next.identityProtocol = payload.identityProtocol === 1 ? 1 : null;
      next.admissionProtocol = payload.admissionProtocol === 2 ? 2 : null;
      const generationSettings = normalizeGenerationSettingsCapability(payload.generationSettings);
      if (generationSettings) next.generationSettings = generationSettings;
      else delete next.generationSettings;
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

  // A request belongs to the connection it was admitted on. A frame on any other is not accepted, and the
  // request ends at once: the provider will not send its output there, so waiting could only time out.
  const onAdmittedConnection = (pending, peerId) => {
    if (!pending.admission || (pending.admission.channel && pending.admission.channel === canonicalConnection(peerId))) return true;
    remoteRequests.settle(pending, { error: new Error('The connection to this computer changed. The request ended and nothing further was accepted.'), cancel: true });
    return false;
  };

  const handleGenerationUpdate = (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload.requestId, remotePeerId);
    if (!pending || pending.processing || pending.admission?.sent === false || !onAdmittedConnection(pending, remotePeerId)) return;
    const chunk = String(payload.chunk || '');
    try {
      if (chunk) { pending.streamed = true; pending.onUpdate?.(chunk); return; }
      // The provider's input token count, for a caller that asked for it: one positive count before
      // any text. A late, repeated or malformed observation is ignored and the stream is unaffected.
      const inputTokens = payload.usage?.inputTokens;
      if (typeof pending.onUsage !== 'function' || pending.streamed || pending.observedInputTokens !== undefined
        || !Number.isSafeInteger(inputTokens) || inputTokens <= 0) return;
      pending.observedInputTokens = inputTokens;
      pending.onUsage({ inputTokens });
    } catch (error) { remoteRequests.settle(pending, { error, cancel: true }); }
  };

  // The provider admitted the request from its details. Only now does the prompt leave this computer.
  const handleGenerationAdmitted = (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload?.requestId, remotePeerId);
    const admission = pending?.admission;
    if (!admission || admission.sent) return;
    if (payload.admissionProtocol !== 2 || payload.promptCommitment !== admission.commitment) {
      remoteRequests.settle(pending, { error: new Error('The provider admitted a different request. The prompt was not sent.'), cancel: true });
      return;
    }
    admission.sent = true;
    try {
      if (!admission.send()) remoteRequests.settle(pending, { error: new Error('Failed to send swarm generation request') });
    } catch (error) { remoteRequests.settle(pending, { error, cancel: true }); }
  };

  const handleGenerationResult = async (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload.requestId, remotePeerId);
    if (!pending || pending.processing || pending.admission?.sent === false || !onAdmittedConnection(pending, remotePeerId)) return;
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
      // The caller was already told the provider's early input count. A completion or receipt that
      // reports another count is refused here, before anything is countersigned or settled.
      if (pending.observedInputTokens !== undefined
        && ((response.completion ?? response.evidence?.output?.completion)?.promptTokenCount !== pending.observedInputTokens
          || payload.receipt && payload.receipt.inputTokens !== pending.observedInputTokens)) {
        throw new Error('Provider input token count differs from its early observation');
      }
      if (payload.receipt) {
        const verified = await verifyReceipt(payload.receipt);
        if (!current()) return;
        if (!verified.valid || payload.receipt.jobHash !== `request:${pending.requestId}`
          || payload.receipt.consumer !== identityBundle?.peerId || payload.receipt.model !== response.model) {
          throw new Error('Remote receipt is invalid or does not bind this request');
        }
        const bound = await expectedReceiptBinding(pending.settings, pending.settingsDigest);
        if (!current()) return;
        if (!receiptBindsRequest(payload.receipt, response, pending.settings, bound)) {
          throw new Error('Receipt does not bind the generation settings of this request');
        }
        if (!await resultHonoursSettings(response, pending.settings)) {
          throw new Error('Provider output violates the generation settings of this request');
        }
        if (!current()) return;
        if ([2, 3].includes(Number(payload.receipt.version)) && (!pending.providerIdentity || payload.receipt.provider !== pending.providerIdentity
          || !await matchesWholeModelReceipt(payload.receipt, pending.messages, response, bound))) {
          throw new Error('Measured receipt differs from the admitted request or provider output');
        }
        const countersigned = await countersignReceipt(payload.receipt, identityBundle);
        if (!current()) return;
        swarmTransport.sendToPeer(remotePeerId, 'reploid:receipt', { receipt: countersigned });
        await updateConsumerReceiptCount();
        response.executionReceipt = countersigned;
      } else if (policy.models.contract !== null || pending.settings) {
        // A request with settings is accepted only with signed evidence of what was applied.
        throw new Error('Remote execution receipt is missing');
      }
      remoteRequests.settle(pending, { response });
    } catch (error) { remoteRequests.settle(pending, { error }); }
  };

  const handleGenerationError = async (remotePeerId, payload = {}) => {
    const pending = remoteRequests.get(payload.requestId, remotePeerId);
    if (!pending || pending.processing || !onAdmittedConnection(pending, remotePeerId)) return;
    const error = new Error(String(payload.error || 'Remote generation failed'));
    if (payload?.code === 'CONTEXT_LENGTH_EXCEEDED') {
      error.code = 'CONTEXT_LENGTH_EXCEEDED';
      error.status = 400;
    }
    if (payload?.terminal && pending.providerIdentity && identityBundle) {
      try {
        const binding = {
          requestId: pending.requestId,
          provider: pending.providerIdentity,
          consumer: identityBundle.peerId,
          model: pending.modelId,
          modelIdentity: pending.modelIdentity,
          adapterIdentities: pending.adapterIdentities,
          inputDigest: await hashJson(pending.messages),
          ...(pending.settingsDigest ? { settingsDigest: pending.settingsDigest } : {}),
        };
        if (await verifyGenerationTerminal(payload.terminal, binding)) {
          error.generationTerminal = snapshotJson(payload.terminal);
        }
      } catch {
        // Invalid terminal proof is ignored; normal request error settlement proceeds.
      }
    }
    remoteRequests.settle(pending, { error });
  };

  const handleReceipt = async (_remotePeerId, payload = {}) => {
    if (!payload?.receipt || !identityBundle) return;
    const verification = await verifyReceipt(payload.receipt);
    if (!verification.valid || !verification.consumerValid) return;
    if (payload.receipt.provider !== identityBundle.peerId) return;
    await ports.onReceipt?.(snapshotJson(payload.receipt));
    await updateProviderContribution(payload.receipt);
  };

  const removeQueuedBucketEntry = entry => {
    const bucket = consumerBuckets.get(entry.consumer);
    if (!bucket) return;
    const queue = bucket.lanes.get(entry.laneKey);
    if (queue) {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      if (!queue.length) {
        bucket.lanes.delete(entry.laneKey);
        const laneIndex = bucket.laneOrder.indexOf(entry.laneKey);
        if (laneIndex >= 0) bucket.laneOrder.splice(laneIndex, 1);
      }
    }
    if (!bucket.laneOrder.length) {
      consumerBuckets.delete(entry.consumer);
      const consumerIndex = consumerOrder.indexOf(entry.consumer);
      if (consumerIndex >= 0) consumerOrder.splice(consumerIndex, 1);
    }
  };

  const cancelQueuedInbound = (key, reason, notifyPeer = true) => {
    const entry = inboundQueued.get(key);
    if (!entry) return false;
    inboundQueued.delete(key);
    clearTimeout(entry.timer);
    removeQueuedBucketEntry(entry);
    entry.controller.abort(reason);
    if (notifyPeer && !closed) {
      swarmTransport?.sendToPeer(entry.remotePeerId, 'reploid:generation-error', {
        requestId: entry.requestId,
        error: reason?.message || 'Queued request cancelled'
      });
    }
    advertiseSelf();
    entry.resolve(false);
    return true;
  };

  const drainInboundQueue = () => {
    while (!closed && ready() && inbound.size < policy.mesh.maxInboundJobs && consumerOrder.length > 0) {
      const consumer = consumerOrder.shift();
      const bucket = consumerBuckets.get(consumer);
      if (!bucket || !bucket.laneOrder.length) {
        consumerBuckets.delete(consumer);
        continue;
      }
      const laneKey = bucket.laneOrder.shift();
      const queue = bucket.lanes.get(laneKey);
      if (!queue || !queue.length) {
        bucket.lanes.delete(laneKey);
        if (bucket.laneOrder.length) consumerOrder.push(consumer);
        else consumerBuckets.delete(consumer);
        continue;
      }
      const entry = queue.shift();
      if (queue.length) bucket.laneOrder.push(laneKey);
      else bucket.lanes.delete(laneKey);
      if (bucket.laneOrder.length) consumerOrder.push(consumer);
      else consumerBuckets.delete(consumer);
      inboundQueued.delete(entry.key);
      clearTimeout(entry.timer);
      inbound.set(entry.key, entry.controller);
      entry.resolve(true);
    }
  };

  const enqueueInboundSlot = (key, requestId, remotePeerId, consumer, contextId) => new Promise(resolve => {
    const laneKey = contextId || key;
    const entry = {
      key,
      requestId,
      remotePeerId,
      consumer,
      laneKey,
      controller: new AbortController(),
      resolve,
      timer: setTimeout(() => {
        cancelQueuedInbound(key, new Error('Remote job deadline exceeded'), true);
      }, policy.mesh.generationTimeoutMs)
    };
    let bucket = consumerBuckets.get(consumer);
    if (!bucket) {
      bucket = { laneOrder: [], lanes: new Map() };
      consumerBuckets.set(consumer, bucket);
      consumerOrder.push(consumer);
    }
    let queue = bucket.lanes.get(laneKey);
    if (!queue) {
      queue = [];
      bucket.lanes.set(laneKey, queue);
      bucket.laneOrder.push(laneKey);
    }
    queue.push(entry);
    inboundQueued.set(key, entry);
    advertiseSelf();
  });

  // Everything a provider decides about a request without reading its prompt. A request and its
  // admission both pass through here, so whatever is refused here is refused the same way before the
  // prompt is sent. Returns null once the request is dropped or refused.
  const inspectRequest = async (remotePeerId, payload) => {
    const requestId = String(payload.requestId || '').trim();
    const consumer = String(payload.consumer || remotePeerId).trim() || remotePeerId;
    const targetProvider = payload.provider ? String(payload.provider).trim() : null;
    const contextId = payload.contextId ?? null;
    if (contextId !== null && (typeof contextId !== 'string' || !contextId || contextId.length > 256)) return null;
    if (!requestId || requestId.length > 512) return null;
    let adapters;
    try { adapters = adapterSet(payload.adapterIdentities || []); } catch { return null; }
    if (targetProvider && targetProvider !== identityBundle.peerId && targetProvider !== swarmTransport.getPeerId?.()) return null;
    const refuse = error => { swarmTransport?.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error }); return null; };
    if (payload.admissionProtocol !== 2 || !payload.privacy || !payload.privacyBinding
      || !payload.offerId || !payload.consumer || !targetProvider || !digestValue(payload.modelIdentity)) {
      return refuse('Current execution policy and admission protocol required');
    }
    if (!peerIdentity || (peerIdentity.getVerified(remotePeerId) ?? await peerIdentity.verify(remotePeerId, lifetime.signal).catch(() => null)) !== consumer) {
      return refuse('Verified requester identity required');
    }
    const binding = currentModelBinding();
    if (!matchesRequestedModel(binding, payload) || !supportsAdapters(executionState(), adapters)) return refuse('Requested model is unavailable');
    if (policy.models.contract !== null && JSON.stringify(snapshotJson(payload.modelContract ?? null)) !== JSON.stringify(policy.models.contract)) return null;
    // Settings arrive canonical or the request is refused: a provider never repairs or defaults them.
    let settings;
    if (payload.settings !== undefined) {
      try {
        if (!isCanonicalGenerationSettings(payload.settings)) throw Error('Generation settings are not canonical');
        settings = normalizeGenerationSettings(payload.settings);
        assertSettingsSupported(settingsCapability(), settings);
      } catch (error) { return refuse(`Generation settings rejected: ${error.message}`); }
    }
    const checkPrivacy = async () => {
      const request = { privacy: payload.privacy, model: { id: binding.model, identity: binding.modelIdentity,
        adapters: adapters.map(identity => ({ identity })) } };
      const recipient = identityBundle.peerId;
      const currentOffers = currentExecutionOffers(binding.modelIdentity);
      const offer = eligibleExecutionOffers(request, currentOffers, [recipient]).find(item => item.id === payload.offerId);
      if (!offer) throw Error('Requested execution offer is unavailable');
      const expected = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [recipient], route: {
        schema: 'reploid.mesh-route/v1', providerId: recipient, offerId: offer.id, backend: offer.backend } }));
      if (!sameExecutionBinding(expected, payload.privacyBinding)) throw Error('Execution privacy binding changed');
      return expected;
    };
    let privacyBinding;
    try { privacyBinding = await checkPrivacy(); } catch { return refuse('Execution privacy binding rejected'); }
    return { requestId, consumer, contextId, adapters, binding, settings, checkPrivacy, privacyBinding, refuse, key: `${remotePeerId}:${requestId}` };
  };
  // What an admission binds: the request as sent, without the caller's text and without the admission fields.
  const canonicalConnection = peerId => {
    const binding = swarmTransport?.getPeerBinding?.(peerId);
    return binding ? JSON.stringify([binding.local, binding.remote, swarmTransport.getPeerStates?.().find(peer => peer.id === peerId)?.attemptId ?? null]) : null;
  };
  const admissionDigest = ({ messages: _messages, settings: _settings, admission: _admission, promptCommitment: _commitment, ...details }) => hashJson(details);
  const forgetAdmission = key => {
    admitting.delete(key);
    const entry = admitted.get(key);
    if (entry) { clearTimeout(entry.timer); admitted.delete(key); }
    return entry ?? null;
  };

  // A requester may ask for a decision before it sends the prompt. The message is the request without
  // its messages and settings, plus a salted commitment to them. Every check that does not read them runs
  // here, including the host's own decision, so a refusal reaches the requester before disclosure. The
  // requester has already checked its settings against this provider's advertisement.
  const handleGenerationAdmit = async (remotePeerId, payload = {}) => {
    if (closed || !admitsBeforeDisclosure || !policy.mesh.executeJobs || !ready() || !swarmEnabled || !swarmTransport || !identityBundle) return;
    try { payload = snapshotJson(payload); } catch { return; }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return;
    const request = await inspectRequest(remotePeerId, payload);
    if (!request) return;
    const { requestId, key, refuse } = request;
    if (payload.messages !== undefined || payload.settings !== undefined || payload.admission !== undefined || !PROMPT_COMMITMENT.test(payload.promptCommitment || '')
      || admitted.has(key) || admitting.has(key) || inbound.has(key) || inboundQueued.has(key) || completed.has(key)) return void refuse('Execution admission rejected');
    if (admitted.size + admitting.size >= policy.mesh.maxPendingJobs
      || inbound.size >= policy.mesh.maxInboundJobs && inboundQueued.size >= policy.mesh.maxPendingJobs) return void refuse('Provider is busy');
    if (!payload.recoverable && await generationJournal.get({ provider: identityBundle.peerId, consumer: request.consumer, requestId })) {
      return void refuse('Previously admitted execution requires recovery');
    }
    let allowed = false, digest;
    const channel = canonicalConnection(remotePeerId);
    admitting.add(key);
    try {
      allowed = await ports.authorize({ action: 'mesh.admit', peerId: remotePeerId, request: snapshotJson(payload) }) === true
        && sameExecutionBinding(request.privacyBinding, await request.checkPrivacy());
      digest = await admissionDigest(payload);
    } catch { allowed = false; }
    // A cancellation that arrived while the host was deciding withdraws the question.
    if (!admitting.delete(key) || closed) return;
    if (!allowed || !channel || channel !== canonicalConnection(remotePeerId) || !ready() || !bindingAvailable(request.binding, request.adapters)) return void refuse('The provider declined this request. The prompt was not sent.');
    if (admitted.has(key) || inbound.has(key) || inboundQueued.has(key)) return;
    const entry = { commitment: payload.promptCommitment, digest, channel,
      timer: setTimeout(() => { if (admitted.get(key) === entry) admitted.delete(key); }, policy.mesh.generationTimeoutMs) };
    admitted.set(key, entry);
    swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-admitted', { requestId, admissionProtocol: 2, promptCommitment: entry.commitment });
  };

  const validateDisclosedRequest = async (remotePeerId, payload, messages, signal) => {
    const request = await inspectRequest(remotePeerId, payload);
    if (!request || signal.aborted || closed) return;
    const { requestId, key, consumer, settings, binding, adapters } = request;
    // An admitted request must arrive exactly as admitted, with the prompt its commitment names. A request
    // that claims an admission this provider did not give, or skips one it did give, is refused.
    const admission = forgetAdmission(key);
    {
      let matches = false;
      try {
        matches = !!admission && admission.channel === canonicalConnection(remotePeerId) && admission.digest === await admissionDigest(payload)
          && admission.commitment === await promptCommitment(payload.admission?.salt, messages, payload.settings);
      } catch { matches = false; }
      if (!matches || admission.channel !== canonicalConnection(remotePeerId)) { request.refuse('Execution admission rejected'); return; }
    }
    // The digest is computed here from the received messages, settings and this provider's model.
    let settingsDigest = null;
    if (settings) {
      try { settingsDigest = await effectiveRequestDigest({ modelIdentity: binding.modelIdentity, adapterIdentities: adapters, messages, settings }); }
      catch (error) { request.refuse(`Generation settings rejected: ${error.message}`); return; }
    }
    if (signal.aborted || closed) return;
    // A replay cannot evade the durable fence by downgrading its protocol flag.
    const earlierAdmission = !payload.recoverable && await generationJournal.get({ provider: identityBundle.peerId, consumer, requestId });
    return { request, settingsDigest, earlierAdmission, channel: admission.channel };
  };

  const handleGenerationRequest = async (remotePeerId, payload = {}) => {
    if (closed || !policy.mesh.executeJobs || !ready() || !swarmEnabled || !swarmTransport || !identityBundle) return;

    try { payload = snapshotJson(payload); } catch { return; }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const requestId = String(payload.requestId || '').trim();
    if (!messages.length || !requestId || requestId.length > 512) return;
    const key = `${remotePeerId}:${requestId}`;
    if (validatingInbound.has(key) || inbound.has(key) || inboundQueued.has(key)) return;
    if (validatingInbound.size >= policy.mesh.maxInboundJobs + policy.mesh.maxPendingJobs) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Provider is busy' });
      return;
    }
    // A requester can leave while the provider hashes its commitment or reads its journal.
    // Keep the request reachable from cancellation until its execution or queue slot takes over.
    const validation = new AbortController();
    validatingInbound.set(key, validation);
    const inspection = validateDisclosedRequest(remotePeerId, payload, messages, validation.signal);
    inboundSettlements.add(inspection);
    let checked;
    try { checked = await inspection; }
    finally {
      validatingInbound.delete(key);
      inboundSettlements.delete(inspection);
    }
    if (!checked || validation.signal.aborted) return;
    const { request, settingsDigest, earlierAdmission, channel } = checked;
    // Conversation output leaves only on the connection this request was admitted on. If that connection
    // is gone the output is withheld, and a recoverable answer stays in the journal for a verified query.
    const sendOutput = (type, body) => canonicalConnection(remotePeerId) === channel
      && swarmTransport?.sendToPeer(remotePeerId, type, body);
    const { consumer, contextId, adapters, binding, settings, checkPrivacy, privacyBinding } = request;
    if (closed || !ready() || !bindingAvailable(binding, adapters)) return;
    if (earlierAdmission) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Previously admitted execution requires recovery' });
      return;
    }
    if (!payload.recoverable && completed.has(key)) {
      const previous = completed.get(key);
      sendOutput(previous.type, previous.payload);
      return;
    }
    if (inbound.has(key) || inboundQueued.has(key)) return;

    let controller;
    if (inbound.size < policy.mesh.maxInboundJobs && inboundQueued.size === 0) {
      controller = new AbortController();
      inbound.set(key, controller);
    } else if (inboundQueued.size >= policy.mesh.maxPendingJobs) {
      swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Provider is busy' });
      return;
    } else {
      const acquired = await enqueueInboundSlot(key, requestId, remotePeerId, consumer, contextId);
      if (!acquired) return;
      controller = inbound.get(key);
      if (!controller) return;
    }

    let finishSettlement;
    const settlement = new Promise(resolve => { finishSettlement = resolve; });
    inboundSettlements.add(settlement);
    const deadline = setTimeout(() => controller.abort(new Error('Remote job deadline exceeded')), policy.mesh.generationTimeoutMs);

    let recoveryBinding = null, claimedRecovery = false, retainedResult = false;
    try {
      if (closed) return;
      if (!ready() || !bindingAvailable(binding, adapters)) {
        swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', {
          requestId, error: 'Provider execution binding changed during authorization'
        });
        return;
      }
      controller.signal.throwIfAborted();
      // An asserted consumer string cannot select somebody else's decoder memory.
      const verifiedConsumer = (contextId || payload.recoverable === true)
        ? await peerIdentity.verify(remotePeerId, controller.signal) : null;
      if (contextId && (!verifiedConsumer || verifiedConsumer !== consumer)) throw Error('Generation context consumer identity changed');
      const contextOwner = contextId ? verifiedConsumer : null;
      if (payload.recoverable === true) {
        if (verifiedConsumer !== consumer) throw Error('Generation consumer identity changed');
        recoveryBinding = { requestId, provider: identityBundle.peerId, consumer, model: binding.model,
          modelIdentity: binding.modelIdentity, adapterIdentities: adapters, inputDigest: await hashJson(messages),
          ...(settingsDigest ? { settingsDigest } : {}) };
        const existing = await generationJournal.get(recoveryBinding);
        if (existing) {
          if (JSON.stringify(existing.binding) !== JSON.stringify(recoveryBinding)) throw Error('Generation replay binding changed');
          if (existing.outcome) sendOutput(existing.outcome.type, existing.outcome.payload);
          else swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Execution unresolved; query recovery without repeating it' });
          return;
        }
      }
      controller.signal.throwIfAborted();
      if (await ports.authorize({ action: 'mesh.execute', peerId: remotePeerId, request: snapshotJson(payload) }) !== true) return;
      if (!sameExecutionBinding(privacyBinding, await checkPrivacy())) throw Error('Execution privacy binding changed during authorization');
      if (recoveryBinding) {
        claimedRecovery = await generationJournal.claim(recoveryBinding);
        if (!claimedRecovery) {
          const previous = await generationJournal.get(recoveryBinding);
          if (JSON.stringify(previous?.binding) !== JSON.stringify(recoveryBinding)) throw Error('Generation replay binding changed');
          if (previous?.outcome) sendOutput(previous.outcome.type, previous.outcome.payload);
          else swarmTransport.sendToPeer(remotePeerId, 'reploid:generation-error', { requestId, error: 'Execution unresolved; query recovery without repeating it' });
          return;
        }
      }
      if (closed) return;
      if (!ready() || !bindingAvailable(binding, adapters)) {
        throw new Error('Provider execution binding changed during authorization');
      }
      controller.signal.throwIfAborted();
      advertiseSelf();
      let streamed = false, usageSent = false;
      const response = await generateBound(messages, (chunk) => {
        streamed = true;
        if (closed || controller.signal.aborted) return;
        sendOutput('reploid:generation-update', { requestId, chunk });
      }, { signal: controller.signal, adapterIdentities: adapters, requestId, consumer, contextOwner, contextId, privacyBinding, privacy: assertAvailableExecutionPolicy(requestExecutionPolicy({ privacy: payload.privacy })),
        ...(settings ? { settings } : {}),
        // The host's own prompt token count, sent at most once and only before any text. An update
        // without `chunk` is ignored by a requester that predates it, so nothing asks for it.
        onUsage: usage => {
          const inputTokens = usage?.inputTokens;
          if (streamed || usageSent || closed || controller.signal.aborted || !Number.isSafeInteger(inputTokens) || inputTokens <= 0) return;
          usageSent = true;
          sendOutput('reploid:generation-update', { requestId, usage: { inputTokens } });
        } }, binding);
      controller.signal.throwIfAborted();
      // With settings, the receipt signs the digest and the constraint the host reports it applied.
      const measured = await measureWholeModelReceipt(messages, response, settings
        ? { settingsDigest, constraintIdentity: response.constraintIdentity ?? null } : undefined);
      if (settings) {
        if (!measured) throw new Error('Generation settings require a measured completion');
        if (settings.maxOutputTokens !== null && measured.outputTokens > settings.maxOutputTokens) {
          throw new Error('Execution exceeded the admitted output limit');
        }
      }

      const receipt = await signReceiptDraft(
        await createReceiptDraft({
          provider: identityBundle.peerId,
          consumer,
          jobHash: `request:${requestId}`,
          model: response.model,
          inputTokens: 0,
          outputTokens: 0,
          status: 'unmetered',
          ...measured
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
      sendOutput('reploid:generation-result', result);
    } catch (error) {
      const payload = {
        requestId,
        error: error?.message || String(error),
        ...(error?.code === 'CONTEXT_LENGTH_EXCEEDED' ? { code: 'CONTEXT_LENGTH_EXCEEDED' } : {})
      };
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
        sendOutput('reploid:generation-error', payload);
      }
    } finally {
      while (completed.size > policy.mesh.maxRetainedJobs) completed.delete(completed.keys().next().value);
      clearTimeout(deadline);
      inbound.delete(key);
      drainInboundQueue();
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
          onVerified: () => { if (!closed) { bridgeEvents.emit('provider-ready', {}); emitSwarmState(); } } });
        recovery = createGenerationRecovery({ transport: swarmTransport, getIdentity: () => identityBundle,
          verifyPeer: (peer, signal) => peerIdentity.verify(peer, signal), journal: generationJournal,
          timeoutMs: REMOTE_GENERATION_TIMEOUT_MS, maxPending: policy.mesh.maxPendingJobs });
        swarmTransport.onMessage('reploid:peer-advertisement', handlePeerAdvertisement);
        swarmTransport.onMessage('reploid:generation-request', handleGenerationRequest);
        swarmTransport.onMessage('reploid:generation-admit', handleGenerationAdmit);
        swarmTransport.onMessage('reploid:generation-admitted', handleGenerationAdmitted);
        swarmTransport.onMessage('reploid:generation-update', handleGenerationUpdate);
        swarmTransport.onMessage('reploid:generation-result', handleGenerationResult);
        swarmTransport.onMessage('reploid:generation-error', handleGenerationError);
        swarmTransport.onMessage('reploid:generation-cancel', (peerId, payload = {}) => {
          const key = `${peerId}:${String(payload.requestId || '')}`;
          const reason = Object.assign(new Error('Requester stopped this job'), { code: 'REQUESTER_CANCELLED' });
          forgetAdmission(key);
          validatingInbound.get(key)?.abort(reason);
          if (!cancelQueuedInbound(key, reason, true)) inbound.get(key)?.abort(reason);
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
          unresponsivePeers.delete(peerId);
          remoteRequests.retirePeer(peerId);
          for (const key of [...admitted.keys(), ...admitting]) if (key.startsWith(`${peerId}:`)) forgetAdmission(key);
          for (const [key, controller] of validatingInbound) if (key.startsWith(`${peerId}:`)) controller.abort(new Error('Requester disconnected'));
          for (const key of [...inboundQueued.keys()]) if (key.startsWith(`${peerId}:`)) cancelQueuedInbound(key, new Error('Requester disconnected'), false);
          for (const [key, controller] of inbound) if (key.startsWith(`${peerId}:`)) controller.abort(new Error('Requester disconnected'));
          emitSwarmState();
        };
        subscriptions.push(eventBus.on('swarm:peer-left', retirePeer, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-disconnected', retirePeer, 'self-bridge'));
        // Ends only the requests waiting on this computer. Its signed work is not reinterpreted, and it is told to stop.
        subscriptions.push(eventBus.on('swarm:peer-unresponsive', ({ peerId }) => {
          unresponsivePeers.add(peerId);
          remoteRequests.retirePeer(peerId, { cancel: true });
          emitSwarmState();
        }, 'self-bridge'));
        subscriptions.push(eventBus.on('swarm:peer-responsive', ({ peerId }) => {
          unresponsivePeers.delete(peerId);
          emitSwarmState();
        }, 'self-bridge'));
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


  const generate = async (messages, onUpdate, { signal, modelId, modelIdentity = null, adapterIdentities = [], requestContext = null, privacy = null, offerId = null, settings = undefined, onUsage = undefined } = {}) => {
    if (closed) throw new Error('Mesh is closed');
    privacy = assertAvailableExecutionPolicy(privacy === null && modelConfig
      ? createExecutionPolicy() : requestExecutionPolicy({ privacy }));
    signal?.throwIfAborted();
    messages = snapshotJson(messages);
    settings = normalizeGenerationSettings(settings);
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
      assertSettingsSupported(settingsCapability(), settings);
      return generateBound(messages, onUpdate, { signal, adapterIdentities, contextOwner: 'local', contextId, privacy,
        ...(settings ? { settings } : {}) }, binding);
    }

    if (!swarmEnabled) {
      throw new Error('No model selected');
    }

    if (privacy.placement === 'local-only') throw new Error('Local-only privacy excludes mesh execution');
    await initialize();
    const affinityKey = contextId ? JSON.stringify([contextId, modelId, modelIdentity, adapterIdentities]) : null;
    // Providers serve this model but none advertises these settings: refuse now, from the advertisements
    // and naming what the default choice lacks, instead of waiting for a provider that enforces them.
    if (settings && !chooseCompatibleProvider(modelId, true, modelIdentity, adapterIdentities, null, privacy, offerId, settings)) {
      const unsupporting = chooseCompatibleProvider(modelId, true, modelIdentity, adapterIdentities, null, privacy, offerId);
      if (unsupporting) assertSettingsSupported(unsupporting.generationSettings, settings);
    }
    const pick = () => chooseProvider(modelId, signal, modelIdentity, adapterIdentities, contextProviders.get(affinityKey), privacy, offerId, settings);
    let provider = await pick();
    // With a block list, a candidate whose identity is not yet known is asked to prove it before it is
    // chosen; one that proves to be blocked is passed over for the next. Nothing is disclosed meanwhile.
    for (let passes = 0; passes < 8 && provider?.peerId && peerIdentity && provider.identityProtocol === 1
      && blockedComputers().size > 0 && !peerIdentity.getVerified(provider.peerId); passes++) {
      let proven;
      try { proven = await peerIdentity.verify(provider.peerId, signal); }
      catch { break; } // Dispatch below repeats the proof and reports its failure.
      if (!blockedComputers().has(proven)) break;
      reservedProviders.delete(provider.peerId);
      provider = await pick();
    }
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
      // Refused from the chosen provider's own advertisement, before identity proof or any disclosure.
      assertSettingsSupported(provider.generationSettings, settings);
      const settingsDigest = settings ? await effectiveRequestDigest({ modelIdentity, adapterIdentities, messages, settings }) : null;
      const connectionBinding = JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null);
      const recipientIdentity = provider.identityProtocol === 1 ? await peerIdentity.verify(provider.peerId, signal) : null;
      // A blocked identity can return on a new connection before it is recognised. The proof above is
      // the first moment it is known, and nothing has been disclosed yet.
      if (isBlockedProvider(provider.peerId) || recipientIdentity && blockedComputers().has(recipientIdentity)) {
        throw new Error('The available computer is blocked on this device. Nothing was sent. Retry to use another computer.');
      }
      if (!recipientIdentity) throw Error('Verified provider identity required; nothing was sent');
      const privacyRequest = { model: { id: modelId, identity: modelIdentity, adapters: adapterIdentities.map(identity => ({ identity })) }, privacy };
      const selectedOffer = eligibleExecutionOffers(privacyRequest, provider.executionOffers ?? [], [recipientIdentity])
        .filter(offer => !offerId || offer.id === offerId).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!selectedOffer) throw Error('Selected execution offer is unavailable');
      const privacyBinding = await bindExecutionRoute(privacyRequest, plaintextExecutionRoute(privacyRequest, {
        recipients: [recipientIdentity], route: { schema: 'reploid.mesh-route/v1', providerId: recipientIdentity,
          offerId: selectedOffer.id, backend: selectedOffer.backend } }));
      const requestId = utils.generateId('swarmreq');
      const salt = admissionSalt();
      const admission = { salt, commitment: await promptCommitment(salt, messages, settings ? snapshotJson(settings) : null), sent: false, send: null };
      const requestPayload = {
        requestId, consumer: identityBundle.peerId, provider: provider.peerId,
        ...(contextId && provider.identityProtocol === 1 ? { contextId } : {}),
        model: modelId || provider.model || null, modelIdentity, adapterIdentities,
        modelContract: policy.models.contract, admissionProtocol: 2, privacy, privacyBinding, offerId: selectedOffer.id, messages, ...(requestContext?.recoverable === true ? { recoverable: true } : {}),
        ...(settings ? { settings: snapshotJson(settings) } : {}),
        admission: { salt: admission.salt }
      };
      if (Number.isSafeInteger(policy.webrtc?.maxMessageBytes) && policy.webrtc.maxMessageBytes > 0
        && new TextEncoder().encode(JSON.stringify(requestPayload)).byteLength > policy.webrtc.maxMessageBytes) {
        throw new Error(`Conversation exceeds transport payload limit (${policy.webrtc.maxMessageBytes} bytes)`);
      }
      if (await ports.authorize({ action: 'mesh.dispatch', peerId: provider.peerId, modelId, modelIdentity, messages: snapshotJson(messages),
        requestId, recipientIdentity, privacyBinding, offerId: selectedOffer?.id ?? null, adapterIdentities: [...adapterIdentities], requestContext: snapshotJson(requestContext),
        placement: snapshotJson(placementChoices.get(provider) ?? null), ...(settings ? { settings: snapshotJson(settings) } : {}),
        // The provider will be asked to admit exactly this commitment before the prompt is sent, so a host
        // that reserves credit for the request can bind the same value.
        admission: { schema: 'reploid.generation-admission/v2', promptCommitment: admission.commitment } }) !== true) {
        throw new Error('Host denied remote prompt disclosure');
      }
      signal?.throwIfAborted();
      if (closed) throw new Error('Mesh is closed');
      const verifyCurrentRecipient = () => {
        const currentProvider = swarmController.listPeers().find(peer => peer.peerId === provider.peerId);
        if (!currentProvider || currentProvider.admissionProtocol !== 2 || currentProvider.identityProtocol !== 1
        || peerIdentity?.getVerified(provider.peerId) !== recipientIdentity
        || currentProvider.readiness !== 'ready' || !(currentProvider.availableSlots > 0)
        || JSON.stringify(swarmTransport.getPeerBinding?.(provider.peerId) || null) !== connectionBinding
        || currentProvider.model !== provider.model || currentProvider.modelIdentity !== provider.modelIdentity
        || !supportsAdapters(currentProvider, adapterIdentities)
        || JSON.stringify(currentProvider.executionOffers ?? null) !== JSON.stringify(provider.executionOffers ?? null)
        || JSON.stringify(snapshotJson(currentProvider.generationSettings ?? null)) !== JSON.stringify(snapshotJson(provider.generationSettings ?? null))) {
          throw new Error('Selected contributor is no longer ready; retry requires new placement');
        }
      };
      verifyCurrentRecipient();
      admission.channel = canonicalConnection(provider.peerId);
      const result = await remoteRequests.start({ requestId, modelId, modelIdentity, adapterIdentities,
        providerPeerId: provider.peerId, providerIdentity: recipientIdentity, messages, onUpdate, signal,
        ...(typeof onUsage === 'function' ? { onUsage } : {}),
        ...(settings ? { settings, settingsDigest } : {}), admission }, () => {
        admission.send = () => {
          signal?.throwIfAborted();
          verifyCurrentRecipient();
          return swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-request', requestPayload);
        };
        const { messages: _messages, settings: _settings, admission: _admission, ...details } = requestPayload;
        return swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-admit', { ...details, promptCommitment: admission.commitment });
      });
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

  const recoverGeneration = async (reference, messages, signal, { settings = undefined } = {}) => {
    await initialize(); signal?.throwIfAborted();
    reference = snapshotJson(reference); messages = snapshotJson(messages);
    settings = normalizeGenerationSettings(settings);
    if (!reference?.requestId || !reference.providerIdentity || !reference.providerId) throw Error('Bound recovery reference required');
    const adapters = adapterSet(reference.adapterIdentities);
    const settingsDigest = settings ? await effectiveRequestDigest({ modelIdentity: reference.modelIdentity,
      adapterIdentities: adapters, messages, settings }) : null;
    const binding = { requestId: reference.requestId, provider: reference.providerIdentity, consumer: identityBundle.peerId,
      model: reference.modelId, modelIdentity: reference.modelIdentity, adapterIdentities: adapters,
      inputDigest: await hashJson(messages), ...(settingsDigest ? { settingsDigest } : {}) };
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
    const bound = await expectedReceiptBinding(settings, settingsDigest);
    if (outcome.type !== 'reploid:generation-result' || receipt?.version !== (settings ? 3 : 2) || !verified?.providerValid
      || !receiptBindsRequest(receipt, response, settings, bound)
      || !await resultHonoursSettings(response, settings)
      || !matchesRequestedModel(response, modelBinding(binding.model, binding.modelIdentity))
      || receipt.provider !== binding.provider || receipt.consumer !== binding.consumer || receipt.model !== binding.model
      || receipt.jobHash !== `request:${binding.requestId}` || receipt.modelIdentity !== binding.modelIdentity
      || JSON.stringify(receipt.adapterIdentities) !== JSON.stringify(binding.adapterIdentities)
      || !await matchesWholeModelReceipt(receipt, messages, response, bound)) throw Error('Unverified recovered completion');
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
      for (const key of [...inboundQueued.keys()]) cancelQueuedInbound(key, new Error('Mesh closed'), false);
      for (const key of [...admitted.keys()]) forgetAdmission(key);
      for (const controller of validatingInbound.values()) controller.abort(new Error('Mesh closed'));
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
    getVerifiedPeerIdentity: peerId => peerIdentity?.getVerified(peerId) ?? null,
    verifyPeerIdentity: (peerId, signal) => {
      if (closed || !peerIdentity) throw new Error('Peer identity verification is unavailable');
      return peerIdentity.verify(peerId, signal);
    },
    refreshAdvertisement: () => { advertiseSelf(); return emitSwarmState(); },
    hasAvailableProvider: modelId => !closed && !!chooseCompatibleProvider(modelId, true), close, on: bridgeEvents.on });
}
