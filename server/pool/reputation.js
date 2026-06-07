/**
 * @fileoverview Provider reputation mutations for pool receipts.
 */

export async function recordAcceptedReceipt({ store, providerId, points = 0 }) {
  const current = await store.getReputation(providerId);
  return store.updateReputation(providerId, {
    acceptedReceipts: Number(current.acceptedReceipts || 0) + 1,
    points: Number(current.points || 0) + points
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
    quarantineReason: identityViolation
      ? 'model_or_runtime_identity_violation'
      : (repeatedRejections ? 'repeated_rejected_receipts' : current.quarantineReason)
  });
}

export default {
  recordAcceptedReceipt,
  recordRejectedReceipt
};
