/**
 * @fileoverview Fail-closed evidence requirements for Poolday model scientific fitness.
 *
 * A technical model qualification does not establish scientific value. This
 * contract binds a candidate's value claim to frozen, adjudicated,
 * family-disjoint evidence and exact baseline identities.
 */

import { browserQualificationIdentity } from './browser-qualification.js';

export const SCIENTIFIC_FITNESS_SCHEMA = 'poolday.model_scientific_fitness/v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0;

export function buildScientificFitnessPlan({
  candidate = {},
  candidateContractKey = '',
  baselines = [],
  baselineContractKeys = []
} = {}) {
  const normalizedBaselines = baselines.map((baseline, index) => browserQualificationIdentity(
    baseline,
    baselineContractKeys[index] || ''
  ));
  return Object.freeze({
    schema: SCIENTIFIC_FITNESS_SCHEMA,
    candidate: browserQualificationIdentity(candidate, candidateContractKey),
    baselines: Object.freeze(normalizedBaselines),
    requiredEvidence: Object.freeze([
      'frozenCohort',
      'familyDisjointPartition',
      'independentAdjudication',
      'exactModelComparisons',
      'measuredDecisionValue'
    ])
  });
}

/**
 * Validate a model-specific scientific-fitness record. A passing record means
 * only that the declared evaluation evidence meets this contract. It does not
 * establish protein function, mutation fitness, or biological truth.
 */
export function validateScientificFitnessRecord(record = {}, {
  candidate = {},
  candidateContractKey = '',
  baselines = [],
  baselineContractKeys = []
} = {}) {
  const reasons = [];
  const plan = buildScientificFitnessPlan({
    candidate,
    candidateContractKey,
    baselines,
    baselineContractKeys
  });
  if (record.schema !== SCIENTIFIC_FITNESS_SCHEMA) reasons.push('scientific fitness schema is invalid');
  for (const [field, value] of Object.entries(plan.candidate)) {
    if (!nonEmptyText(value)) reasons.push(`expected scientific fitness candidate ${field} is missing`);
    if (record.candidate?.[field] !== value) reasons.push(`scientific fitness candidate ${field} does not match the exact model contract`);
  }
  if (plan.baselines.length < 1) reasons.push('scientific fitness requires an exact baseline model');
  if (plan.baselines.some((baseline) => baseline.exactModelContractKey === plan.candidate.exactModelContractKey)) {
    reasons.push('scientific fitness candidate cannot be its own baseline');
  }
  if (!Array.isArray(record.baselines) || record.baselines.length !== plan.baselines.length) {
    reasons.push('scientific fitness baselines do not match the governed plan');
  } else {
    for (const [index, expected] of plan.baselines.entries()) {
      for (const [field, value] of Object.entries(expected)) {
        if (!nonEmptyText(value) || record.baselines[index]?.[field] !== value) {
          reasons.push(`scientific fitness baseline ${index + 1} ${field} does not match the exact model contract`);
        }
      }
    }
  }
  if (!isSha256(record.frozenCohortHash)) reasons.push('scientific fitness frozen cohort hash is invalid');
  const partition = record.familyPartition || {};
  if (!nonEmptyText(partition.methodId) || !nonEmptyText(partition.version) || !isSha256(partition.definitionHash)) {
    reasons.push('scientific fitness family partition identity is invalid');
  }
  const holdoutFamilies = Array.isArray(partition.holdoutFamilyHashes) ? partition.holdoutFamilyHashes : [];
  const developmentFamilies = Array.isArray(partition.developmentFamilyHashes) ? partition.developmentFamilyHashes : [];
  if (holdoutFamilies.length < 2 || developmentFamilies.length < 1
    || [...holdoutFamilies, ...developmentFamilies].some((hash) => !isSha256(hash))
    || new Set(holdoutFamilies).size !== holdoutFamilies.length
    || new Set(developmentFamilies).size !== developmentFamilies.length
    || holdoutFamilies.some((hash) => developmentFamilies.includes(hash))) {
    reasons.push('scientific fitness family partition is not frozen and disjoint');
  }
  const adjudication = record.adjudication || {};
  if (!nonEmptyText(adjudication.protocolId) || !nonEmptyText(adjudication.version)
    || !isSha256(adjudication.protocolHash) || !isSha256(adjudication.outcomeHash)
    || !nonEmptyText(adjudication.evaluatorIdentity)) {
    reasons.push('scientific fitness adjudication evidence is invalid');
  }
  const metrics = Array.isArray(record.metricResults) ? record.metricResults : [];
  if (metrics.length < 1 || metrics.some((metric) => (
    !nonEmptyText(metric?.metricId)
    || !['higher_is_better', 'lower_is_better'].includes(metric?.direction)
    || !Number.isFinite(metric?.baselineValue)
    || !Number.isFinite(metric?.candidateValue)
    || typeof metric?.improved !== 'boolean'
  ))) {
    reasons.push('scientific fitness metric results are invalid');
  }
  for (const metric of metrics) {
    if (!Number.isFinite(metric?.baselineValue) || !Number.isFinite(metric?.candidateValue)) continue;
    const measuredImprovement = metric.direction === 'higher_is_better'
      ? metric.candidateValue > metric.baselineValue
      : metric.candidateValue < metric.baselineValue;
    if (metric.improved !== measuredImprovement) {
      reasons.push(`scientific fitness metric improvement flag does not match measured values: ${metric.metricId || 'unknown'}`);
    }
  }
  const improved = metrics.filter((metric) => metric.improved === true);
  if (record.decision !== 'qualified' || improved.length < 1) {
    reasons.push('scientific fitness does not demonstrate measured candidate value');
  }
  if (!nonEmptyText(record.claimBoundary)) reasons.push('scientific fitness claim boundary is required');
  if (record.claimBoundary !== candidate.admission?.claimBoundary) {
    reasons.push('scientific fitness claim boundary does not match the exact candidate contract');
  }
  return { ok: reasons.length === 0, reasons };
}

export default {
  SCIENTIFIC_FITNESS_SCHEMA,
  buildScientificFitnessPlan,
  validateScientificFitnessRecord
};
