/** Signed resolution criteria, work orders and claims, outcomes, cohorts, evaluations and realized value. */
import {
  METRIC_DIRECTIONS,
  OUTCOME_BLIND_STATES,
  RESEARCH_ATTEMPT_STATUSES,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_OUTCOME_CLASSES,
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  compactText,
  normalizeHashList,
  requireHash
} from './primitives.js';
import {
  normalizeAnalysisIdentity,
  normalizeAssayProtocol,
  normalizeUncertainty
} from './scientific-normalization.js';
import {
  normalizeExperimentalExecutionContext,
  normalizeLaboratoryCapabilityClaim,
  normalizeResearchResolutionPolicy,
  normalizeResearchWorkOrderContract
} from './laboratory-normalization.js';
import {
  createAuthor,
  signResearchRecord
} from './record-signing.js';
import {
  normalizeRealizedActionValue
} from '../realized-action-value.js';

export async function createSignedResearchResolutionPolicy({
  identity,
  roomId,
  questionHash,
  targetHypothesisHash,
  conclusionLabel,
  decisionScope,
  provisionalAcceptance,
  continuedUncertainty,
  rejection,
  reopening,
  closure,
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.resolutionPolicy);
  const policy = await normalizeResearchResolutionPolicy({
    targetHypothesisHash,
    conclusionLabel,
    decisionScope,
    provisionalAcceptance,
    continuedUncertainty,
    rejection,
    reopening,
    closure,
    frozenAt
  });
  if (createdAt !== frozenAt) throw new TypeError('resolution policy creation must equal its freeze timestamp');
  return signResearchRecord(RESEARCH_RECORD_KINDS.resolutionPolicy, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    policy
  }));
}

export async function createSignedResearchWorkOrder({
  identity,
  roomId,
  questionHash,
  hypothesisHashes,
  workKind = 'experimental_assay',
  title,
  protocol,
  replicaTarget = 1,
  blindness = {},
  feasibility = {},
  analysis,
  failureCategories,
  custody,
  publication,
  replication,
  scopeBoundary,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.workOrder);
  const work = await normalizeResearchWorkOrderContract({
    workKind,
    title,
    protocol,
    replicaTarget,
    blindness,
    feasibility,
    analysis,
    failureCategories,
    custody,
    publication,
    replication,
    scopeBoundary
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.workOrder, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesisHashes: normalizeHashList(hypothesisHashes, 'work order hypotheses', { min: 1, max: 32 }),
    work
  }));
}

export async function createSignedResearchWorkClaim({
  identity,
  roomId,
  workOrderHash,
  laboratory,
  capabilityClaims = [],
  protocolCustody,
  safety,
  availability,
  consent = {},
  conflictDisclosure = '',
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.workClaim);
  const workClaim = await normalizeLaboratoryCapabilityClaim({
    laboratory,
    capabilityClaims,
    protocolCustody,
    safety,
    availability,
    consent,
    conflictDisclosure,
    createdAt
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.workClaim, { roomId, createdAt, author, privateKey }, async () => ({
    workOrderHash: requireHash(workOrderHash, 'workOrderHash'),
    workClaim
  }));
}

export async function createSignedExperimentalOutcome({
  identity,
  roomId,
  questionHash,
  workOrderHash,
  workClaimHash,
  hypothesisHashes,
  classification,
  summary,
  attempt = {},
  observations = [],
  protocol,
  analysis,
  executionContext,
  uncertainty = {},
  blind = {},
  replicationOfHash = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.outcome);
  const normalizedClass = compactText(classification, 40).toLowerCase();
  if (!RESEARCH_OUTCOME_CLASSES.includes(normalizedClass)) throw new TypeError('outcome must be positive, negative, or ambiguous');
  const normalizedSummary = compactText(summary);
  if (!normalizedSummary) throw new TypeError('outcome summary is required');
  const attemptStatus = compactText(attempt.status, 40).toLowerCase();
  const failureCategory = compactText(attempt.failureCategory || 'none', 80).toLowerCase();
  if (!RESEARCH_ATTEMPT_STATUSES.includes(attemptStatus)) throw new TypeError('attempt status must be completed or failed');
  if (!RESEARCH_FAILURE_CATEGORIES.includes(failureCategory)) throw new TypeError('attempt failure category is not supported');
  if (attemptStatus === 'failed' && failureCategory === 'none') throw new TypeError('failed attempts require a failure category');
  if (attemptStatus === 'completed' && failureCategory !== 'none') throw new TypeError('completed attempts must use the none failure category');
  const blindState = compactText(blind.state, 40).toLowerCase();
  const codeHash = compactText(blind.codeHash, 160);
  const allocationHash = compactText(blind.allocationHash, 160);
  if (!OUTCOME_BLIND_STATES.includes(blindState) || !SHA256_PATTERN.test(codeHash) || !SHA256_PATTERN.test(allocationHash)) {
    throw new TypeError('outcome requires sealed or revealed blinding with codeHash and allocationHash');
  }
  const revealedAt = compactText(blind.revealedAt, 64) || null;
  if (blindState === 'sealed' && revealedAt) throw new TypeError('sealed outcomes cannot include revealedAt');
  if (blindState === 'revealed' && !Number.isFinite(Date.parse(revealedAt))) throw new TypeError('revealed outcomes require revealedAt');
  const normalizedObservations = (Array.isArray(observations) ? observations : []).slice(0, 128).map((entry, index) => {
    const readout = compactText(entry.readout, 500);
    if (!readout) throw new TypeError(`observation ${index + 1} requires a readout`);
    const value = Number(entry.value);
    const normalizedValue = Number(entry.normalizedValue);
    if (!Number.isFinite(value) || !Number.isFinite(normalizedValue)) {
      throw new TypeError(`observation ${index + 1} requires numeric raw and normalized values`);
    }
    return {
      readout,
      value,
      unit: compactText(entry.unit, 120),
      normalizedValue,
      normalizedUnit: compactText(entry.normalizedUnit || entry.unit, 120),
      uncertainty: normalizeUncertainty(entry.uncertainty)
    };
  });
  if (normalizedObservations.length === 0) throw new TypeError('at least one experimental observation is required');
  return signResearchRecord(RESEARCH_RECORD_KINDS.outcome, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    workOrderHash: requireHash(workOrderHash, 'workOrderHash'),
    workClaimHash: requireHash(workClaimHash, 'workClaimHash'),
    hypothesisHashes: normalizeHashList(hypothesisHashes, 'outcome hypotheses', { min: 1, max: 32 }),
    replicationOfHash: replicationOfHash ? requireHash(replicationOfHash, 'replicationOfHash') : null,
    outcome: {
      classification: normalizedClass,
      summary: normalizedSummary,
      attempt: {
        status: attemptStatus,
        failureCategory,
        failureDetail: compactText(attempt.failureDetail, 2000),
        startedAt: compactText(attempt.startedAt, 64),
        completedAt: compactText(attempt.completedAt, 64) || createdAt
      },
      observations: normalizedObservations,
      protocol: await normalizeAssayProtocol(protocol),
      analysis: await normalizeAnalysisIdentity(analysis),
      executionContext: normalizeExperimentalExecutionContext(executionContext),
      uncertainty: normalizeUncertainty(uncertainty),
      blind: { state: blindState, codeHash, allocationHash, revealedAt }
    }
  }));
}

export async function createSignedEvaluationCohort({
  identity,
  roomId,
  label,
  questionHashes,
  predictionHashes,
  workOrderHashes,
  metrics,
  frozenAt = new Date().toISOString(),
  blindingRequired = true,
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.cohort);
  const normalizedLabel = compactText(label, 500);
  if (!normalizedLabel) throw new TypeError('cohort label is required');
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('cohort frozenAt must be an ISO timestamp');
  const normalizedMetrics = (Array.isArray(metrics) ? metrics : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const normalized = {
      id: compactText(metric.id, 120),
      label: compactText(metric.label, 500),
      direction,
      unit: compactText(metric.unit, 120)
    };
    if (!normalized.id || !normalized.label || !METRIC_DIRECTIONS.includes(direction)) {
      throw new TypeError(`cohort metric ${index + 1} requires id, label, and direction`);
    }
    return normalized;
  });
  if (normalizedMetrics.length === 0) throw new TypeError('cohort requires at least one metric');
  return signResearchRecord(RESEARCH_RECORD_KINDS.cohort, { roomId, createdAt, author, privateKey }, async () => ({
    cohort: {
      label: normalizedLabel,
      questionHashes: normalizeHashList(questionHashes, 'cohort questions', { min: 1, max: 128 }),
      predictionHashes: normalizeHashList(predictionHashes, 'cohort predictions', { min: 1, max: 512 }),
      workOrderHashes: normalizeHashList(workOrderHashes, 'cohort work orders', { min: 1, max: 256 }),
      metrics: normalizedMetrics,
      frozenAt,
      blindingRequired: blindingRequired !== false,
      state: 'frozen'
    }
  }));
}

export async function createSignedCohortEvaluation({
  identity,
  roomId,
  cohortHash,
  outcomeHashes,
  metricResults,
  disagreementSummary,
  failureAnalysis,
  nextCohortQuestionHashes = [],
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.evaluation);
  const normalizedMetrics = (Array.isArray(metricResults) ? metricResults : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const baselineValue = Number(metric.baselineValue);
    const currentValue = Number(metric.currentValue);
    if (!compactText(metric.metricId, 120) || !METRIC_DIRECTIONS.includes(direction)
      || !Number.isFinite(baselineValue) || !Number.isFinite(currentValue)) {
      throw new TypeError(`evaluation metric ${index + 1} is invalid`);
    }
    const absoluteDelta = currentValue - baselineValue;
    return {
      metricId: compactText(metric.metricId, 120),
      direction,
      baselineValue,
      currentValue,
      absoluteDelta,
      relativeDelta: baselineValue === 0 ? null : absoluteDelta / Math.abs(baselineValue),
      improved: direction === 'higher_is_better' ? currentValue > baselineValue : currentValue < baselineValue
    };
  });
  if (normalizedMetrics.length === 0) throw new TypeError('evaluation requires at least one measured metric');
  const disagreement = compactText(disagreementSummary, 4000);
  const failures = compactText(failureAnalysis, 4000);
  if (!disagreement || !failures) throw new TypeError('evaluation requires disagreement summary and failure analysis');
  return signResearchRecord(RESEARCH_RECORD_KINDS.evaluation, { roomId, createdAt, author, privateKey }, async () => ({
    cohortHash: requireHash(cohortHash, 'cohortHash'),
    evaluation: {
      outcomeHashes: normalizeHashList(outcomeHashes, 'evaluation outcomes', { min: 1, max: 512 }),
      metricResults: normalizedMetrics,
      disagreementSummary: disagreement,
      failureAnalysis: failures,
      nextCohortQuestionHashes: normalizeHashList(nextCohortQuestionHashes, 'next cohort questions', { max: 128 }),
      acceptedOutcomePolicy: 'independent_review_required'
    }
  }));
}

export async function createSignedRealizedActionValue({
  identity,
  roomId,
  questionHash,
  candidateActionHash,
  actionContractHash,
  candidateActionApprovalHashes,
  evaluationHash,
  evaluationReviewDecisionHashes,
  reviewedOutcomes,
  contributions,
  metricResults,
  decisionEffect,
  summary,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.realizedActionValue);
  const realizedValue = await normalizeRealizedActionValue({
    questionHash,
    candidateActionHash,
    actionContractHash,
    candidateActionApprovalHashes,
    evaluationHash,
    evaluationReviewDecisionHashes,
    reviewedOutcomes,
    contributions,
    metricResults,
    decisionEffect,
    summary
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.realizedActionValue, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: realizedValue.questionHash,
    realizedValue
  }));
}
