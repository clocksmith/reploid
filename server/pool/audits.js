/**
 * @fileoverview Canary audit helpers for policy-controlled browser inference.
 */

import { hashJson, sha256Hex } from './hash.js';

export const CANARY_AUDIT_KIND = 'deterministic_canary';

const nowIso = () => new Date().toISOString();

export async function createCanaryChallenge({
  store,
  providerId = null,
  prompt,
  expectedOutputText = '',
  expectedTokenIds = null,
  modelRequirements = {},
  generationConfig = {},
  policyId = 'fastest_receipt',
  metadata = {}
} = {}) {
  if (!store?.createAuditChallenge) throw new Error('store.createAuditChallenge is required');
  if (!prompt) throw new Error('canary prompt is required');
  const hasExpectedTokenIds = Array.isArray(expectedTokenIds);
  const tokenIds = hasExpectedTokenIds ? expectedTokenIds : [];
  return store.createAuditChallenge({
    kind: CANARY_AUDIT_KIND,
    providerId,
    policyId,
    prompt,
    inputHash: sha256Hex(prompt),
    generationConfig,
    generationConfigHash: hashJson(generationConfig),
    modelRequirements,
    expectedOutputHash: sha256Hex(expectedOutputText),
    expectedTokenIdsHash: hasExpectedTokenIds ? hashJson(tokenIds) : null,
    expectedTranscriptHash: hasExpectedTokenIds ? hashJson({ outputText: expectedOutputText, tokenIds }) : null,
    status: 'pending',
    metadata
  });
}

export async function attachAuditAssignment({ store, auditId, assignmentId, providerId = null } = {}) {
  if (!auditId || !assignmentId) throw new Error('auditId and assignmentId are required');
  return store.updateAuditChallenge(auditId, {
    assignmentId,
    providerId,
    status: 'assigned',
    assignedAt: nowIso()
  });
}

export async function verifyCanaryResult({ store, auditId, providerId = null, outputText = '', tokenIds = [] } = {}) {
  const audit = await store.getAuditChallenge(auditId);
  if (!audit) {
    return {
      accepted: false,
      reasons: ['audit challenge not found']
    };
  }
  const reasons = [];
  if (providerId && audit.providerId && providerId !== audit.providerId) reasons.push('audit provider mismatch');
  if (audit.expectedOutputHash && audit.expectedOutputHash !== sha256Hex(outputText)) reasons.push('canary output hash mismatch');
  if (audit.expectedTokenIdsHash && audit.expectedTokenIdsHash !== hashJson(Array.isArray(tokenIds) ? tokenIds : [])) reasons.push('canary token ids hash mismatch');
  const accepted = reasons.length === 0;
  const updated = await store.updateAuditChallenge(auditId, {
    status: accepted ? 'passed' : 'failed',
    outputHash: sha256Hex(outputText),
    tokenIdsHash: hashJson(Array.isArray(tokenIds) ? tokenIds : []),
    reasons,
    completedAt: nowIso()
  });
  return {
    accepted,
    reasons,
    audit: updated
  };
}

export async function applyCanaryReputation({ store, providerId, accepted, reasons = [] } = {}) {
  if (!providerId) return null;
  const current = await store.getReputation(providerId);
  const passedCanaries = Number(current.passedCanaries || 0) + (accepted ? 1 : 0);
  const failedCanaries = Number(current.failedCanaries || 0) + (accepted ? 0 : 1);
  const clearsCanaryQuarantine = accepted && current.quarantineReason === 'canary_failed';
  return store.updateReputation(providerId, {
    passedCanaries,
    failedCanaries,
    lastCanaryAt: nowIso(),
    lastCanaryReasons: reasons,
    routingBlocked: accepted ? (clearsCanaryQuarantine ? false : current.routingBlocked) : true,
    quarantineReason: accepted ? (clearsCanaryQuarantine ? null : current.quarantineReason) : 'canary_failed'
  });
}

export function createAuditScheduler({ store } = {}) {
  return {
    enabled: true,
    kind: CANARY_AUDIT_KIND,
    createCanaryChallenge: (input) => createCanaryChallenge({ store, ...input }),
    attachAuditAssignment: (input) => attachAuditAssignment({ store, ...input }),
    verifyCanaryResult: (input) => verifyCanaryResult({ store, ...input }),
    applyCanaryReputation: (input) => applyCanaryReputation({ store, ...input })
  };
}

export default {
  CANARY_AUDIT_KIND,
  createCanaryChallenge,
  attachAuditAssignment,
  verifyCanaryResult,
  applyCanaryReputation,
  createAuditScheduler
};
