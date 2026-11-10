/**
 * @fileoverview Signed evaluation-phase records from lifecycle forms: frozen cohorts, cohort
 * evaluations over independently accepted outcomes, and realized action value.
 */
import {
  createSignedCohortEvaluation,
  createSignedEvaluationCohort,
  createSignedRealizedActionValue,
  projectResearchReviewStates
} from '../../pool/evidence-network.js';
import { compactHash } from './research-panels.js';

const cohortRecord = (values, { researcher, roomId, records }) => {
  const questionHash = values.get('questionHash');
  const predictionHashes = records.filter((record) => record.kind === 'research_prediction' && record.questionHash === questionHash).map((record) => record.recordHash);
  const workOrderHashes = records.filter((record) => record.kind === 'research_work_order' && record.questionHash === questionHash).map((record) => record.recordHash);
  if (!predictionHashes.length || !workOrderHashes.length) throw new Error('The selected question needs frozen predictions and a work order');
  return createSignedEvaluationCohort({
    identity: researcher,
    roomId,
    label: values.get('label'),
    questionHashes: [questionHash],
    predictionHashes,
    workOrderHashes,
    metrics: [{ id: values.get('metricId'), label: values.get('metricLabel'), direction: values.get('direction'), unit: values.get('unit') }]
  });
};

const evaluationRecord = (values, { researcher, roomId, records, byHash }) => {
  const cohort = byHash.get(values.get('cohortHash'));
  if (!cohort) throw new Error('Selected cohort is unavailable');
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const outcomeHashes = records.filter((record) => record.kind === 'research_outcome'
    && cohort.cohort.workOrderHashes.includes(record.workOrderHash)
    && Date.parse(record.createdAt) >= Date.parse(cohort.cohort.frozenAt)
    && reviewStates.get(record.recordHash)?.state === 'accepted')
    .map((record) => record.recordHash);
  if (!outcomeHashes.length) throw new Error('No independently accepted post-freeze outcomes are eligible');
  const metric = cohort.cohort.metrics[0];
  return createSignedCohortEvaluation({
    identity: researcher,
    roomId,
    cohortHash: cohort.recordHash,
    outcomeHashes,
    metricResults: [{
      metricId: metric.id,
      direction: metric.direction,
      baselineValue: values.get('baselineValue'),
      currentValue: values.get('currentValue')
    }],
    disagreementSummary: values.get('disagreementSummary'),
    failureAnalysis: values.get('failureAnalysis'),
    nextCohortQuestionHashes: values.get('bindNextCohort') === 'on' ? cohort.cohort.questionHashes : []
  });
};

const realizedActionValueRecord = (values, { researcher, roomId, records, byHash }) => {
  const candidate = byHash.get(values.get('candidateActionHash'));
  const evaluation = byHash.get(values.get('evaluationHash'));
  if (!candidate || !evaluation) throw new Error('Selected candidate action or evaluation is unavailable');
  const cohort = byHash.get(evaluation.cohortHash);
  if (!cohort?.cohort?.questionHashes?.includes(candidate.questionHash)) {
    throw new Error('Selected evaluation does not measure the candidate action question');
  }
  const candidateActionApprovalHashes = records.filter((record) => (
    record.kind === 'human_claim'
    && record.claim?.kind === 'candidate_action_approval'
    && record.claim?.decision === 'approved'
    && record.claim?.actionContractHash === candidate.action.contractHash
    && record.targetHash === candidate.recordHash
    && record.author?.identityRootId !== candidate.author?.identityRootId
  )).map((record) => record.recordHash);
  if (!candidateActionApprovalHashes.length) throw new Error('The candidate action requires independent exact-contract approval');
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedReviewHashes = (targetHash) => (reviewStates.get(targetHash)?.decisions || [])
    .filter((decision) => decision.claim?.decision === 'accepted')
    .map((decision) => decision.recordHash);
  const evaluationReviewDecisionHashes = acceptedReviewHashes(evaluation.recordHash);
  if (!evaluationReviewDecisionHashes.length) throw new Error('The measured evaluation requires independent acceptance');
  const reviewedOutcomes = evaluation.evaluation.outcomeHashes.map((outcomeHash) => {
    const reviewDecisionHashes = acceptedReviewHashes(outcomeHash);
    if (!reviewDecisionHashes.length) throw new Error(`Outcome ${compactHash(outcomeHash)} requires independent acceptance`);
    return { outcomeHash, reviewDecisionHashes };
  });
  const contributionByHash = new Map();
  const addContribution = (recordHash, role, causalRationale) => {
    if (recordHash) contributionByHash.set(recordHash, { recordHash, role, causalRationale });
  };
  addContribution(candidate.recordHash, 'action_proposal', 'Proposed the exact candidate action whose downstream value was measured.');
  for (const approvalHash of candidateActionApprovalHashes) {
    addContribution(approvalHash, 'independent_review', 'Independently approved the exact candidate action contract.');
  }
  addContribution(evaluation.recordHash, 'evaluation', 'Measured the candidate against the frozen cohort metric vector.');
  for (const reviewHash of evaluationReviewDecisionHashes) {
    addContribution(reviewHash, 'independent_review', 'Independently accepted the measured evaluation.');
  }
  for (const reviewed of reviewedOutcomes) {
    addContribution(reviewed.outcomeHash, 'outcome_execution', 'Produced a reviewed outcome used by the frozen evaluation.');
    for (const reviewHash of reviewed.reviewDecisionHashes) {
      addContribution(reviewHash, 'independent_review', 'Independently accepted a measured downstream outcome.');
    }
  }
  return createSignedRealizedActionValue({
    identity: researcher,
    roomId,
    questionHash: candidate.questionHash,
    candidateActionHash: candidate.recordHash,
    actionContractHash: candidate.action.contractHash,
    candidateActionApprovalHashes,
    evaluationHash: evaluation.recordHash,
    evaluationReviewDecisionHashes,
    reviewedOutcomes,
    contributions: [...contributionByHash.values()],
    metricResults: evaluation.evaluation.metricResults,
    decisionEffect: values.get('decisionEffect'),
    summary: values.get('realizedValueSummary')
  });
};

export const evaluationRecordBuilders = Object.freeze({
  cohort: cohortRecord,
  evaluation: evaluationRecord,
  'realized-action-value': realizedActionValueRecord
});
