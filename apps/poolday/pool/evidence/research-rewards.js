/** Contribution rewards from independently accepted, durable evidence; points come from the evidence policy. */
import {
  RESEARCH_RECORD_KINDS,
  projectResearchExecutionIndependence
} from '../evidence-record-contract.js';
import {
  EVIDENCE_POLICY
} from './primitives.js';
import {
  acceptedReviewHashes,
  activeResearchRecords
} from './review-state.js';
import {
  REALIZED_ACTION_VALUE_REWARD_POLICY
} from '../realized-action-value.js';

const REWARD_POINTS = EVIDENCE_POLICY.rewardPoints;

export function projectResearchRewards(records = []) {
  const active = activeResearchRecords(records);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const accepted = acceptedReviewHashes(records);
  const contradicted = new Set(claims.filter((record) => ['contradicts', 'corrects'].includes(record.claim.relation)).map((record) => record.targetHash));
  const state = new Map();
  const ensure = (author = {}) => {
    const id = author.roleId || 'unknown';
    if (!state.has(id)) state.set(id, {
      authorId: id,
      verifiedCompute: 0,
      acceptedEvidence: 0,
      durableEvidence: 0,
      acceptedReviews: 0,
      durableReviews: 0,
      experimentalOutcomes: 0,
      independentReplications: 0,
      prospectiveEvaluations: 0,
      realizedActionValues: 0,
      realizedUsefulnessCredits: 0,
      realizedValuePoints: 0,
      points: 0
    });
    return state.get(id);
  };
  for (const result of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result)) {
    const contributor = ensure({ roleId: result.compute?.providerId });
    const independence = projectResearchExecutionIndependence(result);
    const admittedPrimary = result.compute?.receiptAdmission?.accepted === true
      || result.compute?.verifierDecision?.accepted === true;
    const receiptCount = Math.max(admittedPrimary ? 1 : 0, independence.independentReceiptCount);
    contributor.verifiedCompute += receiptCount;
    contributor.points += receiptCount * REWARD_POINTS.verifiedComputeReceipt;
  }
  for (const outcome of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome)) {
    if (!accepted.has(outcome.recordHash)) continue;
    const contributor = ensure(outcome.author);
    contributor.experimentalOutcomes += 1;
    contributor.points += REWARD_POINTS.acceptedOutcome;
    if (outcome.replicationOfHash) {
      contributor.independentReplications += 1;
      contributor.points += REWARD_POINTS.independentReplication;
    }
  }
  for (const evaluation of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation)) {
    const contributor = ensure(evaluation.author);
    contributor.prospectiveEvaluations += 1;
    contributor.points += REWARD_POINTS.evaluation
      + evaluation.evaluation.metricResults.filter((metric) => metric.improved).length * REWARD_POINTS.improvedEvaluationMetric;
  }
  const rewardRecordsByHash = new Map(active.map((record) => [record.recordHash, record]));
  const creditedActionContributions = new Set();
  for (const valueRecord of active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
    && record.realizedValue?.assessment?.status === 'demonstrated_useful'
    && accepted.has(record.recordHash)
  ))) {
    for (const contribution of valueRecord.realizedValue.contributions || []) {
      const creditKey = `${valueRecord.realizedValue.candidateActionHash}:${contribution.recordHash}`;
      if (creditedActionContributions.has(creditKey)) continue;
      const source = rewardRecordsByHash.get(contribution.recordHash);
      if (!source?.author) continue;
      creditedActionContributions.add(creditKey);
      const contributor = ensure(source.author);
      contributor.realizedActionValues += 1;
      contributor.realizedUsefulnessCredits += 1;
      contributor.realizedValuePoints += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
      contributor.points += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
    }
  }
  for (const claim of claims.filter((record) => !['review_decision', 'task_approval'].includes(record.claim.kind))) {
    if (!accepted.has(claim.recordHash)) continue;
    const contributor = ensure(claim.author);
    contributor.acceptedEvidence += 1;
    contributor.points += REWARD_POINTS.acceptedEvidence;
    if (!contradicted.has(claim.recordHash)) {
      contributor.durableEvidence += 1;
      contributor.points += REWARD_POINTS.durableEvidence;
    }
  }
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record]));
  for (const review of claims.filter((record) => record.claim.kind === 'review_decision' && record.claim.decision === 'accepted')) {
    const target = recordsByHash.get(review.targetHash);
    if (!target || target.author?.identityRootId === review.author?.identityRootId) continue;
    const reviewer = ensure(review.author);
    reviewer.acceptedReviews += 1;
    reviewer.points += REWARD_POINTS.acceptedReview;
    if (!contradicted.has(review.recordHash) && !contradicted.has(review.targetHash)) {
      reviewer.durableReviews += 1;
      reviewer.points += REWARD_POINTS.durableReview;
    }
  }
  return [...state.values()].map((entry) => ({
    ...entry,
    quality: (entry.acceptedEvidence + entry.acceptedReviews)
      ? (entry.durableEvidence + entry.durableReviews) / (entry.acceptedEvidence + entry.acceptedReviews)
      : 0
  })).sort((left, right) => right.points - left.points);
}
