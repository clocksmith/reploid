/**
 * @fileoverview Client helpers for pool reputation display.
 */

export function summarizeReputation(state = {}) {
  const accepted = Number(state.acceptedReceipts || 0);
  const rejected = Number(state.rejectedReceipts || 0);
  const timeouts = Number(state.timeouts || 0);
  const total = accepted + rejected + timeouts;
  const score = total > 0 ? accepted / total : 0;
  return {
    providerId: state.providerId || null,
    score,
    acceptedReceipts: accepted,
    rejectedReceipts: rejected,
    timeouts,
    routingEligible: score >= 0 || total === 0
  };
}

export default {
  summarizeReputation
};
