/** Provider room advertisement, admission and owned session lifecycle. */
import timing from '../config/peer-timing.json' with { type: 'json' };

import { P2P_TRANSPORT_STATES, createP2PProviderTransport } from "../../../shared/pool/p2p-transport.js";
import {
  createBroadcastPeerRoomBus
} from './peer-rendezvous.js';
import { P2P_PAYLOAD_TYPES, createP2PPayload, createReceiptPayload } from "./p2p-payload.js";
import { buildPeerAssignmentPlan, validatePeerAssignmentForIntentAndAdvert, validateInputPayloadForAssignment } from "./peer-control-plane.js";

import { PEER_ROOM_VERSION, DEFAULT_PEER_ROOM_ID, DEFAULT_PROVIDER_ADVERT_INTERVAL_MS, openPeerRoomBus, postRoomMessage, createRoomSignaling } from "./peer-room-support.js";

export function createPeerProviderNode({
  roomId = DEFAULT_PEER_ROOM_ID,
  providerClient,
  providerTransportFactory = createP2PProviderTransport,
  rtcConfigProvider = null,
  roomBusFactory = createBroadcastPeerRoomBus,
  relayAckSigner = null,
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
  const pendingInputExecutions = [];
  const activeExecutionSessions = new Set();

  const maxActiveSessionCount = () => Math.max(
    1,
    Number(advert?.body?.availability?.maxConcurrentJobs || maxActiveSessions || 1)
  );

  const maxOpenSessionCount = () => (
    maxActiveSessionCount() + Math.max(0, Number(maxQueuedSessions || 0))
  );

  const releaseExecutionSlot = (sessionId) => {
    if (!sessionId || !activeExecutionSessions.has(sessionId)) return;
    activeExecutionSessions.delete(sessionId);
    drainQueuedInputExecutions();
  };

  const removeActiveEntry = async (activeEntry, transport, signaling, reason = 'session_done') => {
    if (!activeEntry || activeEntry.closing) return;
    activeEntry.closing = true;
    activeTransports.delete(activeEntry);
    for (let index = pendingInputExecutions.length - 1; index >= 0; index -= 1) {
      if (pendingInputExecutions[index]?.activeEntry === activeEntry) {
        pendingInputExecutions.splice(index, 1);
      }
    }
    if (activeEntry.settleTimer) {
      globalThis.clearTimeout(activeEntry.settleTimer);
      activeEntry.settleTimer = null;
    }
    // Closing a requester transport removes its delivery path, not the work
    // already running behind that path. executeInputPayload owns the execution
    // slot until the runtime promise settles; releasing it here would let a
    // retry overlap an abandoned GPU execution on a single-job provider.
    await Promise.resolve(transport?.close?.(reason)).catch(() => {});
    signaling?.close?.();
  };

  const queueInputExecution = (entry) => {
    const sessionId = entry?.activeEntry?.sessionId;
    if (!sessionId) return false;
    if (pendingInputExecutions.some((queued) => queued.activeEntry?.sessionId === sessionId)) return true;
    if (pendingInputExecutions.length >= Math.max(0, Number(maxQueuedSessions || 0))) {
      if (typeof onActivity === 'function') {
        onActivity({ status: 'peer_session_rejected', reason: 'provider_queue_full', sessionId });
      }
      return false;
    }
    pendingInputExecutions.push(entry);
    try {
      entry.transport.send(createP2PPayload({
        type: P2P_PAYLOAD_TYPES.QUEUED,
        assignmentId: entry.assignment.assignmentId,
        jobId: entry.assignment.jobId,
        fromPeerId: entry.assignment.providerId,
        toPeerId: entry.assignment.requesterId,
        body: {
          schema: 'reploid.pool.peer_execution_status/v1',
          queueDepth: pendingInputExecutions.length,
          maxActiveSessions: maxActiveSessionCount()
        }
      }));
    } catch (error) {
      void removeActiveEntry(entry.activeEntry, entry.transport, entry.signaling, 'queue_status_failed');
      if (typeof onActivity === 'function') {
        onActivity({
          status: 'peer_session_failed',
          reason: 'queue_status_failed',
          error: error?.message || String(error),
          sessionId
        });
      }
      return true;
    }
    if (typeof onActivity === 'function') {
      onActivity({
        status: 'peer_session_queued',
        sessionId,
        assignment: entry.assignment,
        queueDepth: pendingInputExecutions.length,
        maxActiveSessions: maxActiveSessionCount()
      });
    }
    return true;
  };

  const sendProviderError = ({ assignment, activeEntry, transport, signaling, error }) => {
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
  };

  const executeInputPayload = async ({ assignment, activeEntry, transport, signaling, payload }) => {
    if (stopped || !activeTransports.has(activeEntry)) return;
    try {
      transport.send(createP2PPayload({
        type: P2P_PAYLOAD_TYPES.EXECUTION_STARTED,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId,
        body: {
          schema: 'reploid.pool.peer_execution_status/v1'
        }
      }));
    } catch (error) {
      await removeActiveEntry(activeEntry, transport, signaling, 'execution_status_failed');
      if (typeof onActivity === 'function') {
        onActivity({
          status: 'peer_session_failed',
          reason: 'execution_status_failed',
          error: error?.message || String(error),
          sessionId: activeEntry?.sessionId || null
        });
      }
      return;
    }
    activeExecutionSessions.add(activeEntry.sessionId);
    if (typeof onActivity === 'function') {
      onActivity({
        status: 'peer_execution_started',
        assignment,
        sessionId: activeEntry.sessionId
      });
    }
    try {
      const result = await providerClient.executePeerAssignment(assignment, { inputPayload: payload });
      if (stopped || !activeTransports.has(activeEntry)) {
        releaseExecutionSlot(activeEntry?.sessionId);
        if (!stopped && typeof onActivity === 'function') {
          onActivity({
            status: 'peer_execution_abandoned',
            outcome: 'completed',
            assignment,
            sessionId: activeEntry?.sessionId || null,
            activeExecutionCount: activeExecutionSessions.size,
            queueDepth: pendingInputExecutions.length
          });
        }
        return;
      }
      const receiptRecord = {
        receiptHash: result.receiptHash,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        outputText: result.execution.outputText || '',
        tokenIds: result.execution.tokenIds || [],
        outputKind: result.execution.outputKind || assignment.outputKind || null,
        vectorHash: result.execution.vectorHash || result.receipt?.vectorHash || null,
        sequenceResultHash: result.execution.sequenceResultHash || result.receipt?.sequenceResultHash || null,
        sequenceResult: result.execution.sequenceResult || result.receipt?.sequence || null,
        sequenceOutput: result.execution.sequenceOutput || null,
        embeddingDimensions: result.execution.embeddingDimensions || result.receipt?.embedding?.dimensions || null,
        embeddingStats: result.execution.embeddingStats || result.receipt?.embedding?.stats || null,
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
      if (stopped || !activeTransports.has(activeEntry)) {
        releaseExecutionSlot(activeEntry?.sessionId);
        return;
      }
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
        }, timing.provider.sessionSettleMs);
      }
    } catch (error) {
      releaseExecutionSlot(activeEntry?.sessionId);
      if (stopped || !activeTransports.has(activeEntry)) {
        if (!stopped && typeof onActivity === 'function') {
          onActivity({
            status: 'peer_execution_abandoned',
            outcome: 'failed',
            assignment,
            sessionId: activeEntry?.sessionId || null,
            activeExecutionCount: activeExecutionSessions.size,
            queueDepth: pendingInputExecutions.length,
            error: error?.message || String(error)
          });
        }
        return;
      }
      sendProviderError({ assignment, activeEntry, transport, signaling, error });
    }
  };

  const drainQueuedInputExecutions = () => {
    if (drainingQueue || stopped || pendingInputExecutions.length === 0) return;
    drainingQueue = true;
    queueMicrotask(async () => {
      try {
        while (!stopped && pendingInputExecutions.length > 0 && activeExecutionSessions.size < maxActiveSessionCount()) {
          const entry = pendingInputExecutions.shift();
          if (typeof onActivity === 'function') {
            onActivity({
              status: 'peer_session_dequeued',
              sessionId: entry?.activeEntry?.sessionId || null,
              queueDepth: pendingInputExecutions.length
            });
          }
          void executeInputPayload(entry);
        }
      } finally {
        drainingQueue = false;
        if (!stopped && pendingInputExecutions.length > 0 && activeExecutionSessions.size < maxActiveSessionCount()) {
          drainQueuedInputExecutions();
        }
      }
    });
  };

  const publishAdvert = async ({ discoveryRequestId = null } = {}) => {
    if (!advert || stopped) return;
    try {
      await Promise.resolve(postRoomMessage(channel, resolvedRoomId, 'provider-advert', {
        advert,
        ...(discoveryRequestId ? { discoveryRequestId } : {})
      }));
      if (typeof onActivity === 'function') onActivity({ status: 'provider_advertised', advert });
    } catch (error) {
      if (typeof onActivity === 'function') {
        onActivity({ status: 'provider_advert_failed', error: error.message || String(error) });
      }
      throw error;
    }
  };

  const reportRelayStatus = (event = {}) => {
    if (typeof onActivity !== 'function') return;
    try {
      onActivity({
        status: String(event.type || 'relay-status'),
        relayStatus: event
      });
    } catch {
      // UI and telemetry must not interfere with the provider relay loop.
    }
  };

  const handleInputPayload = async ({ assignment, activeEntry, transport, signaling, payload }) => {
    const validation = await validateInputPayloadForAssignment(payload, assignment);
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
      void removeActiveEntry(activeEntry, transport, signaling, 'input_rejected');
      return;
    }
    const executionEntry = {
      assignment,
      activeEntry,
      transport,
      signaling,
      payload
    };
    if (activeExecutionSessions.size >= maxActiveSessionCount()) {
      if (queueInputExecution(executionEntry)) return;
      transport.send(createP2PPayload({
        type: P2P_PAYLOAD_TYPES.ERROR,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        fromPeerId: assignment.providerId,
        toPeerId: assignment.requesterId,
        body: {
          error: 'provider queue is full'
        }
      }));
      void removeActiveEntry(activeEntry, transport, signaling, 'queue_full');
      return;
    }
    await executeInputPayload(executionEntry);
  };

  const handleRunRequest = async (message) => {
    if (stopped) return;
    const body = message.body || {};
    if (!body.intent || !body.sessionId) return;
    if ([...activeTransports].some((entry) => entry.sessionId === body.sessionId)) return;
    if (activeTransports.size >= maxOpenSessionCount()) {
      if (typeof onActivity === 'function') {
        onActivity({ status: 'peer_session_rejected', reason: 'provider_queue_full', sessionId: body.sessionId });
      }
      return;
    }
    const advertisedProviderId = advert?.body?.providerId || advert?.fromPeerId || null;
    if (advertisedProviderId) {
      if (body.providerId && body.providerId !== advertisedProviderId) return;
      if (body.assignment?.providerId && body.assignment.providerId !== advertisedProviderId) return;
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
      relayAckSigner,
      onRelayStatus: reportRelayStatus,
      sharedChannel: channel,
      roomBusFactory
    });
    const rtcConfig = typeof rtcConfigProvider === 'function'
      ? await rtcConfigProvider()
      : null;
    let activeEntry = null;
    let transport = null;
    transport = providerTransportFactory({
      signaling,
      initiator: false,
      ...(rtcConfig ? { rtcConfig } : {}),
      onStateChange(state) {
        if (!activeEntry || ![
          P2P_TRANSPORT_STATES.CLOSED,
          P2P_TRANSPORT_STATES.FAILED
        ].includes(state)) return;
        void removeActiveEntry(activeEntry, transport, signaling, `transport_${state}`);
      },
      onMessage(payload) {
        if (payload?.type === P2P_PAYLOAD_TYPES.PROMPT || payload?.type === P2P_PAYLOAD_TYPES.INPUT) {
          void handleInputPayload({ assignment, activeEntry, transport, signaling, payload }).catch((error) => {
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
      settleTimer: null,
      closing: false
    };
    activeTransports.add(activeEntry);
    if (typeof onActivity === 'function') onActivity({ status: 'peer_session_opening', assignment });
    const ready = transport.connect();
    await Promise.resolve(postRoomMessage(channel, resolvedRoomId, 'peer-run-accepted', {
      sessionId: body.sessionId,
      assignmentId: assignment.assignmentId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId
    }));
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
      void publishAdvert({
        discoveryRequestId: message.body?.discoveryRequestId || null
      }).catch(() => null);
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
        relayAckSigner,
        localPeerId: advert.body?.providerId || advert.fromPeerId,
        onRelayStatus: reportRelayStatus,
        role: 'provider'
      });
      channel.addEventListener('message', handler);
      await publishAdvert();
      interval = globalThis.setInterval(() => {
        void publishAdvert().catch(() => null);
      }, advertIntervalMs);
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
      pendingInputExecutions.length = 0;
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
