/** Link validation for adjudication evaluations, Discovery Contract checkpoints and revocations. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  compareResearchRecords,
  sameJson,
  sameStringSet
} from './primitives.js';
import {
  adjudicationMetricResult,
  assessAdjudicationExperiment
} from './adjudication-normalization.js';
import {
  independentlyAccepted
} from './review-state.js';

const linkAdjudicationEvaluation = (record, reasons, { records, target }) => {
  const experiment = target(record.experimentHash);
  if (experiment?.kind !== RESEARCH_RECORD_KINDS.adjudicationExperiment) {
    reasons.push('adjudication evaluation must target a frozen adjudication experiment');
  } else {
    if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION
      && experiment.experiment?.schema !== ADJUDICATION_EXPERIMENT_VERSION) {
      reasons.push('adjudication evaluation requires the current baseline-policy freeze contract');
    }
    if (!independentlyAccepted(records, experiment)) reasons.push('adjudication experiment requires independent acceptance before evaluation');
    if (experiment.author?.identityRootId === record.author?.identityRootId) {
      reasons.push('adjudication evaluation must be independently authored');
    }
    if (experiment.experiment?.evaluator?.identityRootId !== record.author?.identityRootId) {
      reasons.push('adjudication evaluation signer does not match the frozen evaluator identity root');
    }
    if (Date.parse(record.createdAt) < Date.parse(experiment.experiment?.frozenAt || '')) {
      reasons.push('adjudication evaluation predates its frozen experiment');
    }
    if (experiment.experiment?.outcomeBoundary?.mode === 'historical_hidden'
      && record.evaluation?.resultManifest?.contentHash
        !== experiment.experiment.outcomeBoundary.outcomeManifestCommitmentHash) {
      reasons.push('historical adjudication result manifest does not match the frozen outcome commitment');
    }
    if (!sameJson(record.evaluation?.evaluator, experiment.experiment?.evaluator)) {
      reasons.push('adjudication evaluation evaluator does not match the frozen contract');
    }
    const definitions = new Map((experiment.experiment?.metrics || []).map((metric) => [metric.id, metric]));
    const metricResults = record.evaluation?.metricResults || [];
    if (!sameStringSet(metricResults.map((metric) => metric.metricId), [...definitions.keys()])) {
      reasons.push('adjudication evaluation metrics do not match the frozen contract');
    } else {
      for (const [index, metric] of metricResults.entries()) {
        const definition = definitions.get(metric.metricId);
        try {
          if (!sameJson(adjudicationMetricResult(definition, metric, index), metric)) {
            reasons.push(`adjudication metric result is not canonical: ${metric.metricId}`);
          }
        } catch (error) {
          reasons.push(error.message);
        }
        if (metric.pairedSampleCount > Number(experiment.experiment?.cohort?.caseCount || 0)) {
          reasons.push(`adjudication metric sample exceeds the frozen cohort: ${metric.metricId}`);
        }
      }
      if (new Set(metricResults.map((metric) => metric.pairedSampleCount)).size !== 1) {
        reasons.push('adjudication metrics do not share one paired sample count');
      }
      const pairedSampleCount = metricResults[0]?.pairedSampleCount || 0;
      if (pairedSampleCount + Number(record.evaluation?.missingCaseCount || 0) !== experiment.experiment.cohort.caseCount) {
        reasons.push('adjudication paired and missing case counts do not account for the frozen cohort');
      }
      if (Number(record.evaluation?.regressionCount || 0) > pairedSampleCount) {
        reasons.push('adjudication regression count exceeds paired cases');
      }
      if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION) {
        const evidence = record.evaluation.northStarEvidence || {};
        const cohortCaseCount = experiment.experiment.cohort.caseCount;
        if (evidence.policyHash !== experiment.experiment.northStarPolicy?.policyHash) {
          reasons.push('adjudication north-star evidence does not bind the frozen policy');
        }
        const complete = record.evaluation.missingCaseCount === 0
          && evidence.allFrozenCasesIncluded === true
          && evidence.realWorldObserved === true
          && evidence.criteriaAppliedBeforeOutcomeAccess === true
          && evidence.operationalMetricsExcludedFromSuccess === true
          && evidence.baseline?.observedCaseCount === cohortCaseCount
          && evidence.candidate?.observedCaseCount === cohortCaseCount
          && evidence.baseline?.independentlyReplicatedConclusionCount === cohortCaseCount
          && evidence.candidate?.independentlyReplicatedConclusionCount === cohortCaseCount
          && pairedSampleCount === cohortCaseCount;
        if (evidence.reportingStatus !== (complete ? 'reportable' : 'incomplete')) {
          reasons.push('adjudication north-star reporting status does not follow the frozen completeness rule');
        }
      }
      const expectedAssessment = assessAdjudicationExperiment(
        experiment.experiment,
        metricResults,
        record.evaluation?.northStarEvidence || null
      );
      if (!sameJson(expectedAssessment, record.evaluation?.assessment)) {
        reasons.push('adjudication evaluation assessment does not follow the frozen success policy');
      }
    }
  }
};

const linkDiscoveryCheckpoint = (record, reasons, { target, invalidated }) => {
  const checkpoint = record.checkpoint || {};
  const question = target(checkpoint.questionHash);
  if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
    reasons.push('discovery checkpoint must target a research question submission');
  }
  const orderedInputs = (checkpoint.inputRecordHashes || []).map((hash) => target(hash)).filter(Boolean);
  const expectedOrder = orderedInputs.slice().sort(compareResearchRecords);
  if (orderedInputs.length === checkpoint.inputRecordHashes?.length
    && expectedOrder.some((entry, index) => entry.recordHash !== orderedInputs[index]?.recordHash)) {
    reasons.push('discovery checkpoint input records are not in deterministic order');
  }
  const activeInputs = new Set(checkpoint.activeInputRecordHashes || []);
  for (const hash of checkpoint.inputRecordHashes || []) {
    const input = target(hash);
    if (!input) {
      reasons.push(`discovery checkpoint input does not exist: ${hash}`);
      continue;
    }
    if (input.roomId !== record.roomId) reasons.push(`discovery checkpoint input belongs to a different room: ${hash}`);
    if (input.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      reasons.push(`discovery checkpoint input cannot be another checkpoint: ${hash}`);
    }
    if (Date.parse(input.createdAt || '') > Date.parse(record.createdAt || '')) {
      reasons.push(`discovery checkpoint predates its input: ${hash}`);
    }
    const shouldBeActive = input.kind !== RESEARCH_RECORD_KINDS.revocation && !invalidated.has(hash);
    if (activeInputs.has(hash) !== shouldBeActive) {
      reasons.push(`discovery checkpoint active input classification mismatch: ${hash}`);
    }
  }
  for (const parentHash of checkpoint.parentCheckpointHashes || []) {
    const parent = target(parentHash);
    if (!parent) reasons.push(`discovery checkpoint parent does not exist: ${parentHash}`);
    else if (parent.roomId !== record.roomId) reasons.push(`discovery checkpoint parent belongs to a different room: ${parentHash}`);
    else if (parent.kind !== RESEARCH_RECORD_KINDS.discoveryCheckpoint) reasons.push(`discovery checkpoint parent kind mismatch: ${parentHash}`);
    else if (parent.checkpoint?.contractId !== checkpoint.contractId) reasons.push(`discovery checkpoint parent contract mismatch: ${parentHash}`);
    else {
      if (Date.parse(parent.createdAt || '') >= Date.parse(record.createdAt || '')) {
        reasons.push(`discovery checkpoint must follow its parent: ${parentHash}`);
      }
      const missingParentInputs = (parent.checkpoint?.inputRecordHashes || [])
        .filter((hash) => !checkpoint.inputRecordHashes?.includes(hash));
      for (const hash of missingParentInputs) {
        reasons.push(`discovery checkpoint must retain parent archive input: ${hash}`);
      }
      if (parent.checkpoint?.projection?.id === checkpoint.projection?.id
        && sameJson(parent.checkpoint?.inputRecordHashes || [], checkpoint.inputRecordHashes || [])) {
        reasons.push(`discovery checkpoint child input set is unchanged from parent: ${parentHash}`);
      }
    }
  }
};

const linkRevocation = (record, reasons, { target, revoked }) => {
  const revokedTarget = target(record.targetHash);
  if (revokedTarget?.author?.identityRootId !== record.author?.identityRootId) reasons.push('only the original identity root may revoke its evidence');
  if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.revocation) reasons.push('revocation records cannot be revoked');
  if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    reasons.push('Discovery Contract checkpoints cannot be revoked; append a child checkpoint');
  }
  if (revoked.has(record.targetHash)) reasons.push('research record is already revoked');
};

export const governanceLinkValidators = Object.freeze([
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation, linkAdjudicationEvaluation],
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint, linkDiscoveryCheckpoint],
  [RESEARCH_RECORD_KINDS.revocation, linkRevocation]
]);
