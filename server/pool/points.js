/**
 * @fileoverview Points ledger mutations for accepted pool receipts.
 */

export function awardAcceptedReceipt({ store, receiptRecord, acceptance }) {
  const receipt = receiptRecord.receipt;
  const outputTokens = Number(receipt?.tokenCounts?.output || 0);
  const inputTokens = Number(receipt?.tokenCounts?.input || 0);
  const points = Math.max(1, outputTokens + Math.floor(inputTokens / 4));
  const event = store.appendLedger({
    eventType: 'points_awarded',
    reason: 'accepted_receipt',
    receiptHash: receiptRecord.receiptHash,
    providerId: receipt.providerId,
    requesterId: receipt.requesterId,
    userId: receipt.providerId,
    points,
    acceptance
  });
  return event;
}

export default {
  awardAcceptedReceipt
};
