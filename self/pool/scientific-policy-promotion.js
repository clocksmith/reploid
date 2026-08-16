/**
 * @fileoverview Frozen Zero -> X -> Poolday scientific-policy promotion contracts.
 *
 * These records define evidence and authority boundaries only. They do not
 * activate a candidate, establish scientific truth, or grant Zero/X product
 * authority.
 */

import { hashJson } from './inference-receipt.js';

export const ZERO_SCIENTIFIC_POLICY_CANDIDATE_VERSION = 'poolday.zero_scientific_policy_candidate/v1';
export const X_SCIENTIFIC_POLICY_SHADOW_COHORT_VERSION = 'poolday.x_scientific_policy_shadow_cohort/v1';
export const X_SCIENTIFIC_POLICY_SHADOW_EVALUATION_VERSION = 'poolday.x_scientific_policy_shadow_evaluation/v1';
export const POOLDAY_SCIENTIFIC_POLICY_PROMOTION_VERSION = 'poolday.scientific_policy_promotion/v1';
export const SCIENTIFIC_POLICY_METHOD_KINDS = Object.freeze([
  'hypothesis_decomposition',
  'uncertainty_estimation',
  'contradiction_detection',
  'action_selection'
]);
export const SCIENTIFIC_POLICY_EVALUATION_METRICS = Object.freeze({
  costToSameConclusion: 'lower_is_better',
  actionCount: 'lower_is_better',
  failureDetection: 'higher_is_better',
  heldOutGeneralization: 'higher_is_better',
  replicationSuccess: 'higher_is_better',
  safetyRegressionCount: 'lower_is_better',
  rollbackSuccess: 'higher_is_better'
});

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const isHash = (value) => SHA256_PATTERN.test(String(value || ''));
const unique = (values = []) => [...new Set(values.map((value) => text(value)).filter(Boolean))];
const compare = (left, right) => String(left).localeCompare(String(right));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const requiredHash = (value, label) => {
  if (!isHash(value)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return String(value);
};

const requiredText = (value, label, max) => {
  const normalized = text(value, max);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const positiveInteger = (value, label) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw new TypeError(`${label} must be a positive integer`);
  return normalized;
};

const normalizeAuthorityIdentity = (identity = {}, label, surface) => {
  const normalized = {
    surface,
    identityRootId: requiredText(identity.identityRootId, `${label} identityRootId`, 500),
    roleId: requiredText(identity.roleId, `${label} roleId`, 500),
    authority: requiredText(identity.authority, `${label} authority`, 1000)
  };
  return normalized;
};

const normalizeZeroMethod = (method = {}, index) => {
  const kind = text(method.kind, 80).toLowerCase();
  if (!SCIENTIFIC_POLICY_METHOD_KINDS.includes(kind)) {
    throw new TypeError(`Zero candidate method ${index + 1} kind is unsupported`);
  }
  return {
    kind,
    methodId: requiredText(method.methodId, `Zero candidate method ${index + 1} methodId`, 240),
    version: requiredText(method.version, `Zero candidate method ${index + 1} version`, 120),
    artifactHash: requiredHash(method.artifactHash, `Zero candidate method ${index + 1} artifactHash`),
    inputContractHash: requiredHash(method.inputContractHash, `Zero candidate method ${index + 1} inputContractHash`),
    outputContractHash: requiredHash(method.outputContractHash, `Zero candidate method ${index + 1} outputContractHash`),
    expectedBehavior: requiredText(method.expectedBehavior, `Zero candidate method ${index + 1} expectedBehavior`, 2000),
    falsifyingBehavior: requiredText(method.falsifyingBehavior, `Zero candidate method ${index + 1} falsifyingBehavior`, 2000)
  };
};

const normalizeZeroCandidate = (input = {}) => {
  const methods = (Array.isArray(input.methods) ? input.methods : []).map(normalizeZeroMethod);
  const kinds = methods.map((method) => method.kind);
  if (!methods.length || new Set(kinds).size !== kinds.length) {
    throw new TypeError('Zero candidate requires unique method kinds');
  }
  const changedModules = unique(input.change?.changedModules).sort(compare);
  const invariants = unique(input.invariants);
  const failureModes = unique(input.failureModes);
  const alternativeExplanations = unique(input.hypothesis?.alternativeExplanations);
  const evaluationMetricIds = unique(input.objective?.evaluationMetricIds).sort(compare);
  if (!changedModules.length || !invariants.length || !failureModes.length
    || !alternativeExplanations.length || !evaluationMetricIds.length) {
    throw new TypeError('Zero candidate change scope, invariants, failure modes, alternatives, and metrics are required');
  }
  const proposer = normalizeAuthorityIdentity(input.proposer, 'Zero proposer', 'zero');
  const normalized = {
    schema: ZERO_SCIENTIFIC_POLICY_CANDIDATE_VERSION,
    state: 'proposed_for_shadow_only',
    candidateId: requiredText(input.candidateId, 'Zero candidateId', 240),
    parentCandidateHash: input.parentCandidateHash ? requiredHash(input.parentCandidateHash, 'Zero parentCandidateHash') : null,
    proposer,
    objective: {
      objectiveId: requiredText(input.objective?.objectiveId, 'Zero objectiveId', 240),
      statement: requiredText(input.objective?.statement, 'Zero objective statement', 2000),
      evaluationMetricIds
    },
    hypothesis: {
      observation: requiredText(input.hypothesis?.observation, 'Zero candidate observation', 2000),
      suspectedCause: requiredText(input.hypothesis?.suspectedCause, 'Zero candidate suspected cause', 2000),
      alternativeExplanations,
      expectedResult: requiredText(input.hypothesis?.expectedResult, 'Zero candidate expected result', 2000),
      falsifyingResult: requiredText(input.hypothesis?.falsifyingResult, 'Zero candidate falsifying result', 2000)
    },
    methods,
    change: {
      revisionHash: requiredHash(input.change?.revisionHash, 'Zero candidate revisionHash'),
      sourceTreeHash: requiredHash(input.change?.sourceTreeHash, 'Zero candidate sourceTreeHash'),
      changedModules,
      semanticScope: requiredText(input.change?.semanticScope, 'Zero candidate semantic scope', 2000)
    },
    invariants,
    failureModes,
    resourceBudget: {
      tokens: positiveInteger(input.resourceBudget?.tokens, 'Zero candidate token budget'),
      calls: positiveInteger(input.resourceBudget?.calls, 'Zero candidate call budget'),
      elapsedMilliseconds: positiveInteger(input.resourceBudget?.elapsedMilliseconds, 'Zero candidate elapsed budget'),
      costAmount: Number(input.resourceBudget?.costAmount),
      costUnit: requiredText(input.resourceBudget?.costUnit, 'Zero candidate cost unit', 80)
    },
    authority: {
      activationAuthority: 'none',
      selfEvaluationAllowed: false,
      selfApprovalAllowed: false,
      protectedSurfaces: ['audit_log', 'evaluator', 'promotion_policy', 'rollback'].sort(compare)
    },
    createdAt: requiredText(input.createdAt, 'Zero candidate createdAt', 64)
  };
  if (!Number.isFinite(normalized.resourceBudget.costAmount) || normalized.resourceBudget.costAmount < 0) {
    throw new TypeError('Zero candidate cost budget must be non-negative');
  }
  if (!Number.isFinite(Date.parse(normalized.createdAt))) throw new TypeError('Zero candidate createdAt must be an ISO timestamp');
  return normalized;
};

export async function buildZeroScientificPolicyCandidate(input = {}) {
  const normalized = normalizeZeroCandidate(input);
  return Object.freeze({ ...normalized, candidateHash: await hashJson(normalized) });
}

export async function validateZeroScientificPolicyCandidate(candidate = {}) {
  const reasons = [];
  try {
    const { candidateHash, ...input } = candidate;
    const normalized = normalizeZeroCandidate(input);
    if (!sameJson(normalized, input)) reasons.push('Zero scientific-policy candidate is not canonical');
    if (await hashJson(normalized) !== candidateHash) reasons.push('Zero scientific-policy candidateHash mismatch');
  } catch (error) {
    reasons.push(error.message);
  }
  return { ok: reasons.length === 0, reasons };
}

const normalizeBaseline = (baseline = {}) => ({
  policyId: requiredText(baseline.policyId, 'Shadow baseline policyId', 240),
  version: requiredText(baseline.version, 'Shadow baseline version', 120),
  revisionHash: requiredHash(baseline.revisionHash, 'Shadow baseline revisionHash'),
  artifactHash: requiredHash(baseline.artifactHash, 'Shadow baseline artifactHash'),
  inputContractHash: requiredHash(baseline.inputContractHash, 'Shadow baseline inputContractHash'),
  budgetContractHash: requiredHash(baseline.budgetContractHash, 'Shadow baseline budgetContractHash')
});

const normalizeShadowContract = (entry = {}, index, mode) => {
  const normalized = {
    contractId: requiredText(entry.contractId, `${mode} contract ${index + 1} contractId`, 240),
    checkpointHash: requiredHash(entry.checkpointHash, `${mode} contract ${index + 1} checkpointHash`),
    questionHash: requiredHash(entry.questionHash, `${mode} contract ${index + 1} questionHash`),
    familyHash: requiredHash(entry.familyHash, `${mode} contract ${index + 1} familyHash`),
    evidenceCutoff: requiredText(entry.evidenceCutoff, `${mode} contract ${index + 1} evidenceCutoff`, 64),
    outcomeAccessAtFreeze: mode === 'historical' ? 'historical_hidden' : 'prospective_not_available',
    outcomeCommitmentHash: mode === 'historical'
      ? requiredHash(entry.outcomeCommitmentHash, `historical contract ${index + 1} outcomeCommitmentHash`)
      : null,
    contaminationAuditHash: requiredHash(entry.contaminationAuditHash, `${mode} contract ${index + 1} contaminationAuditHash`)
  };
  if (!Number.isFinite(Date.parse(normalized.evidenceCutoff))) {
    throw new TypeError(`${mode} contract ${index + 1} evidenceCutoff must be an ISO timestamp`);
  }
  return normalized;
};

const normalizeMetricDefinition = (metric = {}, index) => {
  const role = text(metric.role, 120);
  const requiredDirection = SCIENTIFIC_POLICY_EVALUATION_METRICS[role];
  if (!requiredDirection || metric.direction !== requiredDirection) {
    throw new TypeError(`Shadow metric ${index + 1} role or direction is invalid`);
  }
  return {
    role,
    metricId: requiredText(metric.metricId, `Shadow metric ${index + 1} metricId`, 240),
    direction: requiredDirection,
    unit: requiredText(metric.unit, `Shadow metric ${index + 1} unit`, 120),
    definitionHash: requiredHash(metric.definitionHash, `Shadow metric ${index + 1} definitionHash`),
    aggregation: requiredText(metric.aggregation, `Shadow metric ${index + 1} aggregation`, 500),
    validityConditions: requiredText(metric.validityConditions, `Shadow metric ${index + 1} validityConditions`, 1000),
    minimumSampleSize: positiveInteger(metric.minimumSampleSize, `Shadow metric ${index + 1} minimumSampleSize`),
    promotionThreshold: Number(metric.promotionThreshold)
  };
};

const normalizeShadowCohort = (input = {}) => {
  const historical = (Array.isArray(input.historicalContracts) ? input.historicalContracts : [])
    .map((entry, index) => normalizeShadowContract(entry, index, 'historical'));
  const prospective = (Array.isArray(input.prospectiveContracts) ? input.prospectiveContracts : [])
    .map((entry, index) => normalizeShadowContract(entry, index, 'prospective'));
  if (!historical.length || !prospective.length) {
    throw new TypeError('X Shadow cohort requires frozen historical and prospective Discovery Contracts');
  }
  const allContracts = [...historical, ...prospective];
  if (new Set(allContracts.map((entry) => entry.contractId)).size !== allContracts.length
    || new Set(allContracts.map((entry) => entry.checkpointHash)).size !== allContracts.length) {
    throw new TypeError('X Shadow cohort contract and checkpoint identities must be unique');
  }
  const historicalFamilies = new Set(historical.map((entry) => entry.familyHash));
  if (prospective.some((entry) => historicalFamilies.has(entry.familyHash))) {
    throw new TypeError('X Shadow historical and prospective protein families must be disjoint');
  }
  const metrics = (Array.isArray(input.metrics) ? input.metrics : []).map(normalizeMetricDefinition);
  const requiredRoles = Object.keys(SCIENTIFIC_POLICY_EVALUATION_METRICS).sort(compare);
  if (!sameJson(metrics.map((metric) => metric.role).sort(compare), requiredRoles)
    || new Set(metrics.map((metric) => metric.metricId)).size !== metrics.length
    || metrics.some((metric) => !Number.isFinite(metric.promotionThreshold))) {
    throw new TypeError('X Shadow cohort must freeze the complete distinct promotion metric vector');
  }
  const evaluator = {
    ...normalizeAuthorityIdentity(input.evaluator, 'X evaluator', 'x'),
    methodId: requiredText(input.evaluator?.methodId, 'X evaluator methodId', 240),
    version: requiredText(input.evaluator?.version, 'X evaluator version', 120),
    artifactHash: requiredHash(input.evaluator?.artifactHash, 'X evaluator artifactHash'),
    blinded: input.evaluator?.blinded === true,
    candidateEditable: false
  };
  if (!evaluator.blinded) throw new TypeError('X evaluator must be blinded to committed outcomes at freeze');
  if (evaluator.identityRootId === input.candidate?.proposer?.identityRootId) {
    throw new TypeError('Zero candidate proposer and X evaluator must be independent');
  }
  const frozenAt = requiredText(input.frozenAt, 'X Shadow frozenAt', 64);
  if (!Number.isFinite(Date.parse(frozenAt))
    || allContracts.some((entry) => Date.parse(entry.evidenceCutoff) > Date.parse(frozenAt))) {
    throw new TypeError('X Shadow evidence cutoffs must not follow the freeze');
  }
  return {
    schema: X_SCIENTIFIC_POLICY_SHADOW_COHORT_VERSION,
    state: 'frozen_shadow',
    candidateHash: requiredHash(input.candidate?.candidateHash, 'X Shadow candidateHash'),
    candidateRevisionHash: requiredHash(input.candidate?.change?.revisionHash, 'X Shadow candidate revisionHash'),
    baseline: normalizeBaseline(input.baseline),
    historicalContracts: historical,
    prospectiveContracts: prospective,
    evaluator,
    metrics,
    pairedEvaluation: {
      sameContracts: true,
      sameInputOrder: true,
      sameEvidenceCutoff: true,
      sameResourceBudget: true,
      sameFailureAndTimeoutPolicy: true,
      sameRandomSeedsWhereApplicable: true
    },
    activationAuthority: 'none',
    frozenAt
  };
};

export async function freezeScientificPolicyShadowCohort(input = {}) {
  const candidateValidation = await validateZeroScientificPolicyCandidate(input.candidate);
  if (!candidateValidation.ok) throw new TypeError(candidateValidation.reasons.join('; '));
  const normalized = normalizeShadowCohort(input);
  return Object.freeze({ ...normalized, cohortHash: await hashJson(normalized) });
}

export async function validateScientificPolicyShadowCohort(cohort = {}, candidate = {}) {
  const reasons = [];
  try {
    const { cohortHash, ...input } = cohort;
    const normalized = normalizeShadowCohort({ ...input, candidate });
    if (!sameJson(normalized, input)) reasons.push('X scientific-policy Shadow cohort is not canonical');
    if (await hashJson(normalized) !== cohortHash) reasons.push('X scientific-policy Shadow cohortHash mismatch');
  } catch (error) {
    reasons.push(error.message);
  }
  return { ok: reasons.length === 0, reasons };
}

const normalizeMetricResult = (result = {}, definition = {}, contractCount) => {
  const baselineValue = Number(result.baselineValue);
  const candidateValue = Number(result.candidateValue);
  const lower = Number(result.effectInterval?.lower);
  const upper = Number(result.effectInterval?.upper);
  if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)
    || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    throw new TypeError(`Shadow evaluation metric ${definition.metricId} values or interval are invalid`);
  }
  const pairedSampleCount = positiveInteger(
    result.pairedSampleCount,
    `Shadow evaluation metric ${definition.metricId} pairedSampleCount`
  );
  if (pairedSampleCount !== contractCount || pairedSampleCount < definition.minimumSampleSize) {
    throw new TypeError(`Shadow evaluation metric ${definition.metricId} lacks the frozen paired sample count`);
  }
  const orientedEffect = definition.direction === 'higher_is_better'
    ? candidateValue - baselineValue
    : baselineValue - candidateValue;
  return {
    role: definition.role,
    metricId: definition.metricId,
    direction: definition.direction,
    baselineValue,
    candidateValue,
    orientedEffect,
    effectInterval: { lower, upper },
    pairedSampleCount,
    promotionThreshold: definition.promotionThreshold,
    passed: lower >= definition.promotionThreshold
  };
};

const normalizePairedObservation = (observation = {}, index, contractIds) => {
  const contractId = requiredText(observation.contractId, `Shadow observation ${index + 1} contractId`, 240);
  if (!contractIds.has(contractId)) throw new TypeError(`Shadow observation ${index + 1} is outside the frozen cohort`);
  const conclusionHash = requiredHash(observation.baseline?.conclusionHash, `Shadow observation ${index + 1} baseline conclusionHash`);
  if (requiredHash(observation.candidate?.conclusionHash, `Shadow observation ${index + 1} candidate conclusionHash`) !== conclusionHash) {
    throw new TypeError(`Shadow observation ${index + 1} does not reach the same declared conclusion`);
  }
  const normalizeSide = (side, label) => ({
    conclusionHash,
    actionCount: positiveInteger(side?.actionCount, `Shadow observation ${index + 1} ${label} actionCount`),
    costVectorHash: requiredHash(side?.costVectorHash, `Shadow observation ${index + 1} ${label} costVectorHash`),
    failureDetectionHash: requiredHash(side?.failureDetectionHash, `Shadow observation ${index + 1} ${label} failureDetectionHash`),
    replicationEvidenceHash: requiredHash(side?.replicationEvidenceHash, `Shadow observation ${index + 1} ${label} replicationEvidenceHash`),
    safetyEvidenceHash: requiredHash(side?.safetyEvidenceHash, `Shadow observation ${index + 1} ${label} safetyEvidenceHash`),
    rollbackEvidenceHash: requiredHash(side?.rollbackEvidenceHash, `Shadow observation ${index + 1} ${label} rollbackEvidenceHash`)
  });
  return {
    contractId,
    baseline: normalizeSide(observation.baseline, 'baseline'),
    candidate: normalizeSide(observation.candidate, 'candidate')
  };
};

const normalizeShadowEvaluation = (input = {}) => {
  const cohort = input.cohort || {};
  const contractIds = new Set([
    ...(cohort.historicalContracts || []),
    ...(cohort.prospectiveContracts || [])
  ].map((entry) => entry.contractId));
  const observations = (Array.isArray(input.observations) ? input.observations : [])
    .map((entry, index) => normalizePairedObservation(entry, index, contractIds));
  if (observations.length !== contractIds.size
    || new Set(observations.map((entry) => entry.contractId)).size !== contractIds.size) {
    throw new TypeError('Shadow evaluation requires one paired observation for every frozen contract');
  }
  const definitions = new Map((cohort.metrics || []).map((metric) => [metric.metricId, metric]));
  const suppliedResults = Array.isArray(input.metricResults) ? input.metricResults : [];
  if (suppliedResults.length !== definitions.size
    || new Set(suppliedResults.map((entry) => entry.metricId)).size !== definitions.size) {
    throw new TypeError('Shadow evaluation metric results must match the frozen metric vector');
  }
  const metricResults = suppliedResults.map((result) => {
    const definition = definitions.get(result.metricId);
    if (!definition) throw new TypeError(`Shadow evaluation metric is outside the frozen cohort: ${result.metricId}`);
    return normalizeMetricResult(result, definition, contractIds.size);
  }).sort((left, right) => compare(left.role, right.role));
  const run = {
    runId: requiredText(input.run?.runId, 'Shadow evaluation runId', 240),
    evaluatorArtifactHash: requiredHash(input.run?.evaluatorArtifactHash, 'Shadow evaluatorArtifactHash'),
    inputOrderHash: requiredHash(input.run?.inputOrderHash, 'Shadow inputOrderHash'),
    seedSetHash: requiredHash(input.run?.seedSetHash, 'Shadow seedSetHash'),
    resourceBudgetHash: requiredHash(input.run?.resourceBudgetHash, 'Shadow resourceBudgetHash'),
    failureAndTimeoutPolicyHash: requiredHash(input.run?.failureAndTimeoutPolicyHash, 'Shadow failureAndTimeoutPolicyHash'),
    rawObservationSetHash: requiredHash(input.run?.rawObservationSetHash, 'Shadow rawObservationSetHash')
  };
  if (run.evaluatorArtifactHash !== cohort.evaluator?.artifactHash) {
    throw new TypeError('Shadow evaluation run does not use the frozen independent evaluator');
  }
  const safeguards = {
    safetyRegressionCount: Number(input.safeguards?.safetyRegressionCount),
    safetyReviewHash: requiredHash(input.safeguards?.safetyReviewHash, 'Shadow safetyReviewHash'),
    rollbackExerciseHash: requiredHash(input.safeguards?.rollbackExerciseHash, 'Shadow rollbackExerciseHash'),
    rollbackSuccessful: input.safeguards?.rollbackSuccessful === true,
    revocationExerciseHash: requiredHash(input.safeguards?.revocationExerciseHash, 'Shadow revocationExerciseHash')
  };
  if (!Number.isInteger(safeguards.safetyRegressionCount) || safeguards.safetyRegressionCount < 0) {
    throw new TypeError('Shadow safety regression count must be a non-negative integer');
  }
  const conclusion = metricResults.every((result) => result.passed)
    && safeguards.safetyRegressionCount === 0
    && safeguards.rollbackSuccessful
    ? 'passes'
    : 'fails';
  const evaluatedAt = requiredText(input.evaluatedAt, 'Shadow evaluatedAt', 64);
  if (!Number.isFinite(Date.parse(evaluatedAt)) || Date.parse(evaluatedAt) < Date.parse(cohort.frozenAt || '')) {
    throw new TypeError('Shadow evaluation must follow the frozen cohort');
  }
  return {
    schema: X_SCIENTIFIC_POLICY_SHADOW_EVALUATION_VERSION,
    state: 'evaluated_in_shadow',
    cohortHash: requiredHash(cohort.cohortHash, 'Shadow evaluation cohortHash'),
    candidateHash: requiredHash(input.candidate?.candidateHash, 'Shadow evaluation candidateHash'),
    baselineRevisionHash: requiredHash(cohort.baseline?.revisionHash, 'Shadow evaluation baselineRevisionHash'),
    evaluator: cohort.evaluator,
    run,
    observations,
    metricResults,
    safeguards,
    assessment: {
      conclusion,
      rule: 'all_frozen_metrics_pass_with_zero_safety_regressions_and_successful_rollback'
    },
    promotionAuthority: 'none',
    evaluatedAt
  };
};

export async function buildScientificPolicyShadowEvaluation(input = {}) {
  const candidateValidation = await validateZeroScientificPolicyCandidate(input.candidate);
  const cohortValidation = await validateScientificPolicyShadowCohort(input.cohort, input.candidate);
  if (!candidateValidation.ok || !cohortValidation.ok) {
    throw new TypeError([...candidateValidation.reasons, ...cohortValidation.reasons].join('; '));
  }
  const normalized = normalizeShadowEvaluation(input);
  return Object.freeze({ ...normalized, evaluationHash: await hashJson(normalized) });
}

export async function validateScientificPolicyShadowEvaluation(evaluation = {}, cohort = {}, candidate = {}) {
  const reasons = [];
  try {
    const { evaluationHash, ...input } = evaluation;
    const normalized = normalizeShadowEvaluation({ ...input, cohort, candidate });
    if (!sameJson(normalized, input)) reasons.push('X scientific-policy Shadow evaluation is not canonical');
    if (await hashJson(normalized) !== evaluationHash) reasons.push('X scientific-policy Shadow evaluationHash mismatch');
  } catch (error) {
    reasons.push(error.message);
  }
  return { ok: reasons.length === 0, reasons };
}

const allDistinct = (values) => new Set(values).size === values.length;

const normalizePromotionDecision = (input = {}) => {
  const candidate = input.candidate || {};
  const cohort = input.cohort || {};
  const evaluation = input.evaluation || {};
  const approver = normalizeAuthorityIdentity(input.approver, 'Human promotion approver', 'human');
  const pooldayOwner = normalizeAuthorityIdentity(input.pooldayOwner, 'Poolday policy owner', 'poolday');
  const authorityRoots = [
    candidate.proposer?.identityRootId,
    cohort.evaluator?.identityRootId,
    approver.identityRootId,
    pooldayOwner.identityRootId
  ];
  if (!authorityRoots.every(Boolean) || !allDistinct(authorityRoots)) {
    throw new TypeError('candidate, evaluator, approver, and Poolday policy-owner identities must be distinct');
  }
  if (evaluation.assessment?.conclusion !== 'passes') {
    throw new TypeError('scientific-policy promotion requires a passing frozen Shadow evaluation');
  }
  const humanApproval = {
    decision: text(input.humanApproval?.decision, 80).toLowerCase(),
    evidenceHash: requiredHash(input.humanApproval?.evidenceHash, 'human promotion evidenceHash'),
    approvedCandidateHash: requiredHash(input.humanApproval?.approvedCandidateHash, 'human approvedCandidateHash')
  };
  if (humanApproval.decision !== 'approved' || humanApproval.approvedCandidateHash !== candidate.candidateHash) {
    throw new TypeError('human approval must bind the exact Zero candidate');
  }
  const pooldayAdmission = {
    policyId: requiredText(input.pooldayAdmission?.policyId, 'Poolday admitted policyId', 240),
    version: requiredText(input.pooldayAdmission?.version, 'Poolday admitted policy version', 120),
    configurationHash: requiredHash(input.pooldayAdmission?.configurationHash, 'Poolday configurationHash'),
    policyRegistryHash: requiredHash(input.pooldayAdmission?.policyRegistryHash, 'Poolday policyRegistryHash'),
    userContractHash: requiredHash(input.pooldayAdmission?.userContractHash, 'Poolday userContractHash')
  };
  const prospectiveCheckpointHashes = unique(input.operationalProof?.prospectiveCheckpointHashes).sort(compare);
  const frozenProspectiveHashes = (cohort.prospectiveContracts || []).map((entry) => entry.checkpointHash).sort(compare);
  const operationalProof = {
    status: text(input.operationalProof?.status, 80).toLowerCase(),
    evidenceHash: requiredHash(input.operationalProof?.evidenceHash, 'prospective operational evidenceHash'),
    prospectiveCheckpointHashes,
    reviewedOutcomeSetHash: requiredHash(input.operationalProof?.reviewedOutcomeSetHash, 'prospective reviewedOutcomeSetHash')
  };
  if (operationalProof.status !== 'passes' || !sameJson(prospectiveCheckpointHashes, frozenProspectiveHashes)) {
    throw new TypeError('Poolday activation requires passing prospective proof on every frozen prospective contract');
  }
  const safeguards = {
    safetyReviewHash: requiredHash(input.safeguards?.safetyReviewHash, 'promotion safetyReviewHash'),
    revocationPlanHash: requiredHash(input.safeguards?.revocationPlanHash, 'promotion revocationPlanHash'),
    rollbackArtifactHash: requiredHash(input.safeguards?.rollbackArtifactHash, 'promotion rollbackArtifactHash'),
    rollbackTestHash: requiredHash(input.safeguards?.rollbackTestHash, 'promotion rollbackTestHash')
  };
  return {
    schema: POOLDAY_SCIENTIFIC_POLICY_PROMOTION_VERSION,
    state: 'promotion_eligible_not_activated',
    candidateHash: candidate.candidateHash,
    cohortHash: cohort.cohortHash,
    evaluationHash: evaluation.evaluationHash,
    approver,
    pooldayOwner,
    humanApproval,
    pooldayAdmission,
    operationalProof,
    safeguards,
    activationAuthority: 'poolday_configuration_owner_only',
    decidedAt: requiredText(input.decidedAt, 'promotion decidedAt', 64)
  };
};

export async function buildPooldayScientificPolicyPromotionDecision(input = {}) {
  const candidateValidation = await validateZeroScientificPolicyCandidate(input.candidate);
  const cohortValidation = await validateScientificPolicyShadowCohort(input.cohort, input.candidate);
  const evaluationValidation = await validateScientificPolicyShadowEvaluation(input.evaluation, input.cohort, input.candidate);
  if (!candidateValidation.ok || !cohortValidation.ok || !evaluationValidation.ok) {
    throw new TypeError([
      ...candidateValidation.reasons,
      ...cohortValidation.reasons,
      ...evaluationValidation.reasons
    ].join('; '));
  }
  const normalized = normalizePromotionDecision(input);
  if (!Number.isFinite(Date.parse(normalized.decidedAt))
    || Date.parse(normalized.decidedAt) < Date.parse(input.evaluation.evaluatedAt || '')) {
    throw new TypeError('promotion decision must follow the Shadow evaluation');
  }
  return Object.freeze({ ...normalized, promotionHash: await hashJson(normalized) });
}

export async function validatePooldayScientificPolicyActivation({
  promotionDecision = {},
  activeConfiguration = {}
} = {}) {
  const reasons = [];
  if (promotionDecision.schema !== POOLDAY_SCIENTIFIC_POLICY_PROMOTION_VERSION
    || promotionDecision.state !== 'promotion_eligible_not_activated') {
    reasons.push('active policy lacks an eligible scientific-policy promotion decision');
  }
  if (activeConfiguration.ownerIdentityRootId !== promotionDecision.pooldayOwner?.identityRootId) {
    reasons.push('active policy owner does not match the Poolday promotion owner');
  }
  if (activeConfiguration.configurationHash !== promotionDecision.pooldayAdmission?.configurationHash
    || activeConfiguration.policyRegistryHash !== promotionDecision.pooldayAdmission?.policyRegistryHash
    || activeConfiguration.userContractHash !== promotionDecision.pooldayAdmission?.userContractHash
    || activeConfiguration.policyId !== promotionDecision.pooldayAdmission?.policyId
    || activeConfiguration.version !== promotionDecision.pooldayAdmission?.version) {
    reasons.push('active Poolday configuration does not exactly match the promoted policy admission');
  }
  if (!isHash(promotionDecision.promotionHash)) reasons.push('scientific-policy promotionHash is missing');
  return { ok: reasons.length === 0, reasons };
}

export default {
  buildZeroScientificPolicyCandidate,
  validateZeroScientificPolicyCandidate,
  freezeScientificPolicyShadowCohort,
  validateScientificPolicyShadowCohort,
  buildScientificPolicyShadowEvaluation,
  validateScientificPolicyShadowEvaluation,
  buildPooldayScientificPolicyPromotionDecision,
  validatePooldayScientificPolicyActivation
};
