/**
 * @fileoverview Frozen north-star policy and evidence for annotation adjudication.
 *
 * This contract joins the baseline, scientific-cost representation, conclusion
 * rule, independence rule, and paired aggregation before outcomes are visible.
 * Operational activity counters are explicitly excluded from product success.
 */

import { DISCOVERY_COST_COMPONENTS } from './discovery-candidate-action.js';
import { hashJson } from './inference-receipt.js';

export const ADJUDICATION_NORTH_STAR_POLICY_VERSION = 'poolday.adjudication_north_star_policy/v1';
export const ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION = 'poolday.adjudication_north_star_evidence/v1';
export const ADJUDICATION_NORTH_STAR_OBJECTIVE = 'median_normalized_cost_to_predeclared_independently_replicated_conclusion_relative_to_baseline';
export const ADJUDICATION_OPERATIONAL_METRICS = Object.freeze([
  'peers',
  'jobs',
  'receipts',
  'records',
  'claims',
  'total_compute'
]);
export const ADJUDICATION_INDEPENDENCE_DIMENSIONS = Object.freeze([
  'reviewer_identity',
  'evidence_source',
  'outcome_author_identity',
  'operator_identity',
  'institution',
  'instrument',
  'sample_batch',
  'preparation_batch',
  'analysis_execution'
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const requiredText = (value, label, max = 2000) => {
  const normalized = text(value, max);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};
const requiredHash = (value, label) => {
  const normalized = text(value, 160).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};
const integer = (value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new TypeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return normalized;
};
const number = (value, label, { min = 0, max = Number.MAX_VALUE } = {}) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new TypeError(`${label} must be a number from ${min} to ${max}`);
  }
  return normalized;
};
const uniqueList = (values, label, { min = 1, max = 64 } = {}) => {
  const normalized = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, 120).toLowerCase()).filter(Boolean))];
  if (normalized.length < min || normalized.length > max) {
    throw new TypeError(`${label} requires between ${min} and ${max} entries`);
  }
  return normalized;
};
const sameSet = (left, right) => (
  left.length === right.length && left.every((value) => right.includes(value))
);

export async function normalizeAdjudicationNorthStarPolicy(policy = {}, {
  metricDefinitions = [],
  cohortCaseCount = 0
} = {}) {
  const metricId = requiredText(policy.costToReplicatedConclusionMetricId, 'north-star metric id', 120);
  const metric = metricDefinitions.find((entry) => entry.id === metricId);
  if (!metric || metric.direction !== 'lower_is_better') {
    throw new TypeError('north-star cost metric must be a frozen lower-is-better metric');
  }
  const declaredComponentIds = uniqueList(policy.costRepresentation?.componentIds, 'north-star cost components', {
    min: DISCOVERY_COST_COMPONENTS.length,
    max: DISCOVERY_COST_COMPONENTS.length
  });
  if (!sameSet(declaredComponentIds, DISCOVERY_COST_COMPONENTS.map((component) => component.toLowerCase()))) {
    throw new TypeError('north-star cost representation must retain every scientific-cost component');
  }
  const componentIds = [...DISCOVERY_COST_COMPONENTS];
  const normalizedUnit = requiredText(policy.costRepresentation?.normalizedUnit, 'north-star normalized cost unit', 120);
  if (metric.unit !== normalizedUnit) {
    throw new TypeError('north-star metric unit must match the normalized scientific-cost unit');
  }
  const conversionPolicy = {
    policyId: requiredText(policy.costRepresentation?.conversionPolicy?.policyId, 'cost conversion policy id', 240),
    version: requiredText(policy.costRepresentation?.conversionPolicy?.version, 'cost conversion policy version', 120),
    artifactHash: requiredHash(policy.costRepresentation?.conversionPolicy?.artifactHash, 'cost conversion policy artifact')
  };
  const costRepresentation = {
    schema: 'poolday.normalized_scientific_cost/v1',
    componentIds,
    rawAmountsRemainInOriginalUnits: policy.costRepresentation?.rawAmountsRemainInOriginalUnits === true,
    normalizedUnit,
    conversionPolicy,
    caseAggregation: 'sum_normalized_cost_components',
    includeFailedAttempts: policy.costRepresentation?.includeFailedAttempts === true,
    includeUnresolvedCases: policy.costRepresentation?.includeUnresolvedCases === true,
    stopRule: requiredText(policy.costRepresentation?.stopRule, 'north-star cost stop rule')
  };
  if (!costRepresentation.rawAmountsRemainInOriginalUnits
    || !costRepresentation.includeFailedAttempts
    || !costRepresentation.includeUnresolvedCases) {
    throw new TypeError('north-star cost must preserve raw units and include failed and unresolved cases');
  }

  const declaredConclusionStates = uniqueList(policy.conclusionCriteria?.decisionStates, 'north-star conclusion states', {
    min: 4,
    max: 4
  });
  if (!sameSet(declaredConclusionStates, ['retain', 'revise', 'reject', 'unresolved'])) {
    throw new TypeError('north-star conclusion criteria must retain retain, revise, reject, and unresolved states');
  }
  const conclusionStates = ['retain', 'revise', 'reject', 'unresolved'];
  const conclusionCriteria = {
    policyId: requiredText(policy.conclusionCriteria?.policyId, 'conclusion policy id', 240),
    version: requiredText(policy.conclusionCriteria?.version, 'conclusion policy version', 120),
    artifactHash: requiredHash(policy.conclusionCriteria?.artifactHash, 'conclusion policy artifact'),
    decisionStates: conclusionStates,
    frozenBeforeActions: policy.conclusionCriteria?.frozenBeforeActions === true,
    independentAcceptanceRequired: policy.conclusionCriteria?.independentAcceptanceRequired === true,
    independentReplicationRequired: policy.conclusionCriteria?.independentReplicationRequired === true,
    minimumIndependentReplications: integer(
      policy.conclusionCriteria?.minimumIndependentReplications,
      'minimum independent replications',
      { min: 1, max: 100 }
    )
  };
  if (!conclusionCriteria.frozenBeforeActions
    || !conclusionCriteria.independentAcceptanceRequired
    || !conclusionCriteria.independentReplicationRequired) {
    throw new TypeError('north-star conclusion criteria must be frozen, independently accepted, and independently replicated');
  }

  const declaredDimensions = uniqueList(
    policy.independenceCriteria?.requiredDimensions,
    'north-star independence dimensions',
    { min: 2, max: ADJUDICATION_INDEPENDENCE_DIMENSIONS.length }
  );
  if (declaredDimensions.some((entry) => !ADJUDICATION_INDEPENDENCE_DIMENSIONS.includes(entry))
    || !declaredDimensions.includes('reviewer_identity')) {
    throw new TypeError('north-star independence requires reviewer_identity and only supported dimensions');
  }
  const requiredDimensions = ADJUDICATION_INDEPENDENCE_DIMENSIONS
    .filter((dimension) => declaredDimensions.includes(dimension));
  const independenceCriteria = {
    policyId: requiredText(policy.independenceCriteria?.policyId, 'independence policy id', 240),
    version: requiredText(policy.independenceCriteria?.version, 'independence policy version', 120),
    artifactHash: requiredHash(policy.independenceCriteria?.artifactHash, 'independence policy artifact'),
    requiredDimensions,
    comparisonRule: 'all_declared_dimensions_must_differ',
    evaluatorExcludedFromCaseEvidence: policy.independenceCriteria?.evaluatorExcludedFromCaseEvidence === true
  };
  if (!independenceCriteria.evaluatorExcludedFromCaseEvidence) {
    throw new TypeError('north-star evaluator must be excluded from case evidence');
  }

  const aggregation = {
    unitOfAnalysis: 'paired_catalog_case',
    caseStatistic: 'normalized_cost_to_declared_stop',
    cohortStatistic: 'median',
    comparisonStatistic: 'paired_candidate_minus_baseline',
    intervalMethod: requiredText(policy.aggregation?.intervalMethod, 'north-star interval method', 500),
    minimumPairedCases: integer(policy.aggregation?.minimumPairedCases, 'north-star minimum paired cases', {
      min: 2,
      max: Math.max(2, Number(cohortCaseCount) || 2)
    }),
    confidenceLevel: number(policy.aggregation?.confidenceLevel, 'north-star confidence level', { min: 0.01, max: 1 }),
    minimumImprovementThreshold: number(
      policy.aggregation?.minimumImprovementThreshold,
      'north-star minimum improvement threshold'
    ),
    missingCasePolicy: 'charge_frozen_budget_ceiling_and_report_incomplete'
  };
  if (aggregation.minimumPairedCases > cohortCaseCount) {
    throw new TypeError('north-star minimum paired cases exceeds the frozen cohort');
  }

  const declaredOperationalMetrics = uniqueList(policy.operationalMetrics, 'north-star operational metrics', {
    min: 1,
    max: ADJUDICATION_OPERATIONAL_METRICS.length
  });
  if (!sameSet(declaredOperationalMetrics, ADJUDICATION_OPERATIONAL_METRICS)) {
    throw new TypeError('north-star policy must classify every activity counter as operational');
  }
  const operationalMetrics = [...ADJUDICATION_OPERATIONAL_METRICS];
  const normalized = {
    schema: ADJUDICATION_NORTH_STAR_POLICY_VERSION,
    objective: ADJUDICATION_NORTH_STAR_OBJECTIVE,
    costToReplicatedConclusionMetricId: metricId,
    costRepresentation,
    conclusionCriteria,
    independenceCriteria,
    aggregation,
    operationalMetrics,
    successAuthority: 'quality_or_effort_gate_plus_north_star_cost_only'
  };
  return { ...normalized, policyHash: await hashJson(normalized) };
}

export async function normalizeAdjudicationNorthStarEvidence(evidence = {}, {
  policy,
  pairedSampleCount,
  cohortCaseCount,
  missingCaseCount
} = {}) {
  if (policy?.schema !== ADJUDICATION_NORTH_STAR_POLICY_VERSION) {
    throw new TypeError('north-star evidence requires the frozen north-star policy');
  }
  const arm = (entry = {}, label) => ({
    observedCaseCount: integer(entry.observedCaseCount, `${label} observed case count`, { max: cohortCaseCount }),
    independentlyReplicatedConclusionCount: integer(
      entry.independentlyReplicatedConclusionCount,
      `${label} independently replicated conclusion count`,
      { max: cohortCaseCount }
    )
  });
  const baseline = arm(evidence.baseline, 'baseline');
  const candidate = arm(evidence.candidate, 'candidate');
  for (const [label, entry] of [['baseline', baseline], ['candidate', candidate]]) {
    if (entry.independentlyReplicatedConclusionCount > entry.observedCaseCount) {
      throw new TypeError(`${label} replicated conclusions exceed observed cases`);
    }
  }
  const normalized = {
    schema: ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION,
    policyHash: policy.policyHash,
    caseEvidenceManifestHash: requiredHash(evidence.caseEvidenceManifestHash, 'north-star case evidence manifest'),
    rawCostObservationManifestHash: requiredHash(evidence.rawCostObservationManifestHash, 'north-star raw cost manifest'),
    conclusionAuditManifestHash: requiredHash(evidence.conclusionAuditManifestHash, 'north-star conclusion audit manifest'),
    independenceAuditManifestHash: requiredHash(evidence.independenceAuditManifestHash, 'north-star independence audit manifest'),
    conversionAuditArtifactHash: requiredHash(evidence.conversionAuditArtifactHash, 'north-star conversion audit artifact'),
    baseline,
    candidate,
    allFrozenCasesIncluded: evidence.allFrozenCasesIncluded === true,
    realWorldObserved: evidence.realWorldObserved === true,
    criteriaAppliedBeforeOutcomeAccess: evidence.criteriaAppliedBeforeOutcomeAccess === true,
    operationalMetricsExcludedFromSuccess: evidence.operationalMetricsExcludedFromSuccess === true
  };
  const complete = Number(missingCaseCount) === 0
    && normalized.allFrozenCasesIncluded
    && normalized.realWorldObserved
    && normalized.criteriaAppliedBeforeOutcomeAccess
    && normalized.operationalMetricsExcludedFromSuccess
    && baseline.observedCaseCount === cohortCaseCount
    && candidate.observedCaseCount === cohortCaseCount
    && baseline.independentlyReplicatedConclusionCount === cohortCaseCount
    && candidate.independentlyReplicatedConclusionCount === cohortCaseCount
    && Number(pairedSampleCount) === cohortCaseCount;
  normalized.reportingStatus = complete ? 'reportable' : 'incomplete';
  normalized.reportingBoundary = complete
    ? 'signed_evaluator_report_not_biological_truth'
    : 'north_star_improvement_claim_prohibited';
  return { ...normalized, evidenceHash: await hashJson(normalized) };
}

export default {
  ADJUDICATION_INDEPENDENCE_DIMENSIONS,
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION,
  ADJUDICATION_NORTH_STAR_OBJECTIVE,
  ADJUDICATION_NORTH_STAR_POLICY_VERSION,
  ADJUDICATION_OPERATIONAL_METRICS,
  normalizeAdjudicationNorthStarEvidence,
  normalizeAdjudicationNorthStarPolicy
};
