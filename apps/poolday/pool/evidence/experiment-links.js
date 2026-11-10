/** Link validation for work orders and claims, outcomes and replications, cohorts, evaluations and realized action value. */
import {
  EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  RESEARCH_RECORD_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION
} from '../evidence-record-contract.js';
import {
  sameJson,
  sameStringSet
} from './primitives.js';
import {
  independentlyAccepted,
  projectResearchReviewStates
} from './review-state.js';

/** The executed analysis identity an outcome must share with its accepted work order. */
const analysisExecutionIdentity = (analysis) => {
  const { methodId, version, artifactHash, parametersHash, runtimeIdentity } = analysis || {};
  return { methodId, version, artifactHash, parametersHash, runtimeIdentity };
};

const realizedContributionRole = (record, candidateHash, evaluationHash) => {
  if (record?.recordHash === candidateHash) return 'action_proposal';
  if (record?.recordHash === evaluationHash
    || [RESEARCH_RECORD_KINDS.evaluation, RESEARCH_RECORD_KINDS.adjudicationEvaluation].includes(record?.kind)) {
    return 'evaluation';
  }
  if (record?.kind === RESEARCH_RECORD_KINDS.outcome) return 'outcome_execution';
  if (record?.kind === RESEARCH_RECORD_KINDS.claim
    && ['review_decision', 'candidate_action_approval'].includes(record.claim?.kind)) return 'independent_review';
  if ([
    RESEARCH_RECORD_KINDS.submission,
    RESEARCH_RECORD_KINDS.hypothesis,
    RESEARCH_RECORD_KINDS.priorEvidence,
    RESEARCH_RECORD_KINDS.prediction,
    RESEARCH_RECORD_KINDS.workOrder,
    RESEARCH_RECORD_KINDS.workClaim,
    RESEARCH_RECORD_KINDS.cohort
  ].includes(record?.kind)) return 'evidence_input';
  return null;
};

const realizedContributionCandidates = (value, recordsByHash) => {
  const hashes = new Set([
    value.questionHash,
    value.candidateActionHash,
    value.evaluationHash
  ]);
  for (const hash of value.evaluationReviewDecisionHashes || []) hashes.add(hash);
  const candidate = recordsByHash.get(value.candidateActionHash);
  for (const hash of value.candidateActionApprovalHashes || []) hashes.add(hash);
  for (const hash of candidate?.action?.affectedHypothesisHashes || []) {
    hashes.add(hash);
    const hypothesis = recordsByHash.get(hash);
    for (const priorHash of hypothesis?.hypothesis?.priorEvidenceHashes || []) hashes.add(priorHash);
  }
  for (const hash of candidate?.action?.expectedValue?.calibrationEvidenceHashes || []) hashes.add(hash);
  const evaluation = recordsByHash.get(value.evaluationHash);
  hashes.add(evaluation?.cohortHash);
  const cohort = recordsByHash.get(evaluation?.cohortHash);
  for (const hash of [
    ...(cohort?.cohort?.predictionHashes || []),
    ...(cohort?.cohort?.workOrderHashes || [])
  ]) hashes.add(hash);
  for (const reviewed of value.reviewedOutcomes || []) {
    hashes.add(reviewed.outcomeHash);
    for (const reviewHash of reviewed.reviewDecisionHashes || []) hashes.add(reviewHash);
    const outcome = recordsByHash.get(reviewed.outcomeHash);
    for (const hash of [
      outcome?.workOrderHash,
      outcome?.workClaimHash,
      outcome?.replicationOfHash,
      ...(outcome?.hypothesisHashes || [])
    ]) hashes.add(hash);
  }
  return new Set([...hashes].filter(Boolean));
};

const linkWorkOrder = (record, reasons, { target }) => {
  if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('work order must target a research question submission');
  for (const hash of record.hypothesisHashes || []) {
    const hypothesis = target(hash);
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push(`work order hypothesis does not belong to its question: ${hash}`);
    }
  }
};

const linkWorkClaim = (record, reasons, { records, target }) => {
  const order = target(record.workOrderHash);
  if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder) reasons.push('work claim must target a work order');
  else {
    if (!independentlyAccepted(records, order)) reasons.push('work order requires independent acceptance before laboratory claiming');
    if (record.workClaim?.schema === LABORATORY_CAPABILITY_CLAIM_VERSION) {
      const acceptedResolutionPolicies = records.filter((entry) => (
        entry.kind === RESEARCH_RECORD_KINDS.resolutionPolicy
        && entry.questionHash === order.questionHash
        && Date.parse(entry.createdAt || '') <= Date.parse(order.createdAt || '')
        && independentlyAccepted(records, entry)
      ));
      if (!acceptedResolutionPolicies.length) {
        reasons.push('qualified laboratory claims require an independently accepted pre-work-order resolution policy');
      }
      if (order.work?.schema !== RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
        reasons.push('qualified laboratory claims require a current governed work order contract');
      }
      if (record.workClaim.protocolCustody?.protocolHash !== order.work?.protocol?.protocolHash) {
        reasons.push('laboratory protocol custody does not match the accepted work order');
      }
      if (!order.work?.custody?.requiredRoles?.includes(record.workClaim.protocolCustody?.role)) {
        reasons.push('laboratory protocol custody role is outside the accepted work order');
      }
      if (record.workClaim?.safety?.classification !== order.work?.scopeBoundary?.protocolSafetyClassification) {
        reasons.push('laboratory safety classification does not match the accepted public non-clinical work order scope');
      }
      if (record.workClaim?.consent?.publishQualification !== order.work?.publication?.publishQualification
        || record.workClaim?.consent?.publishOutcome !== order.work?.publication?.publishRawObservations
        || record.workClaim?.consent?.publicLaboratoryIdentity !== order.work?.publication?.publishLaboratoryIdentity) {
        reasons.push('laboratory publication consent does not match the accepted work order scope');
      }
    }
  }
};

const linkOutcome = (record, reasons, { target }) => {
  const order = target(record.workOrderHash);
  const claim = target(record.workClaimHash);
  if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder || claim?.kind !== RESEARCH_RECORD_KINDS.workClaim) {
    reasons.push('outcome requires a work order and laboratory work claim');
  } else {
    if (claim.workOrderHash !== order.recordHash) reasons.push('outcome work claim does not belong to its work order');
    if (claim.author?.identityRootId !== record.author?.identityRootId) reasons.push('outcome author does not own its laboratory work claim');
    if (order.questionHash !== record.questionHash) reasons.push('outcome question does not match its work order');
    if (order.work?.protocol?.protocolHash !== record.outcome?.protocol?.protocolHash) reasons.push('outcome protocol does not match its accepted work order');
    if (order.work?.blindness?.allocationHash !== record.outcome?.blind?.allocationHash) reasons.push('outcome blind allocation does not match its work order');
    if (order.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
      if (record.outcome?.executionContext?.schema !== EXPERIMENTAL_EXECUTION_CONTEXT_VERSION) {
        reasons.push('current work order outcomes require a signed execution context');
      }
      if (record.outcome?.executionContext?.institutionIdentityHash !== claim.workClaim?.laboratory?.institutionIdentityHash) {
        reasons.push('outcome institution identity does not match its laboratory claim');
      }
      if (!sameJson(analysisExecutionIdentity(order.work.plannedAnalysis), analysisExecutionIdentity(record.outcome?.analysis))) {
        reasons.push('outcome analysis does not match its accepted work order');
      }
      if (record.outcome?.attempt?.status === 'failed'
        && !order.work.allowedFailureCategories?.includes(record.outcome?.attempt?.failureCategory)) {
        reasons.push('outcome failure category is outside its accepted work order');
      }
    }
    for (const hash of record.hypothesisHashes || []) {
      if (!order.hypothesisHashes.includes(hash)) reasons.push(`outcome hypothesis is outside its work order: ${hash}`);
    }
  }
  if (record.replicationOfHash) {
    const original = target(record.replicationOfHash);
    if (original?.kind !== RESEARCH_RECORD_KINDS.outcome) reasons.push('replication must target an experimental outcome');
    else if (order?.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
      const originalClaim = target(original.workClaimHash);
      if (original.questionHash !== record.questionHash) reasons.push('replication must target an outcome for the same question');
      if (original.outcome?.protocol?.protocolHash !== record.outcome?.protocol?.protocolHash) {
        reasons.push('replication must use the same exact protocol');
      }
      const dimensionValues = {
        operator_identity: [original.author?.identityRootId, record.author?.identityRootId],
        institution: [originalClaim?.workClaim?.laboratory?.institutionIdentityHash, claim?.workClaim?.laboratory?.institutionIdentityHash],
        instrument: [original.outcome?.executionContext?.instrumentIdentityHash, record.outcome?.executionContext?.instrumentIdentityHash],
        sample_batch: [original.outcome?.executionContext?.sampleBatchHash, record.outcome?.executionContext?.sampleBatchHash],
        preparation_batch: [original.outcome?.executionContext?.preparationBatchHash, record.outcome?.executionContext?.preparationBatchHash],
        analysis_execution: [original.outcome?.executionContext?.analysisExecutionHash, record.outcome?.executionContext?.analysisExecutionHash]
      };
      for (const dimension of order.work.replication?.requiredIndependentDimensions || []) {
        const [originalValue, replicaValue] = dimensionValues[dimension] || [];
        if (!originalValue || !replicaValue) reasons.push(`replication independence dimension is missing: ${dimension}`);
        else if (originalValue === replicaValue) reasons.push(`replication is not independent across declared dimension: ${dimension}`);
      }
    } else if (original.author?.identityRootId === record.author?.identityRootId) {
      reasons.push('legacy replication must be independently authored');
    }
  }
};

const linkCohort = (record, reasons, { records, target }) => {
  const frozenAt = Date.parse(record.cohort?.frozenAt || '');
  for (const hash of record.cohort?.questionHashes || []) {
    if (target(hash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push(`cohort question kind mismatch: ${hash}`);
  }
  for (const hash of record.cohort?.predictionHashes || []) {
    const prediction = target(hash);
    if (prediction?.kind !== RESEARCH_RECORD_KINDS.prediction) reasons.push(`cohort prediction kind mismatch: ${hash}`);
    else {
      if (!record.cohort.questionHashes.includes(prediction.questionHash)) reasons.push(`cohort prediction belongs to an excluded question: ${hash}`);
      if (Date.parse(prediction.prediction?.frozenAt || prediction.createdAt) > frozenAt) reasons.push(`cohort prediction was not frozen before cohort activation: ${hash}`);
      if (!independentlyAccepted(records, prediction)) reasons.push(`cohort prediction lacks independent acceptance: ${hash}`);
    }
  }
  for (const hash of record.cohort?.workOrderHashes || []) {
    const order = target(hash);
    if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder) reasons.push(`cohort work order kind mismatch: ${hash}`);
    else {
      if (!record.cohort.questionHashes.includes(order.questionHash)) reasons.push(`cohort work order belongs to an excluded question: ${hash}`);
      if (!independentlyAccepted(records, order)) reasons.push(`cohort work order lacks independent acceptance: ${hash}`);
    }
  }
};

const linkEvaluation = (record, reasons, { records, target }) => {
  const cohort = target(record.cohortHash);
  if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort) reasons.push('evaluation must target a frozen cohort');
  else if (!independentlyAccepted(records, cohort)) reasons.push('evaluation cohort requires independent acceptance');
  for (const hash of record.evaluation?.outcomeHashes || []) {
    const outcome = target(hash);
    if (outcome?.kind !== RESEARCH_RECORD_KINDS.outcome) reasons.push(`evaluation outcome kind mismatch: ${hash}`);
    else if (cohort) {
      if (!cohort.cohort.workOrderHashes.includes(outcome.workOrderHash)) reasons.push(`evaluation outcome is outside the frozen cohort: ${hash}`);
      if (Date.parse(outcome.createdAt) < Date.parse(cohort.cohort.frozenAt)) reasons.push(`evaluation outcome predates the frozen cohort: ${hash}`);
      if (!independentlyAccepted(records, outcome)) reasons.push(`evaluation outcome lacks independent acceptance: ${hash}`);
      if (outcome.author?.identityRootId === record.author?.identityRootId) reasons.push(`evaluation outcome is not independent from the evaluator: ${hash}`);
    }
  }
  if (cohort) {
    const metricDefinitions = new Map(cohort.cohort.metrics.map((metric) => [metric.id, metric]));
    for (const metric of record.evaluation?.metricResults || []) {
      const definition = metricDefinitions.get(metric.metricId);
      if (!definition || definition.direction !== metric.direction) reasons.push(`evaluation metric is outside the frozen definition: ${metric.metricId}`);
    }
  }
};

const linkRealizedActionValue = (record, reasons, { records, recordsByHash, target }) => {
  const value = record.realizedValue || {};
  const reviewStateByHash = new Map(projectResearchReviewStates(records)
    .map((entry) => [entry.recordHash, entry]));
  const question = target(value.questionHash);
  const candidate = target(value.candidateActionHash);
  const evaluation = target(value.evaluationHash);
  if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
    reasons.push('realized action value must target a research question submission');
  }
  if (candidate?.kind !== RESEARCH_RECORD_KINDS.candidateAction) {
    reasons.push('realized action value must target a candidate action');
  } else {
    if (candidate.questionHash !== value.questionHash || record.questionHash !== value.questionHash) {
      reasons.push('realized action-value question does not match its candidate action');
    }
    if (candidate.action?.contractHash !== value.actionContractHash) {
      reasons.push('realized action value does not bind the exact candidate action contract');
    }
    for (const approvalHash of value.candidateActionApprovalHashes || []) {
      const approval = target(approvalHash);
      if (approval?.kind !== RESEARCH_RECORD_KINDS.claim
        || approval.claim?.kind !== 'candidate_action_approval'
        || approval.claim?.decision !== 'approved'
        || approval.claim?.actionContractHash !== value.actionContractHash
        || approval.targetHash !== value.candidateActionHash
        || approval.author?.identityRootId === candidate.author?.identityRootId) {
        reasons.push(`realized action value lacks an independent exact-contract candidate approval: ${approvalHash}`);
      }
    }
  }
  if (evaluation?.kind !== RESEARCH_RECORD_KINDS.evaluation) {
    reasons.push('realized action value must target a frozen cohort evaluation');
  } else {
    const cohort = target(evaluation.cohortHash);
    if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort
      || !cohort.cohort?.questionHashes?.includes(value.questionHash)) {
      reasons.push('realized action-value evaluation cohort does not include its question');
    }
    if (!independentlyAccepted(records, evaluation)) {
      reasons.push('realized action-value evaluation requires independent acceptance');
    }
    const activeEvaluationReviews = new Set((reviewStateByHash.get(value.evaluationHash)?.decisions || [])
      .filter((decision) => decision.claim?.decision === 'accepted')
      .map((decision) => decision.recordHash));
    for (const reviewHash of value.evaluationReviewDecisionHashes || []) {
      const review = target(reviewHash);
      if (review?.kind !== RESEARCH_RECORD_KINDS.claim
        || review.claim?.kind !== 'review_decision'
        || review.claim?.decision !== 'accepted'
        || review.targetHash !== value.evaluationHash
        || !activeEvaluationReviews.has(reviewHash)) {
        reasons.push(`realized action-value review does not currently accept its evaluation: ${reviewHash}`);
      }
    }
    const measuredOutcomeHashes = (value.reviewedOutcomes || []).map((entry) => entry.outcomeHash);
    if (!sameStringSet(measuredOutcomeHashes, evaluation.evaluation?.outcomeHashes || [])) {
      reasons.push('realized action value must bind every evaluated outcome');
    }
    const measuredMetrics = new Map((value.metricResults || []).map((metric) => [metric.metricId, metric]));
    const evaluationMetrics = evaluation.evaluation?.metricResults || [];
    if (!sameStringSet([...measuredMetrics.keys()], evaluationMetrics.map((metric) => metric.metricId))) {
      reasons.push('realized action-value metrics do not match the frozen evaluation');
    } else {
      for (const metric of evaluationMetrics) {
        const measured = measuredMetrics.get(metric.metricId);
        const regressed = metric.direction === 'higher_is_better'
          ? metric.currentValue < metric.baselineValue
          : metric.currentValue > metric.baselineValue;
        if (measured.direction !== metric.direction
          || measured.baselineValue !== metric.baselineValue
          || measured.currentValue !== metric.currentValue
          || measured.absoluteDelta !== metric.absoluteDelta
          || measured.relativeDelta !== metric.relativeDelta
          || measured.improved !== metric.improved
          || measured.regressed !== regressed) {
          reasons.push(`realized action-value metric differs from its evaluation: ${metric.metricId}`);
        }
      }
    }
  }
  for (const reviewed of value.reviewedOutcomes || []) {
    const outcome = target(reviewed.outcomeHash);
    if (outcome?.kind !== RESEARCH_RECORD_KINDS.outcome) {
      reasons.push(`realized action-value outcome kind mismatch: ${reviewed.outcomeHash}`);
      continue;
    }
    if (!independentlyAccepted(records, outcome)) {
      reasons.push(`realized action-value outcome lacks independent acceptance: ${reviewed.outcomeHash}`);
    }
    const activeAcceptedDecisions = new Set((reviewStateByHash.get(reviewed.outcomeHash)?.decisions || [])
      .filter((decision) => decision.claim?.decision === 'accepted')
      .map((decision) => decision.recordHash));
    for (const reviewHash of reviewed.reviewDecisionHashes || []) {
      const review = target(reviewHash);
      if (review?.kind !== RESEARCH_RECORD_KINDS.claim
        || review.claim?.kind !== 'review_decision'
        || review.claim?.decision !== 'accepted'
        || review.targetHash !== reviewed.outcomeHash
        || !activeAcceptedDecisions.has(reviewHash)) {
        reasons.push(`realized action-value review does not currently accept its outcome: ${reviewHash}`);
      }
    }
  }
  const eligibleContributions = realizedContributionCandidates(value, recordsByHash);
  const suppliedContributions = new Set((value.contributions || []).map((entry) => entry.recordHash));
  const requiredContributions = new Set([
    value.candidateActionHash,
    ...(value.candidateActionApprovalHashes || []),
    value.evaluationHash,
    ...(value.evaluationReviewDecisionHashes || []),
    ...(value.reviewedOutcomes || []).flatMap((entry) => [
      entry.outcomeHash,
      ...(entry.reviewDecisionHashes || [])
    ])
  ]);
  for (const hash of requiredContributions) {
    if (!suppliedContributions.has(hash)) reasons.push(`realized action value omits a required causal contribution: ${hash}`);
  }
  for (const contribution of value.contributions || []) {
    const linked = target(contribution.recordHash);
    if (!eligibleContributions.has(contribution.recordHash)) {
      reasons.push(`realized action-value contribution is outside the causal record graph: ${contribution.recordHash}`);
    }
    const expectedRole = realizedContributionRole(linked, value.candidateActionHash, value.evaluationHash);
    if (!expectedRole || contribution.role !== expectedRole) {
      reasons.push(`realized action-value contribution role mismatch: ${contribution.recordHash}`);
    }
    if (linked?.author?.identityRootId === record.author?.identityRootId) {
      reasons.push(`realized action-value assessor cannot credit itself: ${contribution.recordHash}`);
    }
  }
  if (Date.parse(record.createdAt || '') < Date.parse(evaluation?.createdAt || '')) {
    reasons.push('realized action value predates its evaluation');
  }
};

export const experimentLinkValidators = Object.freeze([
  [RESEARCH_RECORD_KINDS.workOrder, linkWorkOrder],
  [RESEARCH_RECORD_KINDS.workClaim, linkWorkClaim],
  [RESEARCH_RECORD_KINDS.outcome, linkOutcome],
  [RESEARCH_RECORD_KINDS.cohort, linkCohort],
  [RESEARCH_RECORD_KINDS.evaluation, linkEvaluation],
  [RESEARCH_RECORD_KINDS.realizedActionValue, linkRealizedActionValue]
]);
