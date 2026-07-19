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
const POOL_CLIENT_ID_STORAGE_KEY = 'reploid.pool.clientId.v1';
let fallbackClientId = null;

const makePoolClientId = () => {
  const randomId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `pool_client_${randomId}`;
};

const normalizeClientId = (value) => {
  const normalized = String(value || '').trim().replace(/[^a-z0-9_.:-]/gi, '_').slice(0, 160);
  return normalized || null;
};

export function getDefaultPoolClientId() {
  try {
    const storage = globalThis.sessionStorage;
    if (storage) {
      const existing = normalizeClientId(storage.getItem(POOL_CLIENT_ID_STORAGE_KEY));
      if (existing) return existing;
      const created = normalizeClientId(makePoolClientId());
      storage.setItem(POOL_CLIENT_ID_STORAGE_KEY, created);
      return created;
    }
  } catch {
    // Some embedded contexts block sessionStorage; fall through to process-local identity.
  }
  if (!fallbackClientId) fallbackClientId = normalizeClientId(makePoolClientId());
  return fallbackClientId;
}

async function requestJson(path, {
  baseUrl = DEFAULT_BASE_URL,
  method = 'GET',
  body = null,
  authTokenProvider = null,
  clientId = null
} = {}) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const effectiveClientId = normalizeClientId(
    typeof clientId === 'function' ? clientId() : clientId
  ) || getDefaultPoolClientId();
  if (effectiveClientId) headers['X-Reploid-Client-Id'] = effectiveClientId;
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

export function createPoolSdk({ baseUrl = DEFAULT_BASE_URL, authTokenProvider = getPoolAuthToken, clientId = null } = {}) {
  const request = (path, options = {}) => requestJson(path, {
    baseUrl,
    authTokenProvider,
    clientId,
    ...options
  });
  return {
    policies() {
      return request('/policies');
    },
    config() {
      return request('/config');
    },
    status() {
      return request('/status');
    },
    metrics() {
      return request('/metrics');
    },
    deploymentCheck() {
      return request('/deployment/check');
    },
    publishAdapter(publication) {
      return request('/adapters', { method: 'POST', body: { publication } });
    },
    listAdapters({ capability = null, publisherId = null, visibility = null } = {}) {
      const query = new URLSearchParams();
      if (capability) query.set('capability', capability);
      if (publisherId) query.set('publisherId', publisherId);
      if (visibility) query.set('visibility', visibility);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/adapters${suffix}`);
    },
    getAdapter(packHash, { assignmentId = null } = {}) {
      const query = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : '';
      return request(`/adapters/${encodeURIComponent(packHash)}${query}`);
    },
    createAdapterDownload(packHash, { origin = null, assignmentId = null } = {}) {
      return request(`/adapters/${encodeURIComponent(packHash)}/download`, {
        method: 'POST',
        body: { origin, assignmentId }
      });
    },
    revokeAdapter(packHash, revocation) {
      return request(`/adapters/${encodeURIComponent(packHash)}/revoke`, {
        method: 'POST',
        body: { revocation }
      });
    },
    submitJob(jobRequest) {
      return request('/jobs', { method: 'POST', body: jobRequest });
    },
    pollJob(jobId) {
      return request(`/jobs/${encodeURIComponent(jobId)}`);
    },
    acceptReceipt(receiptHash, acceptance = {}) {
      return request(`/receipts/${encodeURIComponent(receiptHash)}/accept`, {
        method: 'POST',
        body: acceptance
      });
    },
    getReceipt(receiptHash) {
      return request(`/receipts/${encodeURIComponent(receiptHash)}`);
    },
    registerProvider(registration) {
      return request('/providers/register', { method: 'POST', body: registration });
    },
    heartbeatProvider(heartbeat) {
      return request('/providers/heartbeat', { method: 'POST', body: heartbeat });
    },
    nextAssignment(providerId) {
      return request(`/providers/assignments/next?providerId=${encodeURIComponent(providerId)}`);
    },
    submitReceipt(assignmentId, payload) {
      return request(`/assignments/${encodeURIComponent(assignmentId)}/receipt`, {
        method: 'POST',
        body: payload
      });
    },
    reportAssignmentFailure(assignmentId, payload = {}) {
      return request(`/assignments/${encodeURIComponent(assignmentId)}/failure`, {
        method: 'POST',
        body: payload
      });
    },
    submitAssignmentCommitment(assignmentId, payload = {}) {
      return request(`/assignments/${encodeURIComponent(assignmentId)}/commit`, {
        method: 'POST',
        body: payload
      });
    },
    submitAssignmentReveal(assignmentId, payload = {}) {
      return request(`/assignments/${encodeURIComponent(assignmentId)}/reveal`, {
        method: 'POST',
        body: payload
      });
    },
    createSignalingSession(payload = {}) {
      return request('/signaling/sessions', { method: 'POST', body: payload });
    },
    getSignalingSession(sessionId) {
      return request(`/signaling/sessions/${encodeURIComponent(sessionId)}`);
    },
    publishSignal(sessionId, message = {}) {
      return request(`/signaling/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        body: message
      });
    },
    listSignals(sessionId, { after = 0, peerId = null } = {}) {
      const query = new URLSearchParams();
      if (after) query.set('after', String(after));
      if (peerId) query.set('peerId', String(peerId));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/signaling/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`);
    },
    publishPeerRoomMessage(roomId, message = {}) {
      return request(`/peer/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        body: message
      });
    },
    listPeerRoomMessages(roomId, { after = 0, peerId = null, limit = null } = {}) {
      const query = new URLSearchParams();
      if (after) query.set('after', String(after));
      if (peerId) query.set('peerId', String(peerId));
      if (limit) query.set('limit', String(limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/peer/rooms/${encodeURIComponent(roomId)}/messages${suffix}`);
    },
    listPeerRooms({ limit = null } = {}) {
      const query = new URLSearchParams();
      if (limit) query.set('limit', String(limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/peer/rooms${suffix}`);
    },
    peerRoomSummary(roomId, { limit = null } = {}) {
      const query = new URLSearchParams();
      if (limit) query.set('limit', String(limit));
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return request(`/peer/rooms/${encodeURIComponent(roomId)}/summary${suffix}`);
    },
    createCanaryAudit(payload) {
      return request('/audits/canary', { method: 'POST', body: payload });
    },
    createChallengeAudit(payload) {
      return request('/audits/challenge', { method: 'POST', body: payload });
    },
    getAudit(auditId) {
      return request(`/audits/${encodeURIComponent(auditId)}`);
    },
    getCanaryAudit(auditId) {
      return request(`/audits/${encodeURIComponent(auditId)}`);
    },
    points(userId) {
      return request(`/points/${encodeURIComponent(userId)}`);
    },
    reputation(providerId) {
      return request(`/reputation/${encodeURIComponent(providerId)}`);
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
  getDefaultPoolClientId,
  verifyReceipt,
  verifyReceiptRecord
};
