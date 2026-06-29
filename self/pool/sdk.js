/**
 * @fileoverview Browser SDK for the Reploid fastest-receipt pool.
 */

import {
  SIGNATURE_DOMAINS,
  verifyCanonicalSignature,
  receiptSigningPayload,
  hashJson,
  sha256Hex
} from './inference-receipt.js';
import { getPoolAuthToken } from './identity.js';

const DEFAULT_BASE_URL = '/pool';

async function requestJson(path, { baseUrl = DEFAULT_BASE_URL, method = 'GET', body = null, authTokenProvider = null } = {}) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const token = typeof authTokenProvider === 'function' ? await authTokenProvider() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `Pool request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function createPoolSdk({ baseUrl = DEFAULT_BASE_URL, authTokenProvider = getPoolAuthToken } = {}) {
  return {
    policies() {
      return requestJson('/policies', { baseUrl, authTokenProvider });
    },
    config() {
      return requestJson('/config', { baseUrl, authTokenProvider });
    },
    status() {
      return requestJson('/status', { baseUrl, authTokenProvider });
    },
    metrics() {
      return requestJson('/metrics', { baseUrl, authTokenProvider });
    },
    deploymentCheck() {
      return requestJson('/deployment/check', { baseUrl, authTokenProvider });
    },
    submitJob(request) {
      return requestJson('/jobs', { baseUrl, method: 'POST', body: request, authTokenProvider });
    },
    pollJob(jobId) {
      return requestJson(`/jobs/${encodeURIComponent(jobId)}`, { baseUrl, authTokenProvider });
    },
    acceptReceipt(receiptHash, acceptance = {}) {
      return requestJson(`/receipts/${encodeURIComponent(receiptHash)}/accept`, {
        baseUrl,
        method: 'POST',
        body: acceptance,
        authTokenProvider
      });
    },
    getReceipt(receiptHash) {
      return requestJson(`/receipts/${encodeURIComponent(receiptHash)}`, { baseUrl, authTokenProvider });
    },
    registerProvider(registration) {
      return requestJson('/providers/register', { baseUrl, method: 'POST', body: registration, authTokenProvider });
    },
    heartbeatProvider(heartbeat) {
      return requestJson('/providers/heartbeat', { baseUrl, method: 'POST', body: heartbeat, authTokenProvider });
    },
    nextAssignment(providerId) {
      return requestJson(`/providers/assignments/next?providerId=${encodeURIComponent(providerId)}`, { baseUrl, authTokenProvider });
    },
    submitReceipt(assignmentId, payload) {
      return requestJson(`/assignments/${encodeURIComponent(assignmentId)}/receipt`, {
        baseUrl,
        method: 'POST',
        body: payload,
        authTokenProvider
      });
    },
    reportAssignmentFailure(assignmentId, payload = {}) {
      return requestJson(`/assignments/${encodeURIComponent(assignmentId)}/failure`, {
        baseUrl,
        method: 'POST',
        body: payload,
        authTokenProvider
      });
    },
    submitAssignmentCommitment(assignmentId, payload = {}) {
      return requestJson(`/assignments/${encodeURIComponent(assignmentId)}/commit`, {
        baseUrl,
        method: 'POST',
        body: payload,
        authTokenProvider
      });
    },
    submitAssignmentReveal(assignmentId, payload = {}) {
      return requestJson(`/assignments/${encodeURIComponent(assignmentId)}/reveal`, {
        baseUrl,
        method: 'POST',
        body: payload,
        authTokenProvider
      });
    },
    createSignalingSession(payload = {}) {
      return requestJson('/signaling/sessions', { baseUrl, method: 'POST', body: payload, authTokenProvider });
    },
    getSignalingSession(sessionId) {
      return requestJson(`/signaling/sessions/${encodeURIComponent(sessionId)}`, { baseUrl, authTokenProvider });
    },
    publishSignal(sessionId, message = {}) {
      return requestJson(`/signaling/sessions/${encodeURIComponent(sessionId)}/messages`, {
        baseUrl,
        method: 'POST',
        body: message,
        authTokenProvider
      });
    },
    listSignals(sessionId, { after = 0, peerId = null } = {}) {
      const query = new URLSearchParams();
      if (after) query.set('after', String(after));
      if (peerId) query.set('peerId', String(peerId));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return requestJson(`/signaling/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`, { baseUrl, authTokenProvider });
    },
    publishPeerRoomMessage(roomId, message = {}) {
      return requestJson(`/peer/rooms/${encodeURIComponent(roomId)}/messages`, {
        baseUrl,
        method: 'POST',
        body: message,
        authTokenProvider
      });
    },
    listPeerRoomMessages(roomId, { after = 0, peerId = null, limit = null } = {}) {
      const query = new URLSearchParams();
      if (after) query.set('after', String(after));
      if (peerId) query.set('peerId', String(peerId));
      if (limit) query.set('limit', String(limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return requestJson(`/peer/rooms/${encodeURIComponent(roomId)}/messages${suffix}`, { baseUrl, authTokenProvider });
    },
    createCanaryAudit(payload) {
      return requestJson('/audits/canary', { baseUrl, method: 'POST', body: payload, authTokenProvider });
    },
    getCanaryAudit(auditId) {
      return requestJson(`/audits/${encodeURIComponent(auditId)}`, { baseUrl, authTokenProvider });
    },
    points(userId) {
      return requestJson(`/points/${encodeURIComponent(userId)}`, { baseUrl, authTokenProvider });
    },
    reputation(providerId) {
      return requestJson(`/reputation/${encodeURIComponent(providerId)}`, { baseUrl, authTokenProvider });
    }
  };
}

export async function verifyReceipt(receipt, providerPublicKey, artifact = {}) {
  const reasons = [];
  const receiptHash = await hashJson(receipt);
  if (!receipt?.providerSignature) reasons.push('provider signature missing');
  if (receipt?.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) reasons.push('provider receipt signature domain mismatch');
  if (!providerPublicKey) reasons.push('provider public key missing');
  if (providerPublicKey && receipt?.providerSignature) {
    try {
      const signatureOk = await verifyCanonicalSignature(
        receiptSigningPayload(receipt),
        providerPublicKey,
        receipt.providerSignature,
        { domain: SIGNATURE_DOMAINS.providerReceipt }
      );
      if (!signatureOk) reasons.push('provider signature invalid');
    } catch (error) {
      reasons.push(`provider signature verification failed: ${error.message}`);
    }
  }
  if (artifact.outputText !== undefined && receipt?.outputHash !== await sha256Hex(artifact.outputText || '')) {
    reasons.push('output hash mismatch');
  }
  if (Array.isArray(artifact.tokenIds) && receipt?.tokenIdsHash !== await hashJson(artifact.tokenIds)) {
    reasons.push('token ids hash mismatch');
  }
  if (artifact.transcript && receipt?.transcriptHash !== await hashJson(artifact.transcript)) {
    reasons.push('transcript hash mismatch');
  }
  return {
    ok: reasons.length === 0,
    receiptHash,
    reasons
  };
}

export async function verifyReceiptRecord(record = {}) {
  const decision = await verifyReceipt(record.receipt, record.providerPublicKey, {
    outputText: record.outputText,
    tokenIds: record.tokenIds,
    transcript: record.transcript
  });
  return {
    ...decision,
    serverVerifierDecision: record.verifierDecision || null,
    requesterAcceptance: record.requesterAcceptance || null,
    ledgerEvent: record.ledgerEvent || null
  };
}

export default {
  createPoolSdk,
  verifyReceipt,
  verifyReceiptRecord
};
