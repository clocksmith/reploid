/**
 * @fileoverview Points ledger mutations for accepted and penalized pool work.
 */

export function calculateReceiptPoints(receiptRecord, { multiplier = 1 } = {}) {
  const receipt = receiptRecord.receipt;
  const outputTokens = Number(receipt?.tokenCounts?.output || 0);
  const inputTokens = Number(receipt?.tokenCounts?.input || 0);
  const basePoints = Math.max(1, outputTokens + Math.floor(inputTokens / 4));
  return Math.max(1, Math.floor(basePoints * multiplier));
}

export async function awardAcceptedReceipt({ store, receiptRecord, acceptance, multiplier = 1, reason = 'accepted_receipt', points = null }) {
  const receipt = receiptRecord.receipt;
  const awardedPoints = points === null || points === undefined
    ? calculateReceiptPoints(receiptRecord, { multiplier })
    : Math.max(0, Math.floor(Number(points || 0)));
  const event = await store.appendLedger({
    eventType: 'points_awarded',
    reason,
    receiptHash: receiptRecord.receiptHash,
    providerId: receipt.providerId,
    requesterId: receipt.requesterId,
    userId: receipt.providerId,
    points: awardedPoints,
    acceptance
  });
  return event;
}

export async function penalizeProvider({ store, providerId, requesterId = null, receiptHash = null, assignmentId = null, reason = 'provider_penalty', points = -1, evidence = {} } = {}) {
  if (!providerId) return null;
  return store.appendLedger({
    eventType: 'points_penalized',
    reason,
    receiptHash,
    assignmentId,
    providerId,
    requesterId,
    userId: providerId,
    points: -Math.abs(Number(points || 1)),
    evidence
  });
}

export async function chargeRequester({ store, requesterId, receiptHash = null, receiptHashes = [], reason = 'accepted_result_spend', points = 0, acceptance = null } = {}) {
  if (!requesterId || Number(points || 0) <= 0) return null;
  return store.appendLedger({
    eventType: 'points_spent',
    reason,
    receiptHash,
    receiptHashes,
    requesterId,
    userId: requesterId,
    points: -Math.abs(Number(points)),
    acceptance
  });
}

export default {
  calculateReceiptPoints,
  awardAcceptedReceipt,
  penalizeProvider,
  chargeRequester
};
