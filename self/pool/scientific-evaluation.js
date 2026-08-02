/**
 * @fileoverview Frozen evaluation input contract for Poolday model promotion.
 *
 * This record is separate from a scientific-fitness decision. It captures the
 * frozen public cohort, family-disjoint partition, model runs, adjudication,
 * and measured metrics that a later decision must reference exactly.
 */

import { browserQualificationIdentity } from './browser-qualification.js';

export const SCIENTIFIC_EVALUATION_SCHEMA = 'poolday.frozen_scientific_evaluation/v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function buildScientificEvaluationPlan({
  candidate = {},
  candidateContractKey = '',
  baselines = [],
  baselineContractKeys = []
} = {}) {
  return Object.freeze({
    schema: SCIENTIFIC_EVALUATION_SCHEMA,
    candidate: browserQualificationIdentity(candidate, candidateContractKey),
    baselines: Object.freeze(baselines.map((baseline, index) => browserQualificationIdentity(
      baseline,
      baselineContractKeys[index] || ''
    )))
  });
}

const validateIdentities = (record = {}, plan = {}, reasons = []) => {
  for (const [field, value] of Object.entries(plan.candidate || {})) {
    if (!nonEmptyText(value) || record.candidate?.[field] !== value) {
      reasons.push(`scientific evaluation candidate ${field} does not match the exact model contract`);
    }
  }
  if (!Array.isArray(record.baselines) || record.baselines.length !== plan.baselines.length) {
    reasons.push('scientific evaluation baselines do not match the governed plan');
    return;
  }
  for (const [index, expected] of plan.baselines.entries()) {
    for (const [field, value] of Object.entries(expected)) {
      if (!nonEmptyText(value) || record.baselines[index]?.[field] !== value) {
        reasons.push(`scientific evaluation baseline ${index + 1} ${field} does not match the exact model contract`);
      }
    }
  }
};

/**
 * Validate the frozen inputs and outputs of a model comparison. This validates
 * evidence structure and exact identity bindings only. It does not establish
 * biological truth or convert masked-residue plausibility into fitness.
 */
export function validateScientificEvaluationRecord(record = {}, {
  candidate = {},
  candidateContractKey = '',
  baselines = [],
  baselineContractKeys = []
} = {}) {
  record = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const reasons = [];
  const plan = buildScientificEvaluationPlan({ candidate, candidateContractKey, baselines, baselineContractKeys });
  if (record.schema !== SCIENTIFIC_EVALUATION_SCHEMA) reasons.push('scientific evaluation schema is invalid');
  validateIdentities(record, plan, reasons);

  const evaluation = record.evaluation || {};
  if (!nonEmptyText(evaluation.evaluationId) || !isSha256(evaluation.protocolHash)
    || !isSha256(evaluation.runHash) || !isSha256(evaluation.resultSetHash)) {
    reasons.push('scientific evaluation identity is invalid');
  }

  const cohort = record.frozenCohort || {};
  const members = Array.isArray(cohort.members) ? cohort.members : [];
  if (!nonEmptyText(cohort.cohortId) || !isSha256(cohort.cohortHash)
    || !isSha256(cohort.sourceManifestHash) || cohort.publicOnly !== true
    || members.length < 3) {
    reasons.push('scientific evaluation frozen public cohort is invalid');
  }
  const sampleHashes = new Set();
  for (const member of members) {
    if (!isSha256(member?.sampleHash) || !isSha256(member?.familyHash)
      || !isSha256(member?.inputHash) || !isSha256(member?.observationHash)
      || sampleHashes.has(member.sampleHash)) {
      reasons.push('scientific evaluation cohort memberships are invalid');
      break;
    }
    sampleHashes.add(member.sampleHash);
  }

  const partition = record.familyPartition || {};
  const holdoutFamilies = Array.isArray(partition.holdoutFamilyHashes) ? partition.holdoutFamilyHashes : [];
  const developmentFamilies = Array.isArray(partition.developmentFamilyHashes) ? partition.developmentFamilyHashes : [];
  const admittedFamilies = new Set([...holdoutFamilies, ...developmentFamilies]);
  if (!nonEmptyText(partition.methodId) || !nonEmptyText(partition.version) || !isSha256(partition.definitionHash)
    || holdoutFamilies.length < 2 || developmentFamilies.length < 1
    || [...admittedFamilies].length !== holdoutFamilies.length + developmentFamilies.length
    || [...admittedFamilies].some((familyHash) => !isSha256(familyHash))
    || members.some((member) => !admittedFamilies.has(member.familyHash))) {
    reasons.push('scientific evaluation family partition is not frozen and disjoint');
  }
  const observedFamilies = new Set(members.map((member) => member?.familyHash));
  if (holdoutFamilies.some((familyHash) => !observedFamilies.has(familyHash))) {
    reasons.push('scientific evaluation frozen cohort lacks a declared holdout family');
  }

  const adjudication = record.adjudication || {};
  if (!nonEmptyText(adjudication.protocolId) || !nonEmptyText(adjudication.version)
    || !isSha256(adjudication.protocolHash) || !isSha256(adjudication.outcomeHash)
    || !nonEmptyText(adjudication.evaluatorIdentity)) {
    reasons.push('scientific evaluation adjudication evidence is invalid');
  }

  const expectedKeys = new Set([plan.candidate.exactModelContractKey, ...plan.baselines.map((entry) => entry.exactModelContractKey)]);
  const modelRuns = Array.isArray(record.modelRuns) ? record.modelRuns : [];
  const observedKeys = new Set();
  for (const run of modelRuns) {
    if (!expectedKeys.has(run?.exactModelContractKey) || observedKeys.has(run.exactModelContractKey)
      || run?.evaluationRunHash !== evaluation.runHash || !isSha256(run?.resultHash)
      || !isSha256(run?.outputSetHash)) {
      reasons.push('scientific evaluation model runs are not bound to the governed exact contracts');
      break;
    }
    observedKeys.add(run.exactModelContractKey);
  }
  if (observedKeys.size !== expectedKeys.size) {
    reasons.push('scientific evaluation lacks a result set for every exact model contract');
  }

  const metrics = Array.isArray(record.metricResults) ? record.metricResults : [];
  if (metrics.length < 1 || metrics.some((metric) => (
    !nonEmptyText(metric?.metricId)
    || !['higher_is_better', 'lower_is_better'].includes(metric?.direction)
    || !Number.isFinite(metric?.baselineValue)
    || !Number.isFinite(metric?.candidateValue)
    || !isSha256(metric?.definitionHash)
    || !isSha256(metric?.resultHash)
    || metric?.evaluationRunHash !== evaluation.runHash
    || !plan.baselines.some((baseline) => baseline.exactModelContractKey === metric?.baselineExactModelContractKey)
    || typeof metric?.improved !== 'boolean'
  ))) {
    reasons.push('scientific evaluation metrics are not bound to the frozen run and exact baseline');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Determine whether a scientific-fitness receipt exactly references a frozen
 * evaluation manifest supplied by the release verifier.
 */
export function validateScientificFitnessEvaluationBinding(fitnessRecord = {}, evaluationRecord = {}) {
  const reasons = [];
  if (!sameJson(fitnessRecord.candidate, evaluationRecord.candidate)
    || !sameJson(fitnessRecord.baselines, evaluationRecord.baselines)) {
    reasons.push('scientific fitness does not match the frozen evaluation model identities');
  }
  const evaluationIdentity = { ...(fitnessRecord.evaluation || {}) };
  delete evaluationIdentity.receiptPath;
  delete evaluationIdentity.receiptHash;
  if (fitnessRecord.frozenCohortHash !== evaluationRecord.frozenCohort?.cohortHash
    || !sameJson(evaluationIdentity, evaluationRecord.evaluation)
    || !sameJson(fitnessRecord.familyPartition, evaluationRecord.familyPartition)
    || !sameJson(fitnessRecord.adjudication, evaluationRecord.adjudication)
    || !sameJson(fitnessRecord.metricResults, evaluationRecord.metricResults)) {
    reasons.push('scientific fitness does not exactly bind the frozen evaluation evidence');
  }
  return { ok: reasons.length === 0, reasons };
}

export default {
  SCIENTIFIC_EVALUATION_SCHEMA,
  buildScientificEvaluationPlan,
  validateScientificEvaluationRecord,
  validateScientificFitnessEvaluationBinding
};
