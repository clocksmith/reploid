/**
 * @fileoverview Projects the adjudication experiment and its evaluation into the room's proof:
 * frozen design, measured comparison and what the evidence does not establish.
 */
import { RESEARCH_KINDS, sorted } from './room-projection-records.js';

export const projectAdjudicationProof = (active, reviewStates) => {
  const experiments = sorted(active.filter((record) => record.kind === RESEARCH_KINDS.adjudicationExperiment));
  const experiment = experiments.at(-1) || null;
  if (!experiment) {
    return {
      schema: 'poolday.annotation_adjudication_proof_projection/v1',
      status: 'not_frozen',
      experiment: null,
      evaluation: null,
      gaps: [
        'exact_catalog_missing',
        'curator_role_missing',
        'recurring_decision_missing',
        'frozen_baseline_missing',
        'baseline_action_selection_policy_missing',
        'outcome_access_boundary_missing',
        'paired_comparison_controls_missing',
        'campaign_measurement_plan_missing',
        'north_star_policy_missing',
        'paired_cohort_missing',
        'success_metrics_missing',
        'independent_evaluator_missing'
      ]
    };
  }
  const evaluations = sorted(active.filter((record) => (
    record.kind === RESEARCH_KINDS.adjudicationEvaluation
    && record.experimentHash === experiment.recordHash
    && record.evaluation?.schema === 'poolday.annotation_adjudication_evaluation/v3'
  )));
  const evaluation = evaluations.at(-1) || null;
  const experimentReviewState = reviewStates.get(experiment.recordHash)?.state || 'unresolved';
  const evaluationReviewState = evaluation ? reviewStates.get(evaluation.recordHash)?.state || 'unresolved' : null;
  const baselinePolicyFrozen = experiment.experiment?.schema === 'poolday.annotation_adjudication_experiment/v3';
  const campaignMeasurementFrozen = experiment.experiment?.measurementPlan?.schema
    === 'poolday.adjudication_campaign_measurement_plan/v1';
  const northStarPolicyFrozen = experiment.experiment?.northStarPolicy?.schema
    === 'poolday.adjudication_north_star_policy/v1';
  let status = 'frozen_awaiting_review';
  let gaps = ['independent_experiment_review_missing'];
  if (!baselinePolicyFrozen) {
    status = 'baseline_policy_freeze_required';
    gaps = [
      'baseline_action_selection_policy_missing',
      'outcome_access_boundary_missing',
      'paired_comparison_controls_missing'
    ];
  } else if (!campaignMeasurementFrozen) {
    status = 'campaign_measurement_plan_required';
    gaps = ['campaign_measurement_plan_missing'];
  } else if (!northStarPolicyFrozen) {
    status = 'north_star_policy_required';
    gaps = ['north_star_policy_missing'];
  } else if (['rejected', 'disputed', 'needs_revision', 'replication_requested'].includes(experimentReviewState)) {
    status = `experiment_contract_${experimentReviewState}`;
    gaps = [`experiment_contract_${experimentReviewState}`];
  } else if (experimentReviewState === 'accepted' && !evaluation) {
    status = 'frozen_awaiting_evaluation';
    gaps = ['prospective_paired_evaluation_missing'];
  } else if (experimentReviewState === 'accepted' && evaluation
    && ['rejected', 'disputed', 'needs_revision', 'replication_requested'].includes(evaluationReviewState)) {
    status = `evaluation_${evaluationReviewState}`;
    gaps = [`evaluation_${evaluationReviewState}`];
  } else if (experimentReviewState === 'accepted' && evaluation && evaluationReviewState !== 'accepted') {
    status = 'evaluated_awaiting_review';
    gaps = ['independent_evaluation_review_missing'];
  } else if (experimentReviewState === 'accepted' && evaluationReviewState === 'accepted') {
    status = `experiment_${evaluation.evaluation.assessment.conclusion}`;
    gaps = evaluation.evaluation.assessment.conclusion === 'passes'
      ? []
      : [evaluation.evaluation.assessment.conclusion === 'inconclusive'
          ? 'paired_sample_or_precision_insufficient'
          : 'frozen_success_rule_not_met'];
  }
  return {
    schema: 'poolday.annotation_adjudication_proof_projection/v1',
    status,
    experiment: {
      recordHash: experiment.recordHash,
      reviewState: experimentReviewState,
      schema: experiment.experiment.schema || null,
      contractHash: experiment.experiment.contractHash,
      target: experiment.experiment.target,
      baseline: experiment.experiment.baseline,
      candidate: experiment.experiment.candidate,
      cohort: experiment.experiment.cohort,
      outcomeBoundary: experiment.experiment.outcomeBoundary || null,
      comparison: experiment.experiment.comparison || null,
      measurementPlan: experiment.experiment.measurementPlan || null,
      northStarPolicy: experiment.experiment.northStarPolicy || null,
      metrics: experiment.experiment.metrics,
      successPolicy: experiment.experiment.successPolicy,
      resolution: experiment.experiment.resolution,
      frozenAt: experiment.experiment.frozenAt
    },
    evaluation: evaluation ? {
      recordHash: evaluation.recordHash,
      reviewState: evaluationReviewState,
      conclusion: evaluation.evaluation.assessment.conclusion,
      assessment: evaluation.evaluation.assessment,
      metricResults: evaluation.evaluation.metricResults,
      northStarEvidence: evaluation.evaluation.northStarEvidence || null,
      resultManifest: evaluation.evaluation.resultManifest,
      regressionCount: evaluation.evaluation.regressionCount,
      missingCaseCount: evaluation.evaluation.missingCaseCount
    } : null,
    gaps
  };
};
