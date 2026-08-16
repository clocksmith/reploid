/**
 * @fileoverview Canonical post-outcome action-value measurement.
 *
 * A realized value record preserves the complete measured vector. Reward is a
 * separate deterministic projection after independent acceptance.
 */

import { hashJson } from './inference-receipt.js';

export const REALIZED_ACTION_VALUE_VERSION = 'poolday.realized_action_value/v1';
export const REALIZED_ACTION_VALUE_EFFECTS = Object.freeze([
  'changed_decision',
  'narrowed_uncertainty',
  'blocked_unsafe_or_unjustified_action',
  'unchanged'
]);
export const REALIZED_ACTION_VALUE_CONTRIBUTION_ROLES = Object.freeze([
  'action_proposal',
  'evidence_input',
  'outcome_execution',
  'independent_review',
  'evaluation'
]);
export const REALIZED_ACTION_VALUE_REWARD_POLICY = Object.freeze({
  schema: 'poolday.realized_action_value_reward_policy/v1',
  unit: 'realized_usefulness_credit',
  pointsPerCreditedContribution: 10,
  deduplication: 'one_credit_per_candidate_action_and_contribution_record',
  admission: 'demonstrated_useful_and_independently_accepted_action_value'
});

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const text = (value, max = 8000) => String(value ?? '').trim().slice(0, max);
const requiredText = (value, label, max = 8000) => {
  const normalized = text(value, max);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};
const requiredHash = (value, label) => {
  const normalized = text(value, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};
const finite = (value, label) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`${label} must be finite`);
  return normalized;
};
const uniqueHashes = (values, label, { min = 0, max = 512 } = {}) => {
  const normalized = [...new Set((Array.isArray(values) ? values : []).map((value) => requiredHash(value, label)))].sort();
  if (normalized.length < min || normalized.length > max) {
    throw new TypeError(`${label} requires between ${min} and ${max} identities`);
  }
  return normalized;
};

const normalizeMetricResult = (metric = {}, index) => {
  const direction = text(metric.direction, 40).toLowerCase();
  if (!['higher_is_better', 'lower_is_better'].includes(direction)) {
    throw new TypeError(`realized action-value metric ${index + 1} direction is invalid`);
  }
  const baselineValue = finite(metric.baselineValue, `realized action-value metric ${index + 1} baseline`);
  const currentValue = finite(metric.currentValue, `realized action-value metric ${index + 1} current value`);
  const absoluteDelta = currentValue - baselineValue;
  const improved = direction === 'higher_is_better'
    ? currentValue > baselineValue
    : currentValue < baselineValue;
  const regressed = direction === 'higher_is_better'
    ? currentValue < baselineValue
    : currentValue > baselineValue;
  return {
    metricId: requiredText(metric.metricId, `realized action-value metric ${index + 1} id`, 240),
    direction,
    baselineValue,
    currentValue,
    absoluteDelta,
    relativeDelta: baselineValue === 0 ? null : absoluteDelta / Math.abs(baselineValue),
    improved,
    regressed
  };
};

export async function normalizeRealizedActionValue(value = {}) {
  const decisionEffect = text(value.decisionEffect ?? value.assessment?.decisionEffect, 80).toLowerCase();
  if (!REALIZED_ACTION_VALUE_EFFECTS.includes(decisionEffect)) {
    throw new TypeError('realized action-value decision effect is invalid');
  }
  const reviewedOutcomes = (Array.isArray(value.reviewedOutcomes) ? value.reviewedOutcomes : [])
    .map((entry, index) => ({
      outcomeHash: requiredHash(entry.outcomeHash, `reviewed outcome ${index + 1}`),
      reviewDecisionHashes: uniqueHashes(
        entry.reviewDecisionHashes,
        `reviewed outcome ${index + 1} review decision`,
        { min: 1, max: 64 }
      )
    }))
    .sort((left, right) => left.outcomeHash.localeCompare(right.outcomeHash));
  if (!reviewedOutcomes.length || new Set(reviewedOutcomes.map((entry) => entry.outcomeHash)).size !== reviewedOutcomes.length) {
    throw new TypeError('realized action value requires unique reviewed outcomes');
  }
  const contributions = (Array.isArray(value.contributions) ? value.contributions : [])
    .map((entry, index) => {
      const role = text(entry.role, 80).toLowerCase();
      if (!REALIZED_ACTION_VALUE_CONTRIBUTION_ROLES.includes(role)) {
        throw new TypeError(`realized action-value contribution ${index + 1} role is invalid`);
      }
      return {
        recordHash: requiredHash(entry.recordHash, `realized action-value contribution ${index + 1}`),
        role,
        causalRationale: requiredText(entry.causalRationale, `realized action-value contribution ${index + 1} rationale`, 2000)
      };
    })
    .sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  if (!contributions.length || new Set(contributions.map((entry) => entry.recordHash)).size !== contributions.length) {
    throw new TypeError('realized action value requires unique causal contributions');
  }
  const metricResults = (Array.isArray(value.metricResults) ? value.metricResults : [])
    .map(normalizeMetricResult)
    .sort((left, right) => left.metricId.localeCompare(right.metricId));
  if (!metricResults.length || new Set(metricResults.map((entry) => entry.metricId)).size !== metricResults.length) {
    throw new TypeError('realized action value requires unique measured metrics');
  }
  const hasImprovement = metricResults.some((entry) => entry.improved);
  const hasRegression = metricResults.some((entry) => entry.regressed);
  const status = decisionEffect !== 'unchanged' && hasImprovement && !hasRegression
    ? 'demonstrated_useful'
    : decisionEffect === 'unchanged' || hasRegression
      ? 'not_demonstrated'
      : 'inconclusive';
  const normalized = {
    schema: REALIZED_ACTION_VALUE_VERSION,
    questionHash: requiredHash(value.questionHash, 'realized action-value question'),
    candidateActionHash: requiredHash(value.candidateActionHash, 'realized action-value candidate action'),
    actionContractHash: requiredHash(value.actionContractHash, 'realized action-value action contract'),
    candidateActionApprovalHashes: uniqueHashes(
      value.candidateActionApprovalHashes,
      'realized action-value candidate approval',
      { min: 1, max: 64 }
    ),
    evaluationHash: requiredHash(value.evaluationHash, 'realized action-value evaluation'),
    evaluationReviewDecisionHashes: uniqueHashes(
      value.evaluationReviewDecisionHashes,
      'realized action-value evaluation review decision',
      { min: 1, max: 64 }
    ),
    reviewedOutcomes,
    contributions,
    metricResults,
    assessment: {
      decisionEffect,
      status,
      summary: requiredText(value.summary ?? value.assessment?.summary, 'realized action-value summary', 4000),
      rule: 'decision_effect_and_at_least_one_improvement_with_no_regression'
    },
    reward: {
      eligibility: 'requires_independent_acceptance',
      policy: REALIZED_ACTION_VALUE_REWARD_POLICY
    },
    authority: 'measurement_only_no_scientific_closure_or_reward_self_award'
  };
  return { ...normalized, valueHash: await hashJson(normalized) };
}

export default {
  REALIZED_ACTION_VALUE_CONTRIBUTION_ROLES,
  REALIZED_ACTION_VALUE_EFFECTS,
  REALIZED_ACTION_VALUE_REWARD_POLICY,
  REALIZED_ACTION_VALUE_VERSION,
  normalizeRealizedActionValue
};
