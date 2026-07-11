/**
 * @fileoverview Provider reputation mutations for pool receipts.
 */

import { getPolicy } from './config.js';
import { deriveProviderAdmission } from './runtime-profile.js';
import { REPUTATION_EVENT_TYPES } from '../../self/pool/reputation.js';

export async function recordAcceptedReceipt({ store, providerId, receiptHash = null, points = 0 }) {
  const provider = await store.getProvider?.(providerId);
  const nextBase = await store.appendReputationEvent({
    type: REPUTATION_EVENT_TYPES.requesterAccepted,
    providerId,
    receiptHash,
    points
  });
  const admission = deriveProviderAdmission({
    provider: provider || {},
    reputation: nextBase,
    policy: getPolicy('ring_quorum_receipt') || {}
  });
  return store.updateReputation(providerId, {
    acceptedReceipts: nextBase.acceptedReceipts,
    points: nextBase.points,
    admissionPolicyId: admission.policyId,
    admissionLane: admission.laneId,
    ringEligible: admission.ringEligible
  });
}

export async function recordRejectedReceipt({
  store,
  providerId,
  receiptHash = null,
  assignmentId = null,
  jobId = null,
  reasons = []
}) {
  const identityViolation = reasons.some((reason) => /model|manifest|runtime|backend/i.test(String(reason || '')));
  const reputation = await store.appendReputationEvent({
    type: identityViolation ? REPUTATION_EVENT_TYPES.policyViolation : REPUTATION_EVENT_TYPES.requesterDisputed,
    providerId,
    receiptHash,
    assignmentId,
    jobId,
    reasons,
    routingBlocked: identityViolation,
    quarantineReason: identityViolation ? 'model_or_runtime_identity_violation' : null
  });
  const routingBlocked = reputation.routingBlocked === true;
  return store.updateReputation(providerId, {
    admissionLane: routingBlocked ? 'quarantined_provider' : reputation.admissionLane,
    ringEligible: routingBlocked ? false : reputation.ringEligible
  });
}

export default {
  recordAcceptedReceipt,
  recordRejectedReceipt
};
