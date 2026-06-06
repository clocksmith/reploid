/**
 * @fileoverview Browser SDK for the Reploid fastest-receipt pool.
 */

import { verifyCanonicalSignature, receiptSigningPayload, hashJson } from './inference-receipt.js';

const DEFAULT_BASE_URL = '/pool';

async function requestJson(path, { baseUrl = DEFAULT_BASE_URL, method = 'GET', body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
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

export function createPoolSdk({ baseUrl = DEFAULT_BASE_URL } = {}) {
  return {
    submitJob(request) {
      return requestJson('/jobs', { baseUrl, method: 'POST', body: request });
    },
    pollJob(jobId) {
      return requestJson(`/jobs/${encodeURIComponent(jobId)}`, { baseUrl });
    },
    acceptReceipt(receiptHash, acceptance = {}) {
      return requestJson(`/receipts/${encodeURIComponent(receiptHash)}/accept`, {
        baseUrl,
        method: 'POST',
        body: acceptance
      });
    },
    registerProvider(registration) {
      return requestJson('/providers/register', { baseUrl, method: 'POST', body: registration });
    },
    heartbeatProvider(heartbeat) {
      return requestJson('/providers/heartbeat', { baseUrl, method: 'POST', body: heartbeat });
    },
    nextAssignment(providerId) {
      return requestJson(`/providers/assignments/next?providerId=${encodeURIComponent(providerId)}`, { baseUrl });
    },
    submitReceipt(assignmentId, payload) {
      return requestJson(`/assignments/${encodeURIComponent(assignmentId)}/receipt`, {
        baseUrl,
        method: 'POST',
        body: payload
      });
    },
    points(userId) {
      return requestJson(`/points/${encodeURIComponent(userId)}`, { baseUrl });
    },
    reputation(providerId) {
      return requestJson(`/reputation/${encodeURIComponent(providerId)}`, { baseUrl });
    }
  };
}

export async function verifyReceipt(receipt, providerPublicKey) {
  const receiptHash = await hashJson(receipt);
  const signatureOk = await verifyCanonicalSignature(
    receiptSigningPayload(receipt),
    providerPublicKey,
    receipt.providerSignature
  );
  return {
    ok: signatureOk,
    receiptHash,
    reasons: signatureOk ? [] : ['provider signature invalid']
  };
}

export default {
  createPoolSdk,
  verifyReceipt
};
