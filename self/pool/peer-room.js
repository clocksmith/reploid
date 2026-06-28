/**
 * @fileoverview Browser peer room for no-server Reploid job flow.
 */

import {
  createP2PProviderTransport,
  createP2PRequesterTransport
} from './p2p-transport.js';
import {
  createBroadcastPeerRoomBus
} from './peer-rendezvous.js';
import {
  P2P_PAYLOAD_TYPES,
  createP2PPayload,
  createReceiptPayload
} from './p2p-payload.js';
import {
  buildPeerAssignmentPlan,
  buildPeerReceiptAgreement,
  createPeerPromptPayload,
  validatePeerAssignmentForIntentAndAdvert,
  validatePromptPayloadForAssignment
} from './peer-control-plane.js';
import { getPolicy } from './config.js';

export const PEER_ROOM_VERSION = 'reploid_peer_room/v1';
export const DEFAULT_PEER_ROOM_ID = 'reploid-default';

const DEFAULT_DISCOVERY_WINDOW_MS = 1200;
const DEFAULT_RECEIPT_WINDOW_MS = 60000;
const DEFAULT_PROVIDER_ADVERT_INTERVAL_MS = 2500;
const DEFAULT_PROVIDER_SESSION_SETTLE_MS = 5000;

const requireString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const makeId = (prefix) => (
  `${prefix}_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
);

const openPeerRoomBus = ({
  roomId,
  roomBusFactory = createBroadcastPeerRoomBus,
  localPeerId = null,
  remotePeerId = null,
  sessionId = null,
  role = 'peer'
} = {}) => {
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  return roomBusFactory({
    roomId: resolvedRoomId,
    localPeerId,
    remotePeerId,
    sessionId,
    role
  });
};

function postRoomMessage(channel, roomId, type, body = {}) {
  channel.postMessage({
    peerRoomVersion: PEER_ROOM_VERSION,
    roomId,
    type,
    body,
    createdAt: new Date().toISOString()
  });
}

function createRoomSignaling({
  roomId = DEFAULT_PEER_ROOM_ID,
  sessionId,
  localPeerId,
  remotePeerId = null,
  roomBusFactory = createBroadcastPeerRoomBus
} = {}) {
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  const resolvedSessionId = requireString(sessionId, 'sessionId');
  const resolvedLocalPeerId = requireString(localPeerId, 'localPeerId');
  const resolvedRemotePeerId = remotePeerId ? requireString(remotePeerId, 'remotePeerId') : null;
  const channel = openPeerRoomBus({
    roomId: resolvedRoomId,
    roomBusFactory,
    sessionId: resolvedSessionId,
    localPeerId: resolvedLocalPeerId,
    remotePeerId: resolvedRemotePeerId,
    role: 'signaling'
  });
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

  const sendSignal = (signalType, payload = null) => {
    postRoomMessage(channel, resolvedRoomId, 'webrtc-signal', {
      sessionId: resolvedSessionId,
      signalType,
      fromPeerId: resolvedLocalPeerId,
      toPeerId: resolvedRemotePeerId,
      payload,
      createdAt: Date.now()
    });
  };

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
      channel.close();
      listeners.clear();
    }
  });
}

const summarizeAdvert = (advert = {}) => ({
  providerId: advert.body?.providerId || advert.fromPeerId || null,
  modelIds: (advert.body?.models || []).map((model) => model.modelId || model.id || 'unknown'),
  runtime: advert.body?.models?.[0]?.runtime || null,
  backend: advert.body?.models?.[0]?.backend || null
});

const createPeerDiscoveryError = ({ roomId, requiredModel, discoveryWindowMs, observedAdverts = [] } = {}) => {
  const mismatch = observedAdverts.length > 0;
  const modelLabel = requiredModel?.modelId || requiredModel?.id || 'selected model';
  const error = new Error(mismatch
    ? `Peer providers were found in this room, but none advertised ${modelLabel}`
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
      ? 'Start a contributor with the same selected model, or switch the request model to one the contributor advertises.'
      : 'Open Mesh in another tab with the same room, click Start, then run the request again.'
  };
  return error;
};

const waitForProviderAdverts = ({ channel, roomId, predicate, requiredModel = null, discoveryWindowMs, maxAdverts = null, settleOnFirst = false }) => new Promise((resolve, reject) => {
  const adverts = [];
  const observedAdverts = [];
  let settled = false;
  const timer = globalThis.setTimeout(() => {
    if (settled) return;
    settled = true;
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
    channel.removeEventListener('message', handler);
    resolve(adverts);
  };
  const handler = (event) => {
    const message = event?.data;
    if (message?.peerRoomVersion !== PEER_ROOM_VERSION) return;
    if (message.roomId !== roomId || message.type !== 'provider-advert') return;
    const advert = message.body?.advert;
    if (!advert) return;
    const summary = summarizeAdvert(advert);
    if (!observedAdverts.some((entry) => entry.providerId === summary.providerId)) {
      observedAdverts.push(summary);
    }
    if (predicate && !predicate(advert)) return;
    if (adverts.some((entry) => entry.messageHash === advert.messageHash)) return;
    adverts.push(advert);
    if (settleOnFirst || maxAdverts && adverts.length >= maxAdverts) finish();
  };
  channel.addEventListener('message', handler);
  postRoomMessage(channel, roomId, 'provider-advert-request', {});
});

const waitForRunAccepted = ({ channel, roomId, sessionId, providerId, requesterId, discoveryWindowMs }) => new Promise((resolve, reject) => {
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

export async function runPeerJob({
  roomId = DEFAULT_PEER_ROOM_ID,
  requesterClient,
  prompt,
  policyId,
  modelRequirements,
  generationConfig,
  maxPointSpend = null,
  discoveryWindowMs = DEFAULT_DISCOVERY_WINDOW_MS,
  receiptWindowMs = DEFAULT_RECEIPT_WINDOW_MS,
  requesterTransportFactory = createP2PRequesterTransport,
  roomBusFactory = createBroadcastPeerRoomBus
} = {}) {
  if (!requesterClient?.createPeerJobIntent) throw new TypeError('requesterClient with createPeerJobIntent() is required');
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  let channel = null;
  const sessions = [];
  try {
    const intent = await requesterClient.createPeerJobIntent({
      prompt,
      policyId,
      modelRequirements,
      generationConfig,
      maxPointSpend
    });
    channel = openPeerRoomBus({
      roomId: resolvedRoomId,
      roomBusFactory,
      localPeerId: intent.intent.body.requesterId,
      role: 'requester'
    });
    const requiredModel = intent.intent.body.modelRequirements || {};
    const policy = getPolicy(intent.intent.body.policyId);
    const maxAdverts = policy?.adaptiveRing
      ? Math.max(1, Number(policy.maxRingSize || 1))
      : Math.max(1, Number(policy?.redundancy || 1));
    const providerAdverts = await waitForProviderAdverts({
      channel,
      roomId: resolvedRoomId,
      discoveryWindowMs,
      maxAdverts,
      settleOnFirst: !policy?.adaptiveRing && maxAdverts <= 1,
      requiredModel,
      predicate: (advert) => advert?.body?.models?.some((model) => (
        model.modelId === requiredModel.modelId
        && model.modelHash === requiredModel.modelHash
        && model.manifestHash === requiredModel.manifestHash
        && (model.runtime || 'doppler') === (requiredModel.runtime || 'doppler')
        && (model.backend || 'browser-webgpu') === (requiredModel.backend || 'browser-webgpu')
      ))
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts
    });
    if (!plan.ok || !plan.assignment) {
      throw new Error(plan.reason || 'No peer assignment could be built');
    }
    for (const assignment of plan.assignments) {
      const sessionId = makeId('peer_session');
      const signaling = createRoomSignaling({
        roomId: resolvedRoomId,
        sessionId,
        localPeerId: assignment.requesterId,
        remotePeerId: assignment.providerId,
        roomBusFactory
      });
      let receiptTimer = null;
      let transport = null;
      const receiptPromise = new Promise((resolve, reject) => {
        receiptTimer = globalThis.setTimeout(() => {
          reject(new Error('No peer receipt returned in this room'));
        }, receiptWindowMs);
        transport = requesterTransportFactory({
          signaling,
          initiator: true,
          onMessage(payload) {
            if (payload?.type === P2P_PAYLOAD_TYPES.RECEIPT) {
              globalThis.clearTimeout(receiptTimer);
              receiptTimer = null;
              resolve(payload);
            }
            if (payload?.type === P2P_PAYLOAD_TYPES.ERROR) {
              globalThis.clearTimeout(receiptTimer);
              receiptTimer = null;
              reject(new Error(payload.body?.error || 'peer error'));
            }
          }
        });
      });
      if (!transport) throw new Error('peer requester transport was not created');
      sessions.push({
        assignment,
        signaling,
        transport,
        receiptPromise,
        clearReceiptTimer: () => {
          if (receiptTimer) globalThis.clearTimeout(receiptTimer);
          receiptTimer = null;
        }
      });
      postRoomMessage(channel, resolvedRoomId, 'peer-run-request', {
        sessionId,
        intent: intent.intent,
        assignment,
        assignmentId: assignment.assignmentId,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId
      });
    }
    await Promise.all(sessions.map((session) => waitForRunAccepted({
      channel,
      roomId: resolvedRoomId,
      sessionId: session.signaling.sessionId,
      providerId: session.assignment.providerId,
      requesterId: session.assignment.requesterId,
      discoveryWindowMs
    })));
    const promptPayloads = [];
    await Promise.all(sessions.map(async (session) => {
      await session.transport.connect();
      const promptPayload = await requesterClient.createPeerPromptPayload({
        assignment: session.assignment,
        prompt: intent.prompt,
        toPeerId: session.assignment.providerId
      });
      promptPayloads.push(promptPayload);
      session.transport.send(promptPayload);
    }));
    const receiptResults = await Promise.allSettled(sessions.map((session) => session.receiptPromise));
    const receiptPayloads = receiptResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const receiptErrors = receiptResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || String(result.reason));
    const agreement = await buildPeerReceiptAgreement({ plan, receiptPayloads });
    if (!agreement.accepted) {
      throw new Error(`Peer receipt agreement failed: ${agreement.validRecords.length}/${agreement.requiredAgreement} matching receipts${receiptErrors.length ? `; ${receiptErrors.join('; ')}` : ''}`);
    }
    const acceptance = requesterClient.createPeerReceiptAcceptance
      ? await requesterClient.createPeerReceiptAcceptance({
        receiptHash: agreement.receiptHash,
        accepted: true,
        agreement,
        receiptHashes: agreement.receiptHashes
      })
      : null;
    const ledgerEvents = requesterClient.createPeerLedgerEvents
      ? await requesterClient.createPeerLedgerEvents({ agreement })
      : [];
    if (acceptance) {
      for (const session of sessions) {
        session.transport.send(createP2PPayload({
          type: P2P_PAYLOAD_TYPES.ACCEPTANCE,
          assignmentId: session.assignment.assignmentId,
          jobId: session.assignment.jobId,
          fromPeerId: session.assignment.requesterId,
          toPeerId: session.assignment.providerId,
          body: {
            receiptHash: agreement.receiptHash,
            receiptHashes: agreement.receiptHashes,
            agreement,
            acceptance,
            ledgerEvents
          }
        }));
      }
    }
    const primaryRecord = agreement.acceptedRecords[0] || agreement.validRecords[0] || null;
    const receiptPayload = primaryRecord?.receiptPayload || receiptPayloads[0] || null;
    return {
      transport: 'webrtc_peer_room',
      roomId: resolvedRoomId,
      intentHash: plan.intentHash,
      plan,
      assignment: primaryRecord?.assignment || plan.assignment,
      assignments: plan.assignments,
      promptPayload: promptPayloads[0] || null,
      promptPayloads,
      receiptPayload,
      receiptPayloads,
      receiptRecord: receiptPayload?.body || null,
      receiptHash: agreement.receiptHash || receiptPayload?.body?.receiptHash || null,
      receiptHashes: agreement.receiptHashes,
      outputText: receiptPayload?.body?.outputText || '',
      tokenIds: receiptPayload?.body?.tokenIds || [],
      agreement,
      ledgerEvents,
      requesterAcceptance: acceptance,
      receiptErrors
    };
  } finally {
    channel?.close();
    for (const session of sessions) {
      session.clearReceiptTimer?.();
      if (session.transport?.close) await Promise.resolve(session.transport.close('requester_done')).catch(() => {});
      if (session.signaling?.close) session.signaling.close();
    }
  }
}

export function createPeerProviderNode({
  roomId = DEFAULT_PEER_ROOM_ID,
  providerClient,
  providerTransportFactory = createP2PProviderTransport,
  roomBusFactory = createBroadcastPeerRoomBus,
  advertIntervalMs = DEFAULT_PROVIDER_ADVERT_INTERVAL_MS,
  maxActiveSessions = 4,
  maxQueuedSessions = 16,
  onActivity = null
} = {}) {
  if (!providerClient?.createPeerProviderAdvert) {
    throw new TypeError('providerClient with createPeerProviderAdvert() is required');
  }
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  let channel = null;
  const activeTransports = new Set();
  let advert = null;
  let interval = null;
  let stopped = false;
  let drainingQueue = false;
  const pendingRunRequests = [];
  const activeExecutionSessions = new Set();

  const maxActiveSessionCount = () => Math.max(
    1,
    Number(advert?.body?.availability?.maxConcurrentJobs || maxActiveSessions || 1)
  );

  const releaseExecutionSlot = (sessionId) => {
    if (!sessionId || !activeExecutionSessions.has(sessionId)) return;
    activeExecutionSessions.delete(sessionId);
    drainQueuedRunRequests();
  };

  const removeActiveEntry = async (activeEntry, transport, signaling, reason = 'session_done') => {
    if (!activeEntry) return;
    activeTransports.delete(activeEntry);
    if (activeEntry.settleTimer) {
      globalThis.clearTimeout(activeEntry.settleTimer);
      activeEntry.settleTimer = null;
    }
    releaseExecutionSlot(activeEntry.sessionId);
    await Promise.resolve(transport?.close?.(reason)).catch(() => {});
    signaling?.close?.();
  };

  const queueRunRequest = (message) => {
    const sessionId = message?.body?.sessionId;
    if (!sessionId) return false;
    if (pendingRunRequests.some((entry) => entry.body?.sessionId === sessionId)) return true;
    if (pendingRunRequests.length >= Math.max(0, Number(maxQueuedSessions || 0))) {
      if (typeof onActivity === 'function') {
        onActivity({ status: 'peer_session_rejected', reason: 'provider_queue_full', sessionId });
      }
      return false;
    }
    pendingRunRequests.push(message);
    if (typeof onActivity === 'function') {
      onActivity({
        status: 'peer_session_queued',
        sessionId,
        queueDepth: pendingRunRequests.length,
        maxActiveSessions: maxActiveSessionCount()
      });
    }
    return true;
  };

  const drainQueuedRunRequests = () => {
    if (drainingQueue || stopped || pendingRunRequests.length === 0) return;
    drainingQueue = true;
    queueMicrotask(async () => {
      try {
        while (!stopped && pendingRunRequests.length > 0 && activeExecutionSessions.size < maxActiveSessionCount()) {
          const message = pendingRunRequests.shift();
          if (typeof onActivity === 'function') {
            onActivity({
              status: 'peer_session_dequeued',
              sessionId: message?.body?.sessionId || null,
              queueDepth: pendingRunRequests.length
            });
          }
          await handleRunRequest(message, { allowQueue: false });
        }
      } finally {
        drainingQueue = false;
        if (!stopped && pendingRunRequests.length > 0 && activeExecutionSessions.size < maxActiveSessionCount()) {
          drainQueuedRunRequests();
        }
      }
    });
  };

  const publishAdvert = () => {
    if (!advert || stopped) return;
    postRoomMessage(channel, resolvedRoomId, 'provider-advert', { advert });
    if (typeof onActivity === 'function') onActivity({ status: 'provider_advertised', advert });
  };

  const handlePromptPayload = async ({ assignment, activeEntry, transport, signaling, payload }) => {
    const validation = await validatePromptPayloadForAssignment(payload, assignment);
    if (!validation.ok) {
      transport.send(createP2PPayload({
        type: P2P_PAYLOAD_TYPES.ERROR,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId,
        body: {
          error: validation.reasons.join('; ')
        }
      }));
      void removeActiveEntry(activeEntry, transport, signaling, 'prompt_rejected');
      return;
    }
    const result = await providerClient.executePeerAssignment(assignment, { promptPayload: payload });
    const receiptRecord = {
      receiptHash: result.receiptHash,
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      outputText: result.execution.outputText,
      tokenIds: result.execution.tokenIds || [],
      transcript: result.execution.transcript || null,
      receipt: result.receipt,
      providerPublicKey: advert.publicKey,
      peerDecision: {
        accepted: true,
        source: 'provider_signed_peer_execution',
        decidedAt: new Date().toISOString()
      }
    };
    const receiptPayload = await createReceiptPayload({
      assignment,
      receiptRecord,
      fromPeerId: assignment.providerId,
      toPeerId: assignment.requesterId
    });
    transport.send(receiptPayload);
    if (typeof onActivity === 'function') {
      onActivity({
        status: 'peer_receipt_sent',
        assignment,
        receiptRecord
      });
    }
    releaseExecutionSlot(activeEntry?.sessionId);
    if (activeEntry && !activeEntry.settleTimer) {
      activeEntry.settleTimer = globalThis.setTimeout(() => {
        void removeActiveEntry(activeEntry, transport, signaling, 'receipt_sent');
      }, DEFAULT_PROVIDER_SESSION_SETTLE_MS);
    }
  };

  const handleRunRequest = async (message, { allowQueue = true } = {}) => {
    if (stopped) return;
    const body = message.body || {};
    if (!body.intent || !body.sessionId) return;
    if ([...activeTransports].some((entry) => entry.sessionId === body.sessionId)) return;
    const advertisedProviderId = advert?.body?.providerId || advert?.fromPeerId || null;
    if (advertisedProviderId) {
      if (body.providerId && body.providerId !== advertisedProviderId) return;
      if (body.assignment?.providerId && body.assignment.providerId !== advertisedProviderId) return;
    }
    if (activeExecutionSessions.size >= maxActiveSessionCount()) {
      if (allowQueue && queueRunRequest(message)) return;
      if (typeof onActivity === 'function') {
        onActivity({ status: 'peer_session_rejected', reason: 'provider_busy', sessionId: body.sessionId });
      }
      return;
    }
    let assignment = body.assignment || null;
    if (assignment) {
      const validation = await validatePeerAssignmentForIntentAndAdvert({
        assignment,
        jobIntent: body.intent,
        providerAdvert: advert
      });
      if (!validation.ok) {
        if (typeof onActivity === 'function') onActivity({ status: 'peer_assignment_rejected', reasons: validation.reasons });
        return;
      }
    } else {
      const plan = await buildPeerAssignmentPlan({
        jobIntent: body.intent,
        providerAdverts: [advert]
      });
      if (!plan.ok || !plan.assignment) return;
      assignment = plan.assignment;
    }
    if (body.assignmentId && body.assignmentId !== assignment.assignmentId) return;
    if (body.providerId && body.providerId !== assignment.providerId) return;
    const signaling = createRoomSignaling({
      roomId: resolvedRoomId,
      sessionId: body.sessionId,
      localPeerId: assignment.providerId,
      remotePeerId: assignment.requesterId,
      roomBusFactory
    });
    let activeEntry = null;
    const transport = providerTransportFactory({
      signaling,
      initiator: false,
      onMessage(payload) {
        if (payload?.type === P2P_PAYLOAD_TYPES.PROMPT) {
          void handlePromptPayload({ assignment, activeEntry, transport, signaling, payload }).catch((error) => {
            try {
              transport.send(createP2PPayload({
                type: P2P_PAYLOAD_TYPES.ERROR,
                assignmentId: assignment.assignmentId,
                jobId: assignment.jobId,
                fromPeerId: assignment.providerId,
                toPeerId: assignment.requesterId,
                body: {
                  error: error.message
                }
              }));
            } catch {
              // Requester may already have closed after timing out or aborting.
            } finally {
              void removeActiveEntry(activeEntry, transport, signaling, 'provider_error');
            }
          });
        }
        if (payload?.type === P2P_PAYLOAD_TYPES.ACCEPTANCE) {
          if (typeof onActivity === 'function') {
            onActivity({
              status: 'peer_acceptance_received',
              assignment,
              acceptance: payload.body?.acceptance || null,
              agreement: payload.body?.agreement || null,
              ledgerEvents: payload.body?.ledgerEvents || []
            });
          }
          void removeActiveEntry(activeEntry, transport, signaling, 'acceptance_received');
        }
      }
    });
    activeEntry = {
      sessionId: body.sessionId,
      transport,
      signaling,
      settleTimer: null
    };
    activeTransports.add(activeEntry);
    activeExecutionSessions.add(body.sessionId);
    if (typeof onActivity === 'function') onActivity({ status: 'peer_session_opening', assignment });
    const ready = transport.connect();
    postRoomMessage(channel, resolvedRoomId, 'peer-run-accepted', {
      sessionId: body.sessionId,
      assignmentId: assignment.assignmentId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId
    });
    try {
      await ready;
      if (typeof onActivity === 'function') onActivity({ status: 'peer_session_open', assignment });
    } catch (error) {
      await removeActiveEntry(activeEntry, transport, signaling, 'session_failed');
      throw error;
    }
  };

  const handler = (event) => {
    const message = event?.data;
    if (message?.peerRoomVersion !== PEER_ROOM_VERSION || message.roomId !== resolvedRoomId) return;
    if (message.type === 'provider-advert-request') {
      publishAdvert();
      return;
    }
    if (message.type === 'peer-run-request') {
      void handleRunRequest(message).catch((error) => {
        if (typeof onActivity === 'function') onActivity({ status: 'peer_session_failed', error: error.message });
      });
    }
  };

  return Object.freeze({
    async start(options = {}) {
      if (stopped) throw new Error('peer provider node is stopped');
      advert = await providerClient.createPeerProviderAdvert(options);
      channel = openPeerRoomBus({
        roomId: resolvedRoomId,
        roomBusFactory,
        localPeerId: advert.body?.providerId || advert.fromPeerId,
        role: 'provider'
      });
      channel.addEventListener('message', handler);
      publishAdvert();
      interval = globalThis.setInterval(publishAdvert, advertIntervalMs);
      return {
        roomId: resolvedRoomId,
        advert,
        status: 'peer_provider_listening'
      };
    },
    async stop() {
      stopped = true;
      if (interval) globalThis.clearInterval(interval);
      interval = null;
      pendingRunRequests.length = 0;
      channel?.removeEventListener('message', handler);
      for (const entry of activeTransports) {
        releaseExecutionSlot(entry.sessionId);
        if (entry.settleTimer) globalThis.clearTimeout(entry.settleTimer);
        if (entry.transport?.close) await Promise.resolve(entry.transport.close('provider_stop')).catch(() => {});
        entry.signaling.close?.();
      }
      activeTransports.clear();
      activeExecutionSessions.clear();
      channel?.close();
      channel = null;
      return {
        roomId: resolvedRoomId,
        status: 'peer_provider_stopped'
      };
    },
    getAdvert() {
      return advert;
    }
  });
}

export default {
  DEFAULT_PEER_ROOM_ID,
  PEER_ROOM_VERSION,
  createPeerProviderNode,
  runPeerJob
};
