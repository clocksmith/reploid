/** Requester room discovery, planning and receipt agreement; compatibility entry point. */
import timing from '../config/peer-timing.json' with { type: 'json' };

import { createP2PRequesterTransport } from "../../../shared/pool/p2p-transport.js";
import {
  createBroadcastPeerRoomBus
} from './peer-rendezvous.js';
import { P2P_PAYLOAD_TYPES, createP2PPayload, validateP2PPayload } from "./p2p-payload.js";
import { buildPeerAssignmentPlan, buildPeerReceiptAgreement } from "./peer-control-plane.js";
import { getPolicy } from '../../../shared/pool/config.js';
import { advertSupportsModel } from './peer-model-match.js';

import { PEER_ROOM_VERSION, DEFAULT_PEER_ROOM_ID, DEFAULT_DISCOVERY_WINDOW_MS, DEFAULT_RECEIPT_WINDOW_MS, DEFAULT_QUEUE_WINDOW_MS, DEFAULT_PROVIDER_SESSION_SETTLE_MS, DEFAULT_PROVIDER_ADVERT_SETTLE_MS, DEFAULT_ADAPTIVE_RING_ADVERT_SETTLE_MS, MIN_DISCOVERY_EXECUTION_MARGIN_MS, makeId, connectPeerTransport, resolvePromptDispatchConcurrency, openPeerRoomBus, postRoomMessage, createRoomSignaling, createPeerPlanError, createPeerAcceptanceError, createPeerReceiptAgreementError, waitForProviderAdverts, waitForRunAccepted } from "./peer-room-support.js";
import { createPeerProviderNode } from './peer-provider-node.js';
import { runPeerOperationJob, resumePeerOperationJob } from './peer-operation-room.js';
export { createPeerProviderNode, runPeerOperationJob, resumePeerOperationJob, DEFAULT_PEER_ROOM_ID, PEER_ROOM_VERSION, createRoomSignaling };

export async function runPeerJob({
  roomId = DEFAULT_PEER_ROOM_ID,
  requesterClient,
  prompt,
  sequence,
  sequenceRequest = null,
  policyId,
  modelRequirements,
  generationConfig,
  maxPointSpend = null,
  discoveryWindowMs = DEFAULT_DISCOVERY_WINDOW_MS,
  sessionAcceptWindowMs = DEFAULT_PROVIDER_SESSION_SETTLE_MS,
  receiptWindowMs = DEFAULT_RECEIPT_WINDOW_MS,
  queueWindowMs = DEFAULT_QUEUE_WINDOW_MS,
  transportConnectWindowMs = timing.generic.transportConnectWindowMs,
  promptDispatchConcurrency = null,
  knownProviderAdverts = [],
  requesterTransportFactory = createP2PRequesterTransport,
  rtcConfigProvider = null,
  roomBusFactory = createBroadcastPeerRoomBus,
  relayAckSigner = null,
  onActivity = null
} = {}) {
  if (!requesterClient?.createPeerJobIntent) throw new TypeError('requesterClient with createPeerJobIntent() is required');
  const resolvedRoomId = roomId || DEFAULT_PEER_ROOM_ID;
  let channel = null;
  const sessions = [];
  const reportActivity = (status, phase, detail = {}) => {
    if (typeof onActivity !== 'function') return;
    try {
      onActivity({ status, phase, roomId: resolvedRoomId, ...detail });
    } catch {
      // Presentation telemetry must not change peer execution or its receipts.
    }
  };
  const reportRelayStatus = (event = {}) => {
    const status = String(event.type || 'relay-status');
    const phase = /publish|signal/.test(status) ? 'match' : 'infer';
    reportActivity(status, phase, { relayStatus: event });
  };
  try {
    const intent = await requesterClient.createPeerJobIntent({
      prompt,
      sequence,
      sequenceRequest,
      policyId,
      modelRequirements,
      generationConfig,
      maxPointSpend
    });
    reportActivity('peer_run_intent_created', 'prompt', {
      requesterId: intent.intent?.body?.requesterId || null
    });
    channel = openPeerRoomBus({
      roomId: resolvedRoomId,
      roomBusFactory,
      relayAckSigner,
      localPeerId: intent.intent.body.requesterId,
      onRelayStatus: reportRelayStatus,
      role: 'requester'
    });
    const requiredModel = intent.intent.body.modelRequirements || {};
    const policy = getPolicy(intent.intent.body.policyId);
    const maxAdverts = policy?.adaptiveRing
      ? Math.max(1, Number(policy.maxRingSize || 1))
      : Math.max(1, Number(policy?.redundancy || 1));
    const minAdverts = policy?.adaptiveRing
      ? Math.max(1, Number(policy.minRingSize || 1))
      : Math.max(1, Number(policy?.redundancy || 1));
    const advertMatchesRequest = advert => advertSupportsModel(advert, requiredModel);
    const compatibleKnownAdverts = (Array.isArray(knownProviderAdverts) ? knownProviderAdverts : [])
      .filter(advertMatchesRequest)
      .filter((advert, index, adverts) => adverts.findIndex((candidate) => (
        (candidate.body?.providerId || candidate.fromPeerId) === (advert.body?.providerId || advert.fromPeerId)
      )) === index)
      .slice(0, maxAdverts);
    reportActivity('peer_provider_discovery_started', 'match', {
      requiredProviders: minAdverts,
      maximumProviders: maxAdverts,
      knownProviders: compatibleKnownAdverts.length
    });
    const providerAdverts = await waitForProviderAdverts({
      channel,
      roomId: resolvedRoomId,
      discoveryWindowMs,
      maxAdverts,
      minAdverts,
      settleOnFirst: !policy?.adaptiveRing && maxAdverts <= 1,
      // A quorum-capable policy must give all already-online providers enough
      // time to answer the same live discovery request.  Each new advert
      // resets this bounded window; maxAdverts and discoveryWindowMs remain
      // hard limits.
      settleWindowMs: policy?.adaptiveRing
        ? Math.min(
          Math.max(1, Number(discoveryWindowMs || 1) - MIN_DISCOVERY_EXECUTION_MARGIN_MS),
          DEFAULT_ADAPTIVE_RING_ADVERT_SETTLE_MS
        )
        : DEFAULT_PROVIDER_ADVERT_SETTLE_MS,
      requiredModel,
      knownProviderAdverts: compatibleKnownAdverts,
      predicate: advertMatchesRequest
    });
    const plan = await buildPeerAssignmentPlan({
      jobIntent: intent.intent,
      providerAdverts
    });
    if (!plan.ok || !plan.assignment) {
      throw createPeerPlanError(plan);
    }
    reportActivity('peer_assignment_planned', 'match', {
      providerCount: plan.assignments.length
    });
    const rtcConfig = typeof rtcConfigProvider === 'function'
      ? await rtcConfigProvider()
      : null;
    for (const assignment of plan.assignments) {
      const sessionId = makeId('peer_session');
      const signaling = createRoomSignaling({
        roomId: resolvedRoomId,
        sessionId,
        localPeerId: assignment.requesterId,
        remotePeerId: assignment.providerId,
        relayAckSigner,
        onRelayStatus: reportRelayStatus,
        sharedChannel: channel,
        roomBusFactory
      });
      let receiptTimer = null;
      let deliveryPhase = 'pending';
      const executionStatuses = [];
      let transport = null;
      let resolveReceipt = null;
      let rejectReceipt = null;
      const clearReceiptTimer = () => {
        if (receiptTimer) globalThis.clearTimeout(receiptTimer);
        receiptTimer = null;
      };
      const startDeliveryTimer = ({ phase, timeoutMs, errorCode, message }) => {
        clearReceiptTimer();
        deliveryPhase = phase;
        receiptTimer = globalThis.setTimeout(() => {
          deliveryPhase = 'settled';
          const error = new Error(message);
          error.code = errorCode;
          error.retryable = true;
          error.diagnostics = transport?.getDiagnostics?.() || null;
          rejectReceipt?.(error);
        }, timeoutMs);
      };
      const startReceiptTimer = () => startDeliveryTimer({
        phase: 'awaiting_receipt',
        timeoutMs: receiptWindowMs,
        errorCode: 'peer_receipt_timeout',
        message: 'No peer receipt returned before the post-start receipt deadline'
      });
      const startQueueTimer = () => startDeliveryTimer({
        phase: 'queued',
        timeoutMs: queueWindowMs,
        errorCode: 'peer_queue_timeout',
        message: 'Peer execution did not start before the queue deadline'
      });
      const payloadMatchesSession = (payload, type) => (
        validateP2PPayload(payload).ok
        && payload.type === type
        && payload.assignmentId === assignment.assignmentId
        && payload.jobId === assignment.jobId
        && payload.fromPeerId === assignment.providerId
        && payload.toPeerId === assignment.requesterId
      );
      const recordExecutionStatus = (payload) => {
        executionStatuses.push(Object.freeze({
          type: payload.type,
          body: payload.body,
          providerCreatedAt: payload.createdAt,
          requesterReceivedAt: new Date().toISOString()
        }));
      };
      const receiptPromise = new Promise((resolve, reject) => {
        resolveReceipt = resolve;
        rejectReceipt = reject;
        transport = requesterTransportFactory({
          signaling,
          initiator: true,
          ...(rtcConfig ? { rtcConfig } : {}),
          onMessage(payload) {
            if (
              payloadMatchesSession(payload, P2P_PAYLOAD_TYPES.QUEUED)
              && deliveryPhase === 'awaiting_receipt'
              && !executionStatuses.some((status) => status.type === P2P_PAYLOAD_TYPES.QUEUED)
            ) {
              recordExecutionStatus(payload);
              startQueueTimer();
              reportActivity('peer_provider_queued', 'infer', {
                providerId: assignment.providerId,
                queueDepth: payload.body?.queueDepth || null
              });
              return;
            }
            if (
              payloadMatchesSession(payload, P2P_PAYLOAD_TYPES.EXECUTION_STARTED)
              && ['awaiting_receipt', 'queued'].includes(deliveryPhase)
              && !executionStatuses.some((status) => status.type === P2P_PAYLOAD_TYPES.EXECUTION_STARTED)
            ) {
              recordExecutionStatus(payload);
              startReceiptTimer();
              reportActivity('peer_provider_execution_started', 'infer', {
                providerId: assignment.providerId
              });
              return;
            }
            if (payload?.type === P2P_PAYLOAD_TYPES.RECEIPT) {
              clearReceiptTimer();
              deliveryPhase = 'settled';
              resolveReceipt(payload);
            }
            if (payload?.type === P2P_PAYLOAD_TYPES.ERROR) {
              clearReceiptTimer();
              deliveryPhase = 'settled';
              rejectReceipt(new Error(payload.body?.error || 'peer error'));
            }
          }
        });
      });
      if (!transport) throw new Error('peer requester transport was not created');
      const acceptPromise = waitForRunAccepted({
        channel,
        roomId: resolvedRoomId,
        sessionId: signaling.sessionId,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        discoveryWindowMs: sessionAcceptWindowMs
      });
      sessions.push({
        assignment,
        signaling,
        transport,
        acceptPromise,
        receiptPromise,
        startReceiptTimer,
        clearReceiptTimer,
        executionStatuses
      });
      await Promise.resolve(postRoomMessage(channel, resolvedRoomId, 'peer-run-request', {
        sessionId,
        intent: intent.intent,
        assignment,
        assignmentId: assignment.assignmentId,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId
      }));
    }
    const acceptResults = await Promise.allSettled(sessions.map(async (session) => ({
      session,
      accepted: await session.acceptPromise
    })));
    const acceptedSessions = acceptResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value.session);
    const acceptErrors = acceptResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || String(result.reason));
    const requiredAcceptedSessions = policy?.adaptiveRing
      ? Math.max(1, Number(plan.ring?.requiredAgreement || policy.quorum || minAdverts || 1))
      : sessions.length;
    if (acceptedSessions.length < requiredAcceptedSessions) {
      throw createPeerAcceptanceError({
        roomId: resolvedRoomId,
        requiredAcceptedSessions,
        acceptedSessions,
        sessions,
        acceptErrors
      });
    }
    reportActivity('peer_inference_started', 'infer', {
      providerCount: acceptedSessions.length
    });
    const inputPayloads = new Array(acceptedSessions.length);
    const receiptResults = new Array(acceptedSessions.length);
    let nextDispatchIndex = 0;
    const dispatchConcurrency = resolvePromptDispatchConcurrency(promptDispatchConcurrency, acceptedSessions.length);
    const dispatchNextInput = async () => {
      const index = nextDispatchIndex;
      nextDispatchIndex += 1;
      if (index >= acceptedSessions.length) return;
      const session = acceptedSessions[index];
      try {
        await connectPeerTransport({
          session,
          timeoutMs: transportConnectWindowMs
        });
        const inputPayload = intent.inputKind === 'sequence'
          ? await requesterClient.createPeerSequencePayload({
            assignment: session.assignment,
            sequence: intent.sequence,
            toPeerId: session.assignment.providerId
          })
          : await requesterClient.createPeerPromptPayload({
            assignment: session.assignment,
            prompt: intent.prompt,
            toPeerId: session.assignment.providerId
          });
        inputPayloads[index] = inputPayload;
        session.startReceiptTimer();
        session.transport.send(inputPayload);
        receiptResults[index] = await Promise.allSettled([session.receiptPromise]).then((results) => results[0]);
      } catch (error) {
        session.clearReceiptTimer?.();
        receiptResults[index] = {
          status: 'rejected',
          reason: error
        };
      }
      await dispatchNextInput();
    };
    await Promise.all(Array.from(
      { length: Math.min(dispatchConcurrency, acceptedSessions.length) },
      () => dispatchNextInput()
    ));
    const receiptPayloads = receiptResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const receiptFailures = receiptResults
      .map((result, index) => ({ result, session: acceptedSessions[index] }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, session }) => ({
        providerId: session?.assignment?.providerId || null,
        code: result.reason?.code || result.reason?.payload?.code || null,
        message: result.reason?.message || String(result.reason),
        diagnostics: result.reason?.diagnostics || result.reason?.payload?.diagnostics || null
      }));
    reportActivity('peer_receipts_received', 'verify', {
      receiptCount: receiptPayloads.length,
      receiptErrorCount: receiptFailures.length
    });
    const agreement = await buildPeerReceiptAgreement({ plan, receiptPayloads });
    if (!agreement.accepted) {
      throw createPeerReceiptAgreementError({
        roomId,
        agreement,
        receiptPayloads,
        receiptFailures
      });
    }
    reportActivity('peer_agreement_verified', 'verify', {
      acceptedProviderCount: agreement.acceptedProviderCount,
      requiredAgreement: agreement.requiredAgreement
    });
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
        try {
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
        } catch {
          // Receipt acceptance is recorded by the requester even if a provider
          // has already closed after sending its signed receipt.
        }
      }
    }
    const primaryRecord = agreement.acceptedRecords[0] || agreement.validRecords[0] || null;
    const receiptPayload = primaryRecord?.receiptPayload || receiptPayloads[0] || null;
    reportActivity('peer_run_completed', 'answer', {
      receiptHash: agreement.receiptHash || receiptPayload?.body?.receiptHash || null
    });
    return {
      transport: 'webrtc_peer_room',
      roomId: resolvedRoomId,
      intentHash: plan.intentHash,
      plan,
      assignment: primaryRecord?.assignment || plan.assignment,
      assignments: plan.assignments,
      inputPayload: inputPayloads.find(Boolean) || null,
      inputPayloads: inputPayloads.filter(Boolean),
      promptPayload: intent.inputKind === 'prompt' ? inputPayloads.find(Boolean) || null : null,
      promptPayloads: intent.inputKind === 'prompt' ? inputPayloads.filter(Boolean) : [],
      receiptPayload,
      receiptPayloads,
      receiptRecord: receiptPayload?.body || null,
      receiptEvidence: agreement.acceptedRecords.map((record) => ({
        receiptHash: record.receiptHash,
        providerId: record.providerId,
        providerPublicKey: record.providerPublicKey,
        receipt: record.receipt
      })),
      receiptHash: agreement.receiptHash || receiptPayload?.body?.receiptHash || null,
      receiptHashes: agreement.receiptHashes,
      outputText: receiptPayload?.body?.outputText || '',
      tokenIds: receiptPayload?.body?.tokenIds || [],
      outputKind: receiptPayload?.body?.outputKind || plan.assignment?.workload || 'sequence.embedding.v1',
      vectorHash: agreement.vectorHash || receiptPayload?.body?.vectorHash || null,
      sequenceResultHash: agreement.sequenceResultHash || receiptPayload?.body?.sequenceResultHash || null,
      sequenceResult: receiptPayload?.body?.sequenceResult || null,
      sequenceOutput: receiptPayload?.body?.sequenceOutput || null,
      embeddingDimensions: receiptPayload?.body?.embeddingDimensions || null,
      agreement,
      ledgerEvents,
      requesterAcceptance: acceptance,
      receiptErrors: receiptFailures.map((failure) => failure.message),
      receiptFailures,
      acceptedSessionCount: acceptedSessions.length,
      acceptErrors,
      deliveryPolicy: {
        queueWindowMs,
        receiptWindowMs,
        queueDeadlineStartsOn: 'provider_queued_status',
        receiptDeadlineStartsOn: 'input_dispatch_or_provider_execution_started'
      },
      executionStatusEvidence: acceptedSessions.flatMap((session) => (
        session.executionStatuses.map((status) => ({
          providerId: session.assignment.providerId,
          assignmentId: session.assignment.assignmentId,
          ...status,
          claimBoundary: 'Transport status is assignment-bound operational evidence, not a signed receipt or proof of execution.'
        }))
      )),
      relayMetrics: channel?.getStatus?.() || null,
      transportDiagnostics: acceptedSessions.map((session) => ({
        providerId: session.assignment.providerId,
        ...(session.connectedDiagnostics || session.transport.getDiagnostics?.() || {})
      }))
    };
  } catch (error) {
    reportActivity('peer_run_failed', 'error', {
      reason: error?.message || String(error)
    });
    throw error;
  } finally {
    for (const session of sessions) {
      session.clearReceiptTimer?.();
      if (session.transport?.close) await Promise.resolve(session.transport.close('requester_done')).catch(() => {});
      if (session.signaling?.close) session.signaling.close();
    }
    channel?.close();
  }
}

export default {
  DEFAULT_PEER_ROOM_ID,
  PEER_ROOM_VERSION,
  createPeerProviderNode,
  runPeerJob,
  runPeerOperationJob,
  resumePeerOperationJob
};
