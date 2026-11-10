/** Record targets, revocation and invalidation, active records, and independent review states. */
import {
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  unique
} from './primitives.js';
import {
  validateEnabledPoolModelContract
} from '../../../../shared/pool/model-contract.js';

/**
 * Verify the publication boundary separately from signature and link checks.
 * Historical fixtures may be structurally valid with an unavailable contract,
 * but a new Poolday submission or model result may cite only an enabled exact
 * catalog contract.
 */
export function validateResearchRecordModelAdmission(record = {}) {
  if (![RESEARCH_RECORD_KINDS.submission, RESEARCH_RECORD_KINDS.result].includes(record?.kind)) {
    return { ok: true, reasons: [] };
  }
  return validateEnabledPoolModelContract(record.modelContract);
}

export function researchRecordTargetHashes(record = {}) {
  const targets = [];
  if (record.kind === RESEARCH_RECORD_KINDS.result) targets.push(record.submissionHash);
  if ([RESEARCH_RECORD_KINDS.claim, RESEARCH_RECORD_KINDS.revocation].includes(record.kind)) targets.push(record.targetHash);
  if ([RESEARCH_RECORD_KINDS.hypothesis, RESEARCH_RECORD_KINDS.priorEvidence, RESEARCH_RECORD_KINDS.prediction, RESEARCH_RECORD_KINDS.resolutionPolicy, RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.outcome, RESEARCH_RECORD_KINDS.candidateAction, RESEARCH_RECORD_KINDS.realizedActionValue].includes(record.kind)) {
    targets.push(record.questionHash);
  }
  if (record.kind === RESEARCH_RECORD_KINDS.hypothesis) {
    targets.push(...(record.hypothesis?.priorEvidenceHashes || []), ...(record.hypothesis?.alternativeToHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.prediction) targets.push(record.hypothesisHash);
  if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) targets.push(record.policy?.targetHypothesisHash);
  if ([RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.outcome].includes(record.kind)) targets.push(...(record.hypothesisHashes || []));
  if (record.kind === RESEARCH_RECORD_KINDS.workClaim) targets.push(record.workOrderHash);
  if (record.kind === RESEARCH_RECORD_KINDS.outcome) {
    targets.push(record.workOrderHash, record.workClaimHash, record.replicationOfHash);
  }
  if (record.kind === RESEARCH_RECORD_KINDS.cohort) {
    targets.push(...(record.cohort?.questionHashes || []), ...(record.cohort?.predictionHashes || []), ...(record.cohort?.workOrderHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.evaluation) {
    targets.push(record.cohortHash, ...(record.evaluation?.outcomeHashes || []), ...(record.evaluation?.nextCohortQuestionHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) {
    targets.push(
      record.realizedValue?.candidateActionHash,
      ...(record.realizedValue?.candidateActionApprovalHashes || []),
      record.realizedValue?.evaluationHash,
      ...(record.realizedValue?.evaluationReviewDecisionHashes || []),
      ...(record.realizedValue?.reviewedOutcomes || []).flatMap((entry) => [
        entry.outcomeHash,
        ...(entry.reviewDecisionHashes || [])
      ]),
      ...(record.realizedValue?.contributions || []).map((entry) => entry.recordHash)
    );
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationEvaluation) targets.push(record.experimentHash);
  if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) {
    targets.push(
      ...(record.action?.affectedHypothesisHashes || []),
      ...(record.action?.uncertainty || [])
        .map((entry) => entry.calibration?.cohortHash)
        .filter(Boolean),
      ...(record.action?.expectedValue?.calibrationEvidenceHashes || [])
    );
  }
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    targets.push(record.checkpoint?.questionHash, ...(record.checkpoint?.activeInputRecordHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.sequenceLink) {
    targets.push(record.link?.nucleotideSubmissionHash, record.link?.proteinSubmissionHash);
  }
  return unique(targets);
}

export function revokedResearchHashes(records = []) {
  return new Set(records
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.revocation)
    .map((record) => record.targetHash));
}

export function invalidatedResearchHashes(records = []) {
  const invalidated = revokedResearchHashes(records);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.kind === RESEARCH_RECORD_KINDS.revocation || invalidated.has(record.recordHash)) continue;
      if (researchRecordTargetHashes(record).some((targetHash) => invalidated.has(targetHash))) {
        invalidated.add(record.recordHash);
        changed = true;
      }
    }
  }
  return invalidated;
}

export function activeResearchRecords(records = []) {
  const invalidated = invalidatedResearchHashes(records);
  return records.filter((record) => record.kind !== RESEARCH_RECORD_KINDS.revocation && !invalidated.has(record.recordHash));
}

const independentReviewDecisions = (records, target) => {
  const invalidated = invalidatedResearchHashes(records);
  return records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim
    && record.claim?.kind === 'review_decision'
    && record.targetHash === target?.recordHash
    && record.author?.identityRootId !== target?.author?.identityRootId
    && !invalidated.has(record.recordHash));
};

const latestDecisionPerReviewer = (decisions) => {
  const latest = new Map();
  for (const decision of decisions) {
    const reviewerId = decision.author?.identityRootId || decision.author?.roleId || decision.recordHash;
    const previous = latest.get(reviewerId);
    if (!previous
      || String(previous.createdAt || '').localeCompare(String(decision.createdAt || '')) < 0
      || (previous.createdAt === decision.createdAt && previous.recordHash.localeCompare(decision.recordHash) < 0)) {
      latest.set(reviewerId, decision);
    }
  }
  return [...latest.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
    || left.recordHash.localeCompare(right.recordHash));
};

export function projectResearchReviewStates(records = []) {
  const active = activeResearchRecords(records);
  return active.map((record) => {
    const decisions = latestDecisionPerReviewer(independentReviewDecisions(records, record));
    const decisionStates = unique(decisions.map((decision) => decision.claim?.decision).filter(Boolean));
    const state = decisionStates.length === 1 ? decisionStates[0] : decisionStates.length > 1 ? 'disputed' : 'unresolved';
    return {
      recordHash: record.recordHash,
      state,
      disagreement: decisionStates.length > 1,
      replicationRequested: decisionStates.includes('replication_requested'),
      decisionStates,
      decisions
    };
  });
}

/** Whether `target` currently holds an accepted independent review state. */
export const independentlyAccepted = (records, target) => projectResearchReviewStates(records)
  .some((entry) => entry.recordHash === target?.recordHash && entry.state === 'accepted');

/** Hashes of records whose independent review state is accepted. */
export const acceptedReviewHashes = (records) => {
  return new Set(projectResearchReviewStates(records)
    .filter((entry) => entry.state === 'accepted')
    .map((entry) => entry.recordHash));
};
