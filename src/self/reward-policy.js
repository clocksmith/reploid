/**
 * @fileoverview Pure scoring and scheduling rules for swarm contribution.
 */

export const DEFAULT_REWARD_POLICY = Object.freeze({
  outputPointsPer1k: 1,
  inputPointsPer1k: 0.25,
  diversityBonus: 0.15,
  repeatedPairCap: 3,
  minCountedTokens: 128,
  scoreHalfLifeMs: 1000 * 60 * 60 * 24 * 30
});

const roundScore = (value) => Math.round(Number(value || 0) * 1000) / 1000;

export function createContributionSummary(input = {}) {
  return {
    score: roundScore(input.score || 0),
    providedInputTokens: Math.max(0, Number(input.providedInputTokens || 0)),
    providedOutputTokens: Math.max(0, Number(input.providedOutputTokens || 0)),
    receiptsServed: Math.max(0, Number(input.receiptsServed || 0)),
    receiptsConsumed: Math.max(0, Number(input.receiptsConsumed || 0)),
    uniquePeers: Array.from(new Set(Array.isArray(input.uniquePeers) ? input.uniquePeers.filter(Boolean) : [])),
    updatedAt: input.updatedAt || null
  };
}

export function deriveContributionDelta(receipt, policy = DEFAULT_REWARD_POLICY) {
  const inputTokens = Math.max(0, Number(receipt?.inputTokens || 0));
  const outputTokens = Math.max(0, Number(receipt?.outputTokens || 0));
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens < policy.minCountedTokens) {
    return {
      eligible: false,
      inputTokens,
      outputTokens,
      scoreDelta: 0
    };
  }

  const outputScore = (outputTokens / 1000) * Number(policy.outputPointsPer1k || 0);
  const inputScore = (inputTokens / 1000) * Number(policy.inputPointsPer1k || 0);

  return {
    eligible: true,
    inputTokens,
    outputTokens,
    scoreDelta: roundScore(outputScore + inputScore)
  };
}

export function getPairReceiptCount(receiptHistory = [], providerId = '', consumerId = '') {
  return (Array.isArray(receiptHistory) ? receiptHistory : []).filter((receipt) => (
    receipt?.provider === providerId && receipt?.consumer === consumerId
  )).length;
}

export function isReceiptEligible(receipt, receiptHistory = [], policy = DEFAULT_REWARD_POLICY) {
  if (!receipt || receipt.status === 'failed' || receipt.status === 'cancelled') {
    return false;
  }

  const delta = deriveContributionDelta(receipt, policy);
  if (!delta.eligible) return false;

  const pairCount = getPairReceiptCount(receiptHistory, receipt.provider, receipt.consumer);
  return pairCount < Number(policy.repeatedPairCap || 0);
}

export function applyReceiptToContribution(contribution, receipt, receiptHistory = [], policy = DEFAULT_REWARD_POLICY) {
  const next = createContributionSummary(contribution);
  if (!isReceiptEligible(receipt, receiptHistory, policy)) {
    return next;
  }

  const delta = deriveContributionDelta(receipt, policy);
  const uniquePeers = new Set(next.uniquePeers);
  const otherPeerId = String(receipt?.consumer || '').trim();
  const isNewPeer = !!otherPeerId && !uniquePeers.has(otherPeerId);
  if (isNewPeer) {
    uniquePeers.add(otherPeerId);
  }

  next.score = roundScore(
    next.score
      + delta.scoreDelta
      + (isNewPeer ? Number(policy.diversityBonus || 0) : 0)
  );
  next.providedInputTokens += delta.inputTokens;
  next.providedOutputTokens += delta.outputTokens;
  next.receiptsServed += 1;
  next.uniquePeers = Array.from(uniquePeers);
  next.updatedAt = receipt?.timestamp || Date.now();
  return next;
}

export function decayContributionScore(contribution, now = Date.now(), policy = DEFAULT_REWARD_POLICY) {
  const summary = createContributionSummary(contribution);
  if (!summary.score || !summary.updatedAt) {
    return summary.score;
  }

  const halfLife = Math.max(1, Number(policy.scoreHalfLifeMs || DEFAULT_REWARD_POLICY.scoreHalfLifeMs));
  const age = Math.max(0, Number(now) - Number(summary.updatedAt));
  if (age === 0) return summary.score;

  const decayed = summary.score * Math.pow(0.5, age / halfLife);
  return roundScore(decayed);
}

export function rankProviderPeers(peers = [], options = {}) {
  const now = Number(options.now || Date.now());
  const policy = options.policy || DEFAULT_REWARD_POLICY;

  return [...(Array.isArray(peers) ? peers : [])]
    .filter((peer) => peer?.role === 'provider')
    .map((peer) => ({
      ...peer,
      decayedScore: decayContributionScore(peer?.contribution, now, policy)
    }))
    .sort((left, right) => {
      if (right.decayedScore !== left.decayedScore) {
        return right.decayedScore - left.decayedScore;
      }

      const rightUnique = Array.isArray(right?.contribution?.uniquePeers) ? right.contribution.uniquePeers.length : 0;
      const leftUnique = Array.isArray(left?.contribution?.uniquePeers) ? left.contribution.uniquePeers.length : 0;
      if (rightUnique !== leftUnique) {
        return rightUnique - leftUnique;
      }

      return String(left?.peerId || '').localeCompare(String(right?.peerId || ''));
    });
}

export default {
  DEFAULT_REWARD_POLICY,
  applyReceiptToContribution,
  createContributionSummary,
  decayContributionScore,
  deriveContributionDelta,
  getPairReceiptCount,
  isReceiptEligible,
  rankProviderPeers
};
