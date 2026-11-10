/** Bounded discovery task proposals, approval state, and advisory action ranking; proposals allocate no work. */
import {
  RESEARCH_RECORD_KINDS,
  projectResearchExecutionIndependence,
  projectResearchQuestionClarity
} from '../evidence-record-contract.js';
import {
  EVIDENCE_POLICY,
  stableTaskId,
  unique
} from './primitives.js';
import {
  projectDiscoveryTaskContract
} from './discovery-normalization.js';
import {
  activeResearchRecords,
  projectResearchReviewStates
} from './review-state.js';
import {
  projectAcceptedResearchMemory
} from './accepted-memory.js';
import {
  rankDiscoveryActions
} from '../discovery-action-value.js';
import {
  rankSignedCandidateActions
} from '../discovery-candidate-action.js';

export function proposeDiscoveryTasks(records = []) {
  const tasks = [];
  const active = activeResearchRecords(records);
  const results = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const approvals = claims.filter((record) => record.claim.kind === 'task_approval');
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedMemory = projectAcceptedResearchMemory(records);
  const acceptedHashes = new Set(acceptedMemory.acceptedHashes);
  const addTask = (kind, targetHash, reason, {
    basis = 'governance',
    basisHashes = [targetHash]
  } = {}) => tasks.push({ kind, targetHash, reason, basis, basisHashes: unique(basisHashes).sort() });
  const requireReview = (record, label) => {
    const review = reviewStates.get(record.recordHash) || { state: 'unresolved' };
    if (review.state === 'unresolved') {
      addTask('independent_review', record.recordHash, `${label} has no independent reviewer decision.`);
    } else if (review.state === 'needs_revision') {
      addTask('revise_evidence', record.recordHash, `${label} needs the correction or context requested by its reviewer.`);
    } else if (review.state === 'replication_requested') {
      addTask('reproduce', record.recordHash, `${label} has an explicit independent replication request.`);
    } else if (review.state === 'disputed') {
      addTask('adjudicate_contradiction', record.recordHash, `${label} has conflicting independent reviewer decisions.`);
      if (review.replicationRequested) {
        addTask('reproduce', record.recordHash, `${label} has a replication request within its disputed review set.`);
      }
    } else if (review.state === 'rejected') {
      addTask('reproduce', record.recordHash, `${label} was rejected; new corrected or independently reproduced evidence is required.`);
    }
  };
  for (const submission of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)) {
    const clarity = projectResearchQuestionClarity(submission);
    if (clarity.status !== 'bounded') {
      addTask(
        'clarify_question',
        submission.recordHash,
        clarity.minimumReady
          ? `Bound the question before deriving scientific work: ${clarity.gaps.slice(0, 3).map((gap) => gap.reason).join(' ')}`
          : clarity.gaps.map((gap) => gap.reason).join(' '),
        { basis: 'question_anchor' }
      );
    }
    const linkedResults = results.filter((record) => record.submissionHash === submission.recordHash);
    if (linkedResults.length === 0 && clarity.minimumReady) {
      addTask('compute', submission.recordHash, 'No receipt-backed result exists for this signed question.', { basis: 'question_anchor' });
    }
    for (const result of linkedResults) {
      requireReview(result, 'The receipt-backed result');
      if (!projectResearchExecutionIndependence(result).independentlyExecuted) {
        addTask('reproduce', result.recordHash, 'The result lacks two distinct receipt and provider identities.');
      }
    }
    const priorEvidenceAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.questionHash === submission.recordHash);
    const hypothesesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && record.questionHash === submission.recordHash);
    const predictionsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && record.questionHash === submission.recordHash);
    const workOrdersAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && record.questionHash === submission.recordHash);
    const outcomesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && record.questionHash === submission.recordHash);
    const cohortsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(submission.recordHash));
    for (const record of [...priorEvidenceAll, ...hypothesesAll, ...predictionsAll, ...workOrdersAll, ...outcomesAll, ...cohortsAll]) {
      if (!acceptedHashes.has(record.recordHash)) requireReview(record, 'This proposed evidence');
    }
    const acceptedResults = linkedResults.filter((record) => acceptedHashes.has(record.recordHash));
    const priorEvidence = priorEvidenceAll.filter((record) => acceptedHashes.has(record.recordHash));
    const hypotheses = hypothesesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const predictions = predictionsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrders = workOrdersAll.filter((record) => acceptedHashes.has(record.recordHash));
    const outcomes = outcomesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const cohorts = cohortsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
    const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
    const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
    const evaluationsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
    for (const evaluation of evaluationsAll) if (!acceptedHashes.has(evaluation.recordHash)) requireReview(evaluation, 'This cohort evaluation');
    const evaluations = evaluationsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const acceptedEvidenceBasis = [...acceptedResults, ...priorEvidence].map((record) => record.recordHash);
    if (acceptedResults.length > 0 && priorEvidence.length === 0) {
      addTask('retrieve_prior_evidence', submission.recordHash, 'Accepted model evidence has no independently accepted versioned prior evidence.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    if (acceptedEvidenceBasis.length > 0 && hypotheses.length < 2) {
      addTask('add_competing_hypothesis', submission.recordHash, 'Accepted memory does not yet contain two condition-specific hypotheses that expose competing explanations.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    for (const hypothesis of hypotheses) {
      const methods = new Set(predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash)
        .map((prediction) => prediction.prediction.method.analysisHash));
      if (methods.size < 2) addTask('run_diverse_predictor', hypothesis.recordHash, 'This accepted hypothesis needs accepted frozen predictions from another exact method identity.', {
        basis: 'accepted_memory', basisHashes: [hypothesis.recordHash, ...predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash).map((record) => record.recordHash)]
      });
    }
    if (hypotheses.length >= 2 && workOrders.length === 0) addTask('design_discriminating_assay', submission.recordHash, 'Accepted competing hypotheses have no accepted machine-verifiable work order.', {
      basis: 'accepted_memory', basisHashes: hypotheses.map((record) => record.recordHash)
    });
    for (const order of workOrders) {
      if (!workClaims.some((claim) => claim.workOrderHash === order.recordHash)) {
        addTask('claim_experimental_work', order.recordHash, 'The accepted work order has not been claimed by a laboratory.', {
          basis: 'accepted_memory', basisHashes: [order.recordHash]
        });
      }
      const orderOutcomes = outcomes.filter((outcome) => outcome.workOrderHash === order.recordHash);
      const completedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'completed');
      const failedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'failed');
      for (const failed of failedOutcomes) {
        addTask(
          'diagnose_failed_attempt',
          failed.recordHash,
          `The accepted ${failed.outcome?.attempt?.failureCategory?.replace(/_/g, ' ') || 'failed'} attempt remains evidence but does not satisfy the planned replica target.`,
          { basis: 'accepted_memory', basisHashes: [order.recordHash, failed.recordHash] }
        );
      }
      if (workClaims.some((claim) => claim.workOrderHash === order.recordHash)
        && completedOutcomes.length < order.work.replicaTarget) {
        const classifications = ['positive', 'negative', 'ambiguous']
          .map((classification) => `${classification} ${completedOutcomes.filter((outcome) => outcome.outcome?.classification === classification).length}`)
          .join(', ');
        addTask(completedOutcomes.length ? 'replicate_assay' : 'perform_assay', order.recordHash, `${completedOutcomes.length} completed of ${order.work.replicaTarget} planned replicas (${classifications}; failed ${failedOutcomes.length}). Failed attempts remain in the basis but do not count as completed replicas.`, {
          basis: 'accepted_memory', basisHashes: [order.recordHash, ...orderOutcomes.map((record) => record.recordHash)]
        });
      }
    }
    if (predictions.length > 0 && workOrders.length > 0 && cohorts.length === 0) {
      addTask('freeze_prospective_cohort', submission.recordHash, 'Accepted predictions and work orders are not yet frozen into a blinded prospective cohort.', {
        basis: 'accepted_memory', basisHashes: [...predictions, ...workOrders].map((record) => record.recordHash)
      });
    }
    for (const cohort of cohorts) {
      const eligible = outcomes.filter((outcome) => cohort.cohort.workOrderHashes.includes(outcome.workOrderHash)
        && reviewStates.get(outcome.recordHash)?.state === 'accepted');
      if (eligible.length > 0 && !evaluations.some((evaluation) => evaluation.cohortHash === cohort.recordHash)) {
        addTask('evaluate_frozen_cohort', cohort.recordHash, 'The accepted frozen cohort has accepted blinded outcomes but no accepted measured evaluation.', {
          basis: 'accepted_memory', basisHashes: [cohort.recordHash, ...eligible.map((record) => record.recordHash)]
        });
      }
    }
    for (const evaluation of evaluations) {
      if (!evaluation.evaluation.metricResults.some((metric) => metric.improved)) {
        addTask('analyze_cohort_failure', evaluation.recordHash, 'The accepted measured cohort did not improve its frozen metric.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
      if (evaluation.evaluation.nextCohortQuestionHashes.length === 0) {
        addTask('define_next_cohort', evaluation.recordHash, 'The accepted evaluation does not yet bind its effect to a next-cohort question set.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
    }
  }
  for (const claim of claims) {
    if (claim.claim.kind === 'follow_up') addTask('follow_up', claim.recordHash, claim.claim.text);
    if (claim.claim.confidence < EVIDENCE_POLICY.lowConfidenceClaimThreshold && claim.claim.kind !== 'task_approval') addTask('resolve_uncertainty', claim.recordHash, 'The contributor marked this claim low confidence.');
    if (claim.claim.relation === 'contradicts') addTask('adjudicate_contradiction', claim.recordHash, 'A signed claim contradicts prior evidence.');
  }
  const uniqueTasks = [...new Map(tasks.map((task) => [`${task.kind}:${task.targetHash}`, task])).values()];
  return uniqueTasks.map((task) => {
    const taskId = stableTaskId(task.kind, task.targetHash);
    const taskContract = projectDiscoveryTaskContract({ ...task, taskId });
    const matchingApprovals = approvals.filter((approval) => (
      approval.claim.taskId === taskId
      && JSON.stringify(approval.claim.taskContract) === JSON.stringify(taskContract)
    ));
    return {
      ...task,
      taskId,
      taskContract,
      status: matchingApprovals.length ? 'approved' : 'proposed',
      approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash).sort()
    };
  });
}

export function rankProposedDiscoveryActions(records = []) {
  return rankDiscoveryActions(records, proposeDiscoveryTasks(records));
}

export function rankProposedCandidateActions(records = []) {
  const source = Array.isArray(records) ? records : [];
  const active = activeResearchRecords(source);
  const activeHashes = new Set(active.map((record) => record.recordHash));
  const reviewStates = new Map(projectResearchReviewStates(source).map((entry) => [entry.recordHash, entry]));
  const approvals = active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.claim
    && record.claim?.kind === 'candidate_action_approval'
  ));
  const candidates = source
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.candidateAction)
    .map((record) => {
      const matchingApprovals = approvals.filter((approval) => (
        approval.targetHash === record.recordHash
        && approval.claim?.actionContractHash === record.action?.contractHash
      ));
      const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
      const rejectionReasons = [];
      if (!activeHashes.has(record.recordHash)) rejectionReasons.push('candidate_is_revoked_or_downstream_invalidated');
      if (reviewState === 'rejected') rejectionReasons.push('candidate_was_rejected_by_independent_review');
      if (reviewState === 'disputed') rejectionReasons.push('candidate_has_disputed_independent_review');
      return {
        record,
        rejectionReasons,
        humanApprovalState: matchingApprovals.length
          ? 'approved'
          : ['rejected', 'disputed'].includes(reviewState) ? reviewState : 'approval_required',
        approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash)
      };
    });
  return rankSignedCandidateActions({ inputRecords: source, candidates });
}
