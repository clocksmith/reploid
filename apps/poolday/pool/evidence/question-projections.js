/** Question lifecycles, prediction disagreement, model evidence and resolution-criteria projections. */
import {
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  compareResearchRecords,
  unique
} from './primitives.js';
import {
  activeResearchRecords,
  projectResearchReviewStates
} from './review-state.js';
import {
  buildExactModelEvidenceView
} from '../model-evidence-view.js';

export function buildPredictionDisagreementMap(records = [], questionHash = null) {
  const active = activeResearchRecords(records);
  const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction
    && (!questionHash || record.questionHash === questionHash));
  const conditions = new Map();
  for (const prediction of predictions) {
    const conditionKey = JSON.stringify(prediction.prediction.conditions || {});
    if (!conditions.has(conditionKey)) conditions.set(conditionKey, {
      conditionKey,
      conditions: prediction.prediction.conditions,
      predictions: [],
      labels: new Map()
    });
    const group = conditions.get(conditionKey);
    group.predictions.push(prediction);
    const label = prediction.prediction.normalizedLabel;
    group.labels.set(label, [...(group.labels.get(label) || []), prediction]);
  }
  return [...conditions.values()].map((group) => {
    const labels = [...group.labels.entries()].map(([label, entries]) => ({
      label,
      count: entries.length,
      meanConfidence: entries.reduce((sum, entry) => sum + entry.prediction.confidence, 0) / entries.length,
      methodIds: unique(entries.map((entry) => entry.prediction.method.methodId)),
      predictionHashes: entries.map((entry) => entry.recordHash)
    }));
    return {
      conditionKey: group.conditionKey,
      conditions: group.conditions,
      predictionCount: group.predictions.length,
      labels,
      disagreement: labels.length > 1,
      unresolved: labels.length !== 1
    };
  });
}

export function buildModelEvidenceView(records = [], submissionHash) {
  return buildExactModelEvidenceView(activeResearchRecords(records), submissionHash);
}

export function buildQuestionLifecycles(records = []) {
  const active = activeResearchRecords(records);
  const reviews = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  return active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)
    .map((question) => {
      const matchesQuestion = (record) => record.questionHash === question.recordHash;
      const hypotheses = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && matchesQuestion(record));
      const priorEvidence = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && matchesQuestion(record));
      const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && matchesQuestion(record));
      const resolutionPolicies = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && matchesQuestion(record));
      const workOrders = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && matchesQuestion(record));
      const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
      const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
      const outcomes = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && matchesQuestion(record));
      const cohorts = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(question.recordHash));
      const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
      const evaluations = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
      const realizedActionValues = active.filter((record) => (
        record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
        && record.questionHash === question.recordHash
      ));
      return {
        question,
        modelEvidence: buildModelEvidenceView(active, question.recordHash),
        hypotheses,
        priorEvidence,
        predictions,
        resolutionPolicies,
        disagreementMap: buildPredictionDisagreementMap(active, question.recordHash),
        workOrders,
        workClaims,
        outcomes,
        claimStates: [...hypotheses, ...priorEvidence, ...predictions, ...workOrders, ...outcomes]
          .map((record) => reviews.get(record.recordHash) || { recordHash: record.recordHash, state: 'unresolved', decisions: [] }),
        cohorts,
        evaluations,
        realizedActionValues,
        measuredEffects: evaluations.flatMap((record) => record.evaluation.metricResults.map((metric) => ({
          evaluationHash: record.recordHash,
          cohortHash: record.cohortHash,
          ...metric
        })))
      };
    });
}

export function projectResearchResolutionCriteria(records = [], questionHash) {
  const active = activeResearchRecords(records);
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const policies = active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && record.questionHash === questionHash)
    .sort(compareResearchRecords);
  const accepted = policies.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const policy = accepted.at(-1) || policies.at(-1) || null;
  return {
    schema: 'poolday.research_resolution_projection/v1',
    questionHash,
    status: !policy ? 'policy_missing' : accepted.includes(policy) ? 'criteria_frozen' : 'awaiting_independent_review',
    policyHash: policy?.recordHash || null,
    policy: policy?.policy || null,
    reviewState: policy ? reviewStates.get(policy.recordHash)?.state || 'unresolved' : 'missing',
    closureAuthority: 'none',
    closureState: 'not_evaluated',
    boundary: 'Criteria define future eligibility only; this projection cannot accept, reject, or close a scientific question.'
  };
}
