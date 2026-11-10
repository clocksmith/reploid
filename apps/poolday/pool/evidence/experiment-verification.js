/** Field verification for resolution criteria, work orders and claims, outcomes, cohorts, evaluations and realized value. */
import {
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  METRIC_DIRECTIONS,
  OUTCOME_BLIND_STATES,
  RESEARCH_ATTEMPT_STATUSES,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_OUTCOME_CLASSES,
  RESEARCH_RECORD_KINDS,
  RESEARCH_WORK_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  isHashList,
  isSha256
} from './primitives.js';
import {
  normalizeExperimentalExecutionContext,
  normalizeLaboratoryCapabilityClaim,
  normalizeResearchResolutionPolicy,
  normalizeResearchWorkOrderContract
} from './laboratory-normalization.js';
import {
  checkCanonical,
  verifyAnalysisEvidence,
  verifyProtocolEvidence
} from './verification-checks.js';
import {
  REALIZED_ACTION_VALUE_VERSION,
  normalizeRealizedActionValue
} from '../realized-action-value.js';

const verifyResolutionPolicyFields = async (record, reasons) => {
  if (!isSha256(record.questionHash)) {
    reasons.push('resolution policy questionHash is invalid');
  }
  const normalizedPolicy = await checkCanonical(reasons, 'research resolution policy', record.policy,
    () => normalizeResearchResolutionPolicy(record.policy));
  if (normalizedPolicy && record.createdAt !== record.policy?.frozenAt) {
    reasons.push('resolution policy creation and freeze timestamps do not match');
  }
};

const verifyWorkOrderFields = async (record, reasons) => {
  if (!isSha256(record.questionHash)) reasons.push('work order questionHash is invalid');
  if (!isHashList(record.hypothesisHashes, { min: 1 })) reasons.push('work order hypothesis hashes are invalid');
  if (!RESEARCH_WORK_KINDS.includes(record.work?.kind) || record.work?.status !== 'proposed' || !record.work?.title) {
    reasons.push('work order identity is invalid');
  }
  if (!Number.isInteger(record.work?.replicaTarget) || record.work.replicaTarget < 1 || record.work.replicaTarget > 100) {
    reasons.push('work order replicaTarget is invalid');
  }
  if (record.work?.blindness?.required !== false && !isSha256(record.work?.blindness?.allocationHash)) {
    reasons.push('work order blinded allocation identity is invalid');
  }
  await verifyProtocolEvidence(record.work?.protocol, reasons, 'work order protocol');
  if (record.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
    await checkCanonical(reasons, 'research work order contract', record.work, () => normalizeResearchWorkOrderContract({
      workKind: record.work.kind,
      title: record.work.title,
      protocol: record.work.protocol,
      replicaTarget: record.work.replicaTarget,
      blindness: record.work.blindness,
      feasibility: record.work.feasibility,
      analysis: record.work.plannedAnalysis,
      failureCategories: record.work.allowedFailureCategories,
      custody: record.work.custody,
      publication: record.work.publication,
      replication: record.work.replication,
      scopeBoundary: record.work.scopeBoundary
    }));
  }
};

const verifyWorkClaimFields = async (record, reasons) => {
  if (!isSha256(record.workOrderHash)) reasons.push('work claim workOrderHash is invalid');
  if (record.workClaim?.status !== 'claimed' || !record.workClaim?.laboratory?.id || !record.workClaim?.laboratory?.name) {
    reasons.push('work claim laboratory identity is incomplete');
  }
  if (!Array.isArray(record.workClaim?.capabilities) || record.workClaim.capabilities.length === 0) reasons.push('work claim capabilities are required');
  if (record.workClaim?.consent?.publicLaboratoryIdentity !== true || record.workClaim?.consent?.publishOutcome !== true) {
    reasons.push('work claim publication consent is invalid');
  }
  if (record.workClaim?.schema === LABORATORY_CAPABILITY_CLAIM_VERSION) {
    await checkCanonical(reasons, 'laboratory capability claim', record.workClaim, () => normalizeLaboratoryCapabilityClaim({
      laboratory: record.workClaim.laboratory,
      capabilityClaims: record.workClaim.capabilityClaims,
      protocolCustody: record.workClaim.protocolCustody,
      safety: record.workClaim.safety,
      availability: record.workClaim.availability,
      consent: record.workClaim.consent,
      conflictDisclosure: record.workClaim.conflictDisclosure,
      createdAt: record.createdAt
    }));
  }
};

const verifyOutcomeFields = async (record, reasons) => {
  for (const hash of [record.questionHash, record.workOrderHash, record.workClaimHash, ...(record.hypothesisHashes || [])]) {
    if (!isSha256(hash)) reasons.push('outcome linked record hash is invalid');
  }
  if (record.replicationOfHash && !SHA256_PATTERN.test(record.replicationOfHash)) reasons.push('outcome replication identity is invalid');
  if (!RESEARCH_OUTCOME_CLASSES.includes(record.outcome?.classification)) reasons.push('outcome classification is invalid');
  if (!record.outcome?.summary || !RESEARCH_ATTEMPT_STATUSES.includes(record.outcome?.attempt?.status)
    || !RESEARCH_FAILURE_CATEGORIES.includes(record.outcome?.attempt?.failureCategory)) reasons.push('outcome attempt is invalid');
  if (record.outcome?.attempt?.status === 'failed' && record.outcome?.attempt?.failureCategory === 'none') reasons.push('failed outcome attempt lacks a failure category');
  if (!Array.isArray(record.outcome?.observations) || record.outcome.observations.length === 0
    || record.outcome.observations.some((entry) => !entry.readout || !Number.isFinite(entry.value) || !Number.isFinite(entry.normalizedValue))) {
    reasons.push('outcome observations are invalid');
  }
  if (!OUTCOME_BLIND_STATES.includes(record.outcome?.blind?.state)
    || !isSha256(record.outcome?.blind?.codeHash)
    || !isSha256(record.outcome?.blind?.allocationHash)) reasons.push('outcome blinding evidence is invalid');
  if (record.outcome?.blind?.state === 'sealed' && record.outcome?.blind?.revealedAt) reasons.push('sealed outcome includes reveal evidence');
  if (record.outcome?.blind?.state === 'revealed' && !Number.isFinite(Date.parse(record.outcome?.blind?.revealedAt || ''))) reasons.push('revealed outcome timestamp is invalid');
  await verifyProtocolEvidence(record.outcome?.protocol, reasons, 'outcome protocol');
  await verifyAnalysisEvidence(record.outcome?.analysis, reasons, 'outcome analysis');
  if (record.outcome?.executionContext) {
    await checkCanonical(reasons, 'experimental execution context', record.outcome.executionContext,
      () => normalizeExperimentalExecutionContext(record.outcome.executionContext));
  }
};

const verifyCohortFields = async (record, reasons) => {
  if (!record.cohort?.label || record.cohort?.state !== 'frozen' || !Number.isFinite(Date.parse(record.cohort?.frozenAt || ''))) {
    reasons.push('frozen cohort identity is invalid');
  }
  for (const values of [record.cohort?.questionHashes, record.cohort?.predictionHashes, record.cohort?.workOrderHashes]) {
    if (!isHashList(values, { min: 1 })) reasons.push('cohort linked record hashes are invalid');
  }
  if (!Array.isArray(record.cohort?.metrics) || record.cohort.metrics.length === 0
    || record.cohort.metrics.some((metric) => !metric.id || !metric.label || !METRIC_DIRECTIONS.includes(metric.direction))) {
    reasons.push('cohort metric definitions are invalid');
  }
};

const verifyEvaluationFields = async (record, reasons) => {
  if (!isSha256(record.cohortHash)) reasons.push('evaluation cohortHash is invalid');
  if (!isHashList(record.evaluation?.outcomeHashes, { min: 1 })) reasons.push('evaluation outcome hashes are invalid');
  if (!Array.isArray(record.evaluation?.metricResults) || record.evaluation.metricResults.length === 0
    || record.evaluation.metricResults.some((metric) => !metric.metricId || !Number.isFinite(metric.baselineValue)
      || !Number.isFinite(metric.currentValue) || !Number.isFinite(metric.absoluteDelta) || typeof metric.improved !== 'boolean')) {
    reasons.push('evaluation metric results are invalid');
  }
  if (!record.evaluation?.disagreementSummary || !record.evaluation?.failureAnalysis
    || record.evaluation?.acceptedOutcomePolicy !== 'independent_review_required') reasons.push('evaluation evidence policy is incomplete');
};

const verifyRealizedActionValueFields = async (record, reasons) => {
  if (record.realizedValue?.schema !== REALIZED_ACTION_VALUE_VERSION) reasons.push('realized action-value schema is invalid');
  const normalizedValue = await checkCanonical(reasons, 'realized action-value contract', record.realizedValue,
    () => normalizeRealizedActionValue(record.realizedValue));
  if (normalizedValue && record.questionHash !== normalizedValue.questionHash) {
    reasons.push('realized action-value question identity mismatch');
  }
};

export const experimentRecordVerifiers = Object.freeze([
  [RESEARCH_RECORD_KINDS.resolutionPolicy, verifyResolutionPolicyFields],
  [RESEARCH_RECORD_KINDS.workOrder, verifyWorkOrderFields],
  [RESEARCH_RECORD_KINDS.workClaim, verifyWorkClaimFields],
  [RESEARCH_RECORD_KINDS.outcome, verifyOutcomeFields],
  [RESEARCH_RECORD_KINDS.cohort, verifyCohortFields],
  [RESEARCH_RECORD_KINDS.evaluation, verifyEvaluationFields],
  [RESEARCH_RECORD_KINDS.realizedActionValue, verifyRealizedActionValueFields]
]);
