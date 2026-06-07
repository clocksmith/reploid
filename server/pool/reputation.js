/**
 * @fileoverview Provider reputation mutations for pool receipts.
 */

import { getPolicy } from './config.js';
import { deriveProviderAdmission } from './runtime-profile.js';

export async function recordAcceptedReceipt({ store, providerId, points = 0 }) {
  const current = await store.getReputation(providerId);
  const provider = await store.getProvider?.(providerId);
  const nextBase = {
    ...current,
    acceptedReceipts: Number(current.acceptedReceipts || 0) + 1,
    points: Number(current.points || 0) + points
  };
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

export async function recordRejectedReceipt({ store, providerId, reasons = [] }) {
  const current = await store.getReputation(providerId);
  const rejectedReceipts = Number(current.rejectedReceipts || 0) + 1;
  const identityViolation = reasons.some((reason) => /model|manifest|runtime|backend/i.test(String(reason || '')));
  const repeatedRejections = rejectedReceipts >= 3;
  return store.updateReputation(providerId, {
    rejectedReceipts,
    lastRejectionReasons: reasons,
    routingBlocked: identityViolation || repeatedRejections,
    admissionLane: identityViolation || repeatedRejections ? 'quarantined_provider' : current.admissionLane,
    ringEligible: identityViolation || repeatedRejections ? false : current.ringEligible,
    quarantineReason: identityViolation
      ? 'model_or_runtime_identity_violation'
      : (repeatedRejections ? 'repeated_rejected_receipts' : current.quarantineReason)
  });
}

export default {
  recordAcceptedReceipt,
  recordRejectedReceipt
};
