/** Peer room signaling, discovery and bounded protocol helpers. */
import timing from '../config/peer-timing.json' with { type: 'json' };
import { observeWithTimeout as withTimeout } from './observation-timeout.js';

import {
  createBroadcastPeerRoomBus
} from './peer-rendezvous.js';

export const PEER_ROOM_VERSION = 'reploid_peer_room/v1';

export const DEFAULT_PEER_ROOM_ID = 'reploid-default';

export const {
  discoveryWindowMs: DEFAULT_DISCOVERY_WINDOW_MS, receiptWindowMs: DEFAULT_RECEIPT_WINDOW_MS,
  queueWindowMs: DEFAULT_QUEUE_WINDOW_MS, sessionAcceptWindowMs: DEFAULT_PROVIDER_SESSION_SETTLE_MS
} = timing.generic;

export const {
  advertIntervalMs: DEFAULT_PROVIDER_ADVERT_INTERVAL_MS, advertSettleMs: DEFAULT_PROVIDER_ADVERT_SETTLE_MS,
  adaptiveRingAdvertSettleMs: DEFAULT_ADAPTIVE_RING_ADVERT_SETTLE_MS,
  minimumExecutionMarginMs: MIN_DISCOVERY_EXECUTION_MARGIN_MS
} = timing.provider;

export const requireString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

export const makeId = (prefix) => (
  `${prefix}_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
);

export const positiveInteger = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

export const connectPeerTransport = async ({ session, timeoutMs } = {}) => {
  try {
    await withTimeout(
      session.transport.connect(),
      timeoutMs,
      `Peer transport did not connect for provider ${session.assignment.providerId}`
    );
    // Receipt agreement can trigger an intentional remote teardown before the
    // requester renders its result. Keep an immutable connection-time sample
    // so the receipt describes the transport that actually carried the input
    // and receipt, rather than a later ICE terminal transition.
    session.connectedDiagnostics = session.transport?.getDiagnostics?.() || null;
  } catch (error) {
    const connectionError = error instanceof Error ? error : new Error(String(error));
    if (!connectionError.code) connectionError.code = 'webrtc_connection_timeout';
    if (!connectionError.diagnostics) {
      connectionError.diagnostics = session.transport?.getDiagnostics?.() || null;
    }
    if (!connectionError.action) {
      connectionError.action = connectionError.diagnostics?.turnConfigured
        ? 'WebRTC did not connect through the configured TURN relay. Check network policy or TURN service health, then try again.'
        : 'Direct ICE connectivity did not settle and no TURN relay is configured.';
    }
    connectionError.retryable = true;
    throw connectionError;
  }
};

export const resolvePromptDispatchConcurrency = (value, sessionCount) => {
  const configured = value ?? globalThis.REPLOID_POOL_PROMPT_DISPATCH_CONCURRENCY ?? 1;
  return Math.max(1, Math.min(Math.max(1, Number(sessionCount || 1)), positiveInteger(configured, 1)));
};

export const openPeerRoomBus = ({
  roomId,
  roomBusFactory = createBroadcastPeerRoomBus,
  localPeerId = null,
  remotePeerId = null,
  sessionId = null,
  relayAckSigner = null,
  onRelayStatus = null,
  role = 'peer'
} = {}) => {
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  return roomBusFactory({
    roomId: resolvedRoomId,
    localPeerId,
    remotePeerId,
    sessionId,
    relayAckSigner,
    onStatus: onRelayStatus,
    role
  });
};

export function postRoomMessage(channel, roomId, type, body = {}) {
  return channel.postMessage({
    peerRoomVersion: PEER_ROOM_VERSION,
    roomId,
    type,
    body,
    createdAt: new Date().toISOString()
  });
}

export function createRoomSignaling({
  roomId = DEFAULT_PEER_ROOM_ID,
  sessionId,
  localPeerId,
  remotePeerId = null,
  relayAckSigner = null,
  onRelayStatus = null,
  sharedChannel = null,
  roomBusFactory = createBroadcastPeerRoomBus
} = {}) {
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  const resolvedSessionId = requireString(sessionId, 'sessionId');
  const resolvedLocalPeerId = requireString(localPeerId, 'localPeerId');
  const resolvedRemotePeerId = remotePeerId ? requireString(remotePeerId, 'remotePeerId') : null;
  const channel = sharedChannel || openPeerRoomBus({
    roomId: resolvedRoomId,
    roomBusFactory,
    sessionId: resolvedSessionId,
    localPeerId: resolvedLocalPeerId,
    remotePeerId: resolvedRemotePeerId,
    relayAckSigner,
    onRelayStatus,
    role: 'signaling'
  });
  if (!channel?.addEventListener || !channel?.removeEventListener || !channel?.postMessage) {
    throw new TypeError('sharedChannel must implement the peer room bus contract');
  }
  const listeners = new Set();
  const handler = (event) => {
    const message = event?.data;
    if (message?.peerRoomVersion !== PEER_ROOM_VERSION) return;
    if (message.roomId !== resolvedRoomId || message.type !== 'webrtc-signal') return;
    const signal = message.body || {};
    if (signal.sessionId !== resolvedSessionId) return;
    if (signal.fromPeerId === resolvedLocalPeerId) return;
    if (resolvedRemotePeerId && signal.fromPeerId !== resolvedRemotePeerId) return;
    if (signal.toPeerId && signal.toPeerId !== resolvedLocalPeerId) return;
    for (const listener of listeners) listener({
      sessionId: resolvedSessionId,
      assignmentId: signal.assignmentId || null,
      type: signal.signalType,
      fromPeerId: signal.fromPeerId,
      toPeerId: signal.toPeerId || null,
      payload: signal.payload ?? null,
      createdAt: signal.createdAt || Date.now()
    });
  };
  channel.addEventListener('message', handler);

  const sendSignal = (signalType, payload = null) => (
    postRoomMessage(channel, resolvedRoomId, 'webrtc-signal', {
      sessionId: resolvedSessionId,
      signalType,
      fromPeerId: resolvedLocalPeerId,
      toPeerId: resolvedRemotePeerId,
      payload,
      createdAt: Date.now()
    })
  );

  return Object.freeze({
    roomId: resolvedRoomId,
    sessionId: resolvedSessionId,
    localPeerId: resolvedLocalPeerId,
    remotePeerId: resolvedRemotePeerId,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendOffer: (description) => sendSignal('offer', description),
    sendAnswer: (description) => sendSignal('answer', description),
    sendIceCandidate: (candidate) => sendSignal('ice-candidate', candidate),
    sendClose: (reason = null) => sendSignal('close', { reason }),
    close() {
      channel.removeEventListener('message', handler);
      if (!sharedChannel) channel.close();
      listeners.clear();
    }
  });
}

export const summarizeAdvert = (advert = {}) => ({
  providerId: advert.body?.providerId || advert.fromPeerId || null,
  modelIds: (advert.body?.models || []).map((model) => model.modelId || model.id || 'unknown'),
  runtime: advert.body?.models?.[0]?.runtime || null,
  backend: advert.body?.models?.[0]?.backend || null
});

export const createPeerDiscoveryError = ({ roomId, requiredModel, discoveryWindowMs, observedAdverts = [] } = {}) => {
  const mismatch = observedAdverts.length > 0;
  const modelLabel = requiredModel?.modelId || requiredModel?.id || 'selected model';
  const error = new Error(mismatch
    ? `Peer providers were found in room "${roomId}", but none offered ${modelLabel}`
    : `No peer providers advertised in room "${roomId}"`);
  error.code = mismatch ? 'peer_provider_model_mismatch' : 'peer_provider_not_found';
  error.retryable = true;
  error.payload = {
    roomId,
    requiredModel,
    discoveryWindowMs,
    observedProviderCount: observedAdverts.length,
    observedProviders: observedAdverts,
    action: mismatch
      ? `Start contributing in Compute to download and host ${modelLabel} locally in this browser, or switch your request model to one offered in room "${roomId}".`
      : `Start contributing in Compute to download and host ${modelLabel} locally in this browser, or open another tab in room "${roomId}".`
  };
  return error;
};

export const createPeerPlanError = (plan = {}) => {
  const error = new Error(plan.reason || 'No peer assignment could be built');
  error.code = plan.reason || 'peer_assignment_plan_failed';
  error.retryable = true;
  error.payload = {
    requiredProviders: plan.requiredProviders ?? null,
    eligibleProviders: plan.eligibleProviders ?? null,
    compatibleProviders: plan.compatibleProviders ?? null,
    routeCandidates: plan.routeCandidates || [],
    action: 'Review the contributor eligibility records, then retry with enough compatible contributors.'
  };
  return error;
};

export const createPeerAcceptanceError = ({
  roomId,
  requiredAcceptedSessions,
  acceptedSessions = [],
  sessions = [],
  acceptErrors = []
} = {}) => {
  const error = new Error(
    `Peer provider acceptance failed: ${acceptedSessions.length}/${requiredAcceptedSessions} accepted`
    + `${acceptErrors.length ? `; ${acceptErrors.join('; ')}` : ''}`
  );
  error.code = 'peer_provider_unresponsive';
  error.retryable = true;
  error.payload = {
    roomId,
    requiredAcceptedSessions,
    acceptedSessionCount: acceptedSessions.length,
    unresponsiveProviderIds: sessions
      .filter((session) => !acceptedSessions.includes(session))
      .map((session) => session.assignment?.providerId)
      .filter(Boolean),
    action: 'The contributor stopped responding after discovery. Search again, run on this device, or invite another contributor.'
  };
  return error;
};

export const createPeerReceiptAgreementError = ({
  roomId,
  agreement,
  receiptPayloads = [],
  receiptFailures = []
} = {}) => {
  const validReceiptCount = Number(agreement?.validRecords?.length || 0);
  const requiredAgreement = Number(agreement?.requiredAgreement || 1);
  const providerFailures = receiptFailures.map((failure) => ({
    providerId: failure.providerId || null,
    code: failure.code || null,
    message: failure.message || 'Contributor did not return a receipt',
    diagnostics: failure.diagnostics || null
  }));
  const providerUnavailable = receiptPayloads.length === 0
    && providerFailures.length > 0
    && providerFailures.every((failure) => (
      failure.code === 'webrtc_connection_timeout'
      || failure.code === 'peer_receipt_timeout'
      || failure.code === 'peer_queue_timeout'
    ));
  const error = new Error(
    `Peer receipt agreement failed: ${validReceiptCount}/${requiredAgreement} matching receipts`
    + `${providerFailures.length ? `; ${providerFailures.map((failure) => failure.message).join('; ')}` : ''}`
  );
  error.code = providerUnavailable ? 'peer_provider_unresponsive' : 'peer_receipt_agreement_failed';
  error.retryable = true;
  error.diagnostics = { providerFailures };
  error.payload = {
    roomId,
    requiredAgreement,
    validReceiptCount,
    receiptCount: receiptPayloads.length,
    failedProviderIds: providerFailures.map((failure) => failure.providerId).filter(Boolean),
    providerFailures,
    action: providerUnavailable
      ? 'The selected contributor stopped responding before a signed receipt arrived. Search again, run on this device, or invite another contributor.'
      : 'The returned receipts did not satisfy the selected agreement policy. Retry with compatible contributors or inspect the provider evidence.'
  };
  return error;
};

export const waitForProviderAdverts = ({
  channel,
  roomId,
  predicate,
  requiredModel = null,
  discoveryWindowMs,
  knownProviderAdverts = [],
  maxAdverts = null,
  minAdverts = 1,
  settleOnFirst = false,
  settleWindowMs = DEFAULT_PROVIDER_ADVERT_SETTLE_MS
}) => new Promise((resolve, reject) => {
  const discoveryRequestId = makeId('provider_discovery');
  const adverts = [];
  const observedAdverts = [];
  const knownByProviderId = new Map((Array.isArray(knownProviderAdverts) ? knownProviderAdverts : [])
    .map((advert) => [advert?.body?.providerId || advert?.fromPeerId || null, advert])
    .filter(([providerId, advert]) => providerId && advert));
  let settled = false;
  let settleTimer = null;
  let discoveryRequestTimer = null;
  const clearDiscoveryRequestTimer = () => {
    if (!discoveryRequestTimer) return;
    globalThis.clearInterval(discoveryRequestTimer);
    discoveryRequestTimer = null;
  };
  const clearSettleTimer = () => {
    if (!settleTimer) return;
    globalThis.clearTimeout(settleTimer);
    settleTimer = null;
  };
  const timer = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    clearSettleTimer();
    clearDiscoveryRequestTimer();
    channel.removeEventListener('message', handler);
    if (adverts.length > 0) resolve(adverts);
    else reject(createPeerDiscoveryError({
      roomId,
      requiredModel,
      discoveryWindowMs,
      observedAdverts
    }));
  }, discoveryWindowMs);
  const finish = () => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timer);
    clearSettleTimer();
    clearDiscoveryRequestTimer();
    channel.removeEventListener('message', handler);
    resolve(adverts);
  };
  const armSettleTimer = () => {
    clearSettleTimer();
    if (settleOnFirst || adverts.length < Math.max(1, Number(minAdverts || 1))) return;
    const settleMs = Math.max(0, Number(settleWindowMs || 0));
    if (settleMs === 0) {
      finish();
      return;
    }
    settleTimer = globalThis.setTimeout(finish, settleMs);
  };
  const handler = (event) => {
    const message = event?.data;
    if (message?.peerRoomVersion !== PEER_ROOM_VERSION) return;
    if (message.roomId !== roomId || message.type !== 'provider-advert') return;
    if (message.body?.discoveryRequestId !== discoveryRequestId) return;
    const liveAdvert = message.body?.advert;
    if (!liveAdvert) return;
    const providerId = liveAdvert.body?.providerId || liveAdvert.fromPeerId || null;
    const knownAdvert = knownByProviderId.get(providerId);
    // A live response proves liveness; reuse the preserved advert only when it
    // is exactly the same signed record. Do not plan with stale provider data.
    const advert = knownAdvert?.messageHash === liveAdvert.messageHash
      ? knownAdvert
      : liveAdvert;
    const summary = summarizeAdvert(liveAdvert);
    if (!observedAdverts.some((entry) => entry.providerId === summary.providerId)) {
      observedAdverts.push(summary);
    }
    if (predicate && (!predicate(liveAdvert) || !predicate(advert))) return;
    if (adverts.some((entry) => entry.messageHash === advert.messageHash)) return;
    adverts.push(advert);
    if (settleOnFirst || maxAdverts && adverts.length >= maxAdverts) finish();
    else armSettleTimer();
  };
  channel.addEventListener('message', handler);
  const requestLiveAdverts = () => postRoomMessage(channel, roomId, 'provider-advert-request', {
    discoveryRequestId
  });
  const requestIntervalMs = Math.max(1, Math.min(1000, Math.floor(Number(discoveryWindowMs || 1) / 2)));
  discoveryRequestTimer = globalThis.setInterval(() => {
    if (!settled) void Promise.resolve(requestLiveAdverts()).catch(() => null);
  }, requestIntervalMs);
  Promise.resolve(requestLiveAdverts()).catch((error) => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timer);
    clearSettleTimer();
    clearDiscoveryRequestTimer();
    channel.removeEventListener('message', handler);
    reject(error);
  });
});

export const waitForRunAccepted = ({ channel, roomId, sessionId, providerId, requesterId, discoveryWindowMs }) => new Promise((resolve, reject) => {
  let settled = false;
  const timer = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
    channel.removeEventListener('message', handler);
    reject(new Error('Peer provider did not accept the run session'));
  }, discoveryWindowMs);
  const handler = (event) => {
    const message = event?.data;
    if (message?.peerRoomVersion !== PEER_ROOM_VERSION) return;
    if (message.roomId !== roomId || message.type !== 'peer-run-accepted') return;
    const body = message.body || {};
    if (body.sessionId !== sessionId) return;
    if (body.providerId !== providerId) return;
    if (body.requesterId !== requesterId) return;
    settled = true;
    globalThis.clearTimeout(timer);
    channel.removeEventListener('message', handler);
    resolve(body);
  };
  channel.addEventListener('message', handler);
});
