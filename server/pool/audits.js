/**
 * @fileoverview Canary audit helpers for policy-controlled browser inference.
 */

import { hashJson, sha256Hex } from './hash.js';
import { REPUTATION_EVENT_TYPES } from '../../self/pool/reputation.js';

export const CANARY_AUDIT_KIND = 'deterministic_canary';
export const CHALLENGE_AUDIT_KIND = 'delayed_challenge_rerun';

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
  kind = CANARY_AUDIT_KIND,
  metadata = {}
} = {}) {
  if (!store?.createAuditChallenge) throw new Error('store.createAuditChallenge is required');
  if (!prompt) throw new Error('canary prompt is required');
  const hasExpectedTokenIds = Array.isArray(expectedTokenIds);
  const tokenIds = hasExpectedTokenIds ? expectedTokenIds : [];
  return store.createAuditChallenge({
    kind,
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

export async function createChallengeRerun({
  store,
  providerId,
  sourceReceipt,
  sourceJob,
  metadata = {}
} = {}) {
  if (!sourceReceipt?.receiptHash) throw new Error('source receipt is required');
  if (!sourceJob?.prompt) throw new Error('source job prompt is required');
  return createCanaryChallenge({
    store,
    providerId,
    prompt: sourceJob.prompt,
    expectedOutputText: sourceReceipt.outputText || '',
    expectedTokenIds: Array.isArray(sourceReceipt.tokenIds) ? sourceReceipt.tokenIds : null,
    modelRequirements: sourceJob.modelRequirements || sourceReceipt.receipt?.model || {},
    generationConfig: sourceJob.generationConfig || {},
    policyId: sourceJob.policyId || 'fastest_receipt',
    kind: CHALLENGE_AUDIT_KIND,
    metadata: {
      ...metadata,
      sourceReceiptHash: sourceReceipt.receiptHash,
      sourceJobId: sourceReceipt.jobId || sourceJob.jobId || null
    }
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
  const label = audit.kind === CHALLENGE_AUDIT_KIND ? 'challenge' : 'canary';
  if (providerId && audit.providerId && providerId !== audit.providerId) reasons.push('audit provider mismatch');
  if (audit.expectedOutputHash && audit.expectedOutputHash !== sha256Hex(outputText)) reasons.push(`${label} output hash mismatch`);
  if (audit.expectedTokenIdsHash && audit.expectedTokenIdsHash !== hashJson(Array.isArray(tokenIds) ? tokenIds : [])) reasons.push(`${label} token ids hash mismatch`);
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

export async function applyCanaryReputation({
  store,
  providerId,
  accepted,
  reasons = [],
  kind = CANARY_AUDIT_KIND,
  auditId = null,
  assignmentId = null,
  jobId = null
} = {}) {
  if (!providerId) return null;
  const isChallenge = kind === CHALLENGE_AUDIT_KIND;
  const failureReason = isChallenge ? 'challenge_failed' : 'canary_failed';
  const type = isChallenge
    ? (accepted ? REPUTATION_EVENT_TYPES.challengePassed : REPUTATION_EVENT_TYPES.challengeFailed)
    : (accepted ? REPUTATION_EVENT_TYPES.canaryPassed : REPUTATION_EVENT_TYPES.canaryFailed);
  return store.appendReputationEvent({
    type,
    providerId,
    auditId,
    assignmentId,
    jobId,
    reasons,
    routingBlocked: !accepted,
    quarantineReason: accepted ? null : failureReason,
    clearRoutingBlock: accepted,
    clearQuarantineReasons: accepted ? [failureReason] : []
  });
}

export function createAuditScheduler({ store } = {}) {
  return {
    enabled: true,
    kind: CANARY_AUDIT_KIND,
    createCanaryChallenge: (input) => createCanaryChallenge({ store, ...input }),
    createChallengeRerun: (input) => createChallengeRerun({ store, ...input }),
    attachAuditAssignment: (input) => attachAuditAssignment({ store, ...input }),
    verifyCanaryResult: (input) => verifyCanaryResult({ store, ...input }),
    applyCanaryReputation: (input) => applyCanaryReputation({ store, ...input })
  };
}

export default {
  CANARY_AUDIT_KIND,
  CHALLENGE_AUDIT_KIND,
  createCanaryChallenge,
  createChallengeRerun,
  attachAuditAssignment,
  verifyCanaryResult,
  applyCanaryReputation,
  createAuditScheduler
};
