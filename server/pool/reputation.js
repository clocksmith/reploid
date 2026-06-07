/**
 * @fileoverview Provider reputation mutations for pool receipts.
 */

export function recordAcceptedReceipt({ store, providerId, points = 0 }) {
  const current = store.getReputation(providerId);
  return store.updateReputation(providerId, {
    acceptedReceipts: Number(current.acceptedReceipts || 0) + 1,
    points: Number(current.points || 0) + points
  });
}

export function recordRejectedReceipt({ store, providerId, reasons = [] }) {
  const current = store.getReputation(providerId);
  const rejectedReceipts = Number(current.rejectedReceipts || 0) + 1;
  return store.updateReputation(providerId, {
    rejectedReceipts,
    lastRejectionReasons: reasons,
    routingBlocked: rejectedReceipts >= 3
  });
}

export default {
  recordAcceptedReceipt,
  recordRejectedReceipt
};
