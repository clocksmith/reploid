/** Review, correction, revocation, link validation, and reusable memory admission. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION,
  decisionContextSnapshot,
  projectResearchExecutionIndependence,
  sameStringSet,
  unique
} from './evidence-record-contract.js';
import {
  SEQUENCE_ALPHABETS
} from './sequence-workload.js';
import {
  adjudicationMetricResult,
  assessAdjudicationExperiment,
  crossRoomSourceIdentityKey,
  normalizePublicProteinEvidenceProfile
} from './evidence-normalization.js';
import {
  exactModelContractKey,
  validateEnabledPoolModelContract
} from './model-contract.js';
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

/**
 * Returns the only record set eligible for reuse as room memory. Review
 * decisions are independent, revocations propagate, and an accepted
 * correction supersedes its target without erasing immutable history.
 */
export function projectAcceptedResearchMemory(records = []) {
  const invalidated = invalidatedResearchHashes(records);
  const active = activeResearchRecords(records);
  const activeByHash = new Map(active.map((record) => [record.recordHash, record]));
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedCorrections = new Map(active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim)
    .filter((record) => record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')
    .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted')
    .map((record) => [record.targetHash, record.recordHash]));
  const baseMemoryBlockReason = (record) => {
    if (invalidated.has(record.recordHash)) return 'invalidated';
    if (acceptedCorrections.has(record.recordHash)) return 'superseded_by_accepted_correction';
    if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) return 'projection_checkpoint_not_scientific_evidence';
    if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) return 'resolution_policy_is_governance_not_scientific_evidence';
    if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) return 'candidate_action_is_a_governance_proposal';
    if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) return 'realized_action_value_is_evaluation_governance';
    if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.kind === 'candidate_action_approval') {
      return 'candidate_action_approval_is_governance_not_scientific_evidence';
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
      if (['assay', 'negative_result', 'failed_attempt'].includes(record.evidence?.kind)
        && record.evidence?.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        return 'public_evidence_contract_missing';
      }
      if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        try {
          normalizePublicProteinEvidenceProfile({
            evidenceKind: record.evidence.kind,
            conditions: record.evidence.conditions,
            transformations: record.evidence.transformations,
            provenance: record.evidence.provenance,
            finding: record.evidence.finding
          });
        } catch {
          return 'public_evidence_contract_invalid';
        }
        if (['annotation', 'domain'].includes(record.evidence.kind) && !record.evidence.annotation) {
          return 'public_annotation_identity_missing';
        }
        const question = activeByHash.get(record.questionHash);
        if (question?.kind !== RESEARCH_RECORD_KINDS.submission
          || question.consent?.publicSequence !== true
          || question.consent?.publicEvidenceNetwork !== true) {
          return 'public_evidence_consent_missing';
        }
      }
    }
    const reviewState = reviewStates.get(record.recordHash)?.state || 'unreviewed';
    if (reviewState !== 'accepted') return reviewState;
    if (record.kind === RESEARCH_RECORD_KINDS.result
      && !projectResearchExecutionIndependence(record).independentlyExecuted) {
      return 'independent_execution_missing';
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.evidence?.reuseContext) {
      const reuseContext = record.evidence.reuseContext;
      const contextAccepted = (reviewStates.get(record.recordHash)?.decisions || []).some((decision) => (
        decision.claim?.decision === 'accepted'
        && decision.claim?.contextAssessment?.determination === 'relevant'
        && decision.claim.contextAssessment.originRecordHash === reuseContext.originRecordHash
        && decision.claim.contextAssessment.originQuestionHash === reuseContext.origin.questionHash
        && decision.claim.contextAssessment.currentQuestionHash === reuseContext.current.questionHash
        && decision.claim.contextAssessment.comparisonHash === reuseContext.comparisonHash
      ));
      if (!contextAccepted) return 'contextual_relevance_review_missing';
    }
    return null;
  };
  const duplicateSources = new Map();
  const duplicateOf = new Map();
  for (const record of active.filter((entry) => baseMemoryBlockReason(entry) === null)) {
    const sourceHash = record.kind === RESEARCH_RECORD_KINDS.priorEvidence
      ? record.evidence?.reuseContext?.originSource?.identityHash
      : null;
    if (!sourceHash) continue;
    const group = duplicateSources.get(sourceHash) || [];
    group.push(record);
    duplicateSources.set(sourceHash, group);
  }
  for (const group of duplicateSources.values()) {
    if (group.length < 2) continue;
    const ordered = group.slice().sort((left, right) => (
      String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.recordHash || '').localeCompare(String(right.recordHash || ''))
    ));
    for (const duplicate of ordered.slice(1)) duplicateOf.set(duplicate.recordHash, ordered[0].recordHash);
  }
  const memoryBlockReason = (record) => (
    duplicateOf.has(record.recordHash)
      ? 'duplicate_cross_room_source'
      : baseMemoryBlockReason(record)
  );
  const acceptedRecords = active.filter((record) => memoryBlockReason(record) === null);
  const acceptedHashes = acceptedRecords.map((record) => record.recordHash).sort();
  const excluded = records
    .filter((record) => record.kind !== RESEARCH_RECORD_KINDS.revocation)
    .filter((record) => !acceptedHashes.includes(record.recordHash))
    .map((record) => ({
      recordHash: record.recordHash,
      reason: memoryBlockReason(record),
      supersededByHash: acceptedCorrections.get(record.recordHash) || null,
      ...(duplicateOf.has(record.recordHash) ? { duplicateOfHash: duplicateOf.get(record.recordHash) } : {})
    }))
    .sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  return {
    schema: 'poolday.accepted_research_memory/v1',
    policy: 'independent_review_fail_closed',
    acceptedHashes,
    records: acceptedRecords,
    excluded
  };
}

const independentlyAccepted = (records, target) => projectResearchReviewStates(records)
  .some((entry) => entry.recordHash === target?.recordHash && entry.state === 'accepted');

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

export function validateCrossRoomReuseOrigin(record = {}, originRecord = null, originQuestion = null) {
  const reasons = [];
  const reuseContext = record.kind === RESEARCH_RECORD_KINDS.priorEvidence
    ? record.evidence?.reuseContext
    : null;
  if (!reuseContext) return { ok: true, reasons };
  if (originRecord?.kind !== RESEARCH_RECORD_KINDS.priorEvidence
    || originRecord.recordHash !== reuseContext.originRecordHash) {
    reasons.push('cross-room origin record is missing or has the wrong kind');
  } else {
    if (originRecord.roomId !== reuseContext.origin.roomId
      || originRecord.questionHash !== reuseContext.origin.questionHash) {
      reasons.push('cross-room origin record does not match its declared room and question');
    }
    if (crossRoomSourceIdentityKey(originRecord) !== crossRoomSourceIdentityKey(reuseContext.originSource)) {
      reasons.push('cross-room declared source identity does not match the origin record');
    }
  }
  if (originQuestion?.kind !== RESEARCH_RECORD_KINDS.submission
    || originQuestion.recordHash !== reuseContext.origin.questionHash) {
    reasons.push('cross-room origin question is missing or has the wrong kind');
  } else {
    const expected = decisionContextSnapshot(originQuestion);
    if (expected.roomId !== reuseContext.origin.roomId
      || expected.sequenceHash !== reuseContext.origin.sequenceHash
      || JSON.stringify(expected.consent) !== JSON.stringify(reuseContext.origin.consent)
      || JSON.stringify(expected.intent) !== JSON.stringify(reuseContext.origin.intent)) {
      reasons.push('cross-room origin context does not match the signed origin question');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function validateResearchRecordLinks(record = {}, records = []) {
  const reasons = [];
  const recordsByHash = new Map(records.map((entry) => [entry.recordHash, entry]));
  const targets = researchRecordTargetHashes(record);
  const revoked = revokedResearchHashes(records);
  const invalidated = invalidatedResearchHashes(records);
  for (const targetHash of targets) {
    const target = recordsByHash.get(targetHash);
    if (!target) reasons.push(`linked research record does not exist: ${targetHash}`);
    else if (target.roomId !== record.roomId) reasons.push(`linked research record belongs to a different room: ${targetHash}`);
    else if (record.kind !== RESEARCH_RECORD_KINDS.revocation && invalidated.has(targetHash)) reasons.push(`linked research record is revoked or invalidated: ${targetHash}`);
  }
  const target = (hash) => recordsByHash.get(hash);
  if (record.kind === RESEARCH_RECORD_KINDS.result) {
    const submission = target(record.submissionHash);
    if (submission && submission.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('research result must target a submission');
    if (submission && record.sequenceHash !== submission.sequence?.hash) reasons.push('research result sequence does not match its submission');
    if (submission && record.sequenceLength !== submission.sequence?.length) reasons.push('research result sequence length does not match its submission');
    if (submission && record.compute?.submissionModelContractKey !== exactModelContractKey(submission.modelContract)) {
      reasons.push('research result submission model contract identity does not match its submission');
    }
    if (record.compute?.receiptModelContractKey !== exactModelContractKey(record.modelContract)) {
      reasons.push('research result receipt model contract identity does not match its published exact model contract');
    }
    if (submission && record.modelContract?.sequence?.alphabet
      && record.modelContract.sequence.alphabet !== submission.sequence?.alphabet) {
      reasons.push('research result model contract alphabet does not match its submission');
    }
    if (record.sequenceEvidence && record.sequenceEvidence.sequenceLength !== submission?.sequence?.length) {
      reasons.push('research result sequence evidence length does not match its submission');
    }
    if (record.embedding && submission?.consent?.publishEmbedding !== true) reasons.push('research submission did not consent to embedding publication');
    if ((record.sequenceEvidence?.residueEmbeddings?.length > 0
      || record.sequenceEvidence?.maskedResidueProposals?.length > 0)
      && submission?.consent?.publishResidueEvidence !== true) {
      reasons.push('research submission did not consent to residue evidence publication');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.sequenceLink) {
    const nucleotide = target(record.link?.nucleotideSubmissionHash);
    const protein = target(record.link?.proteinSubmissionHash);
    if (nucleotide?.kind !== RESEARCH_RECORD_KINDS.submission
      || nucleotide?.sequence?.alphabet !== SEQUENCE_ALPHABETS.nucleotide) {
      reasons.push('sequence link must target a nucleotide submission');
    }
    if (protein?.kind !== RESEARCH_RECORD_KINDS.submission
      || protein?.sequence?.alphabet !== SEQUENCE_ALPHABETS.aminoAcid) {
      reasons.push('sequence link must target a protein submission');
    }
    if (nucleotide && record.link?.translation?.nucleotideSequenceHash !== nucleotide.sequence?.hash) {
      reasons.push('sequence link nucleotide identity does not match its submission');
    }
    if (protein && record.link?.translation?.proteinSequenceHash !== protein.sequence?.hash) {
      reasons.push('sequence link protein identity does not match its submission');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim) {
    const reviewed = target(record.targetHash);
    if (record.claim?.kind === 'review_decision' && reviewed?.author?.identityRootId === record.author?.identityRootId) {
      reasons.push('review decisions must be independently authored');
    }
    const reuseContext = reviewed?.kind === RESEARCH_RECORD_KINDS.priorEvidence
      ? reviewed.evidence?.reuseContext
      : null;
    const assessment = record.claim?.contextAssessment;
    if (assessment && !reuseContext) reasons.push('contextual reuse review must target cross-room prior evidence');
    if (reuseContext && assessment) {
      if (assessment.originRecordHash !== reuseContext.originRecordHash
        || assessment.originQuestionHash !== reuseContext.origin.questionHash
        || assessment.currentQuestionHash !== reuseContext.current.questionHash
        || assessment.comparisonHash !== reuseContext.comparisonHash) {
        reasons.push('contextual reuse review does not match the attached context comparison');
      }
    }
    if (reuseContext && record.claim?.kind === 'review_decision'
      && record.claim?.decision === 'accepted'
      && assessment?.determination !== 'relevant') {
      reasons.push('accepted cross-room evidence requires an explicit relevant context determination');
    }
    if (record.claim?.kind === 'candidate_action_approval') {
      if (reviewed?.kind !== RESEARCH_RECORD_KINDS.candidateAction) {
        reasons.push('candidate action approval must target a candidate action');
      } else {
        if (reviewed.author?.identityRootId === record.author?.identityRootId) {
          reasons.push('candidate actions cannot be self-approved');
        }
        if (record.claim?.actionContractHash !== reviewed.action?.contractHash) {
          reasons.push('candidate action approval contract hash does not match its target');
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) {
    const question = target(record.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('candidate action must target a research question submission');
    } else if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
      reasons.push('candidate action requires public sequence and evidence-network consent');
    }
    for (const hash of record.action?.affectedHypothesisHashes || []) {
      const hypothesis = target(hash);
      if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
        reasons.push(`candidate action hypothesis does not belong to its question: ${hash}`);
      }
    }
    for (const uncertainty of record.action?.uncertainty || []) {
      if (uncertainty.representation !== 'probability') continue;
      const cohort = target(uncertainty.calibration?.cohortHash);
      if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort || cohort.cohort?.state !== 'frozen') {
        reasons.push(`probability calibration does not target a frozen evaluation cohort: ${uncertainty.calibration?.cohortHash}`);
      } else if (!independentlyAccepted(records, cohort)) {
        reasons.push(`probability calibration cohort lacks independent acceptance: ${cohort.recordHash}`);
      }
    }
    for (const hash of record.action?.expectedValue?.calibrationEvidenceHashes || []) {
      const calibration = target(hash);
      if (![RESEARCH_RECORD_KINDS.evaluation, RESEARCH_RECORD_KINDS.adjudicationEvaluation].includes(calibration?.kind)) {
        reasons.push(`candidate value calibration evidence kind mismatch: ${hash}`);
      } else if (!independentlyAccepted(records, calibration)) {
        reasons.push(`candidate value calibration evidence lacks independent acceptance: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.hypothesis) {
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('hypothesis must target a research question submission');
    for (const hash of record.hypothesis?.priorEvidenceHashes || []) {
      if (target(hash)?.kind !== RESEARCH_RECORD_KINDS.priorEvidence) reasons.push(`hypothesis prior evidence kind mismatch: ${hash}`);
    }
    for (const hash of record.hypothesis?.alternativeToHashes || []) {
      const alternative = target(hash);
      if (alternative?.kind !== RESEARCH_RECORD_KINDS.hypothesis || alternative.questionHash !== record.questionHash) {
        reasons.push(`competing hypothesis does not share the question: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    const question = target(record.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('prior evidence must target a research question submission');
    }
    if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
      && question?.kind === RESEARCH_RECORD_KINDS.submission
      && (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true)) {
      reasons.push('public protein evidence requires public sequence and evidence-network consent');
    }
    if (record.evidence?.annotation && question?.kind === RESEARCH_RECORD_KINDS.submission) {
      if (record.evidence.annotation.sequence?.hash !== question.sequence?.hash) {
        reasons.push('protein annotation sequence identity does not match its question');
      }
      if (record.evidence.annotation.sequence?.length !== question.sequence?.length) {
        reasons.push('protein annotation sequence length does not match its question');
      }
    }
    if (record.evidence?.reuseContext && question?.kind === RESEARCH_RECORD_KINDS.submission) {
      const reuseContext = record.evidence.reuseContext;
      const currentSnapshot = decisionContextSnapshot(question);
      if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
        reasons.push('cross-room reuse requires current-question public evidence consent');
      }
      if (reuseContext.current?.questionHash !== currentSnapshot.questionHash
        || reuseContext.current?.roomId !== currentSnapshot.roomId
        || reuseContext.current?.sequenceHash !== currentSnapshot.sequenceHash
        || JSON.stringify(reuseContext.current?.consent) !== JSON.stringify(currentSnapshot.consent)
        || JSON.stringify(reuseContext.current?.intent) !== JSON.stringify(currentSnapshot.intent)) {
        reasons.push('cross-room reuse context does not match the current question');
      }
      if (reuseContext.originRecordHash !== record.evidence.reference?.contentHash) {
        reasons.push('cross-room reuse origin does not match the attached record reference');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.prediction) {
    const hypothesis = target(record.hypothesisHash);
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('prediction must target a research question submission');
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push('prediction hypothesis does not belong to its question');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) {
    const question = target(record.questionHash);
    const hypothesis = target(record.policy?.targetHypothesisHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('resolution policy must target a research question submission');
    }
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push('resolution policy target hypothesis does not belong to its question');
    }
    const priorExecutionPlanning = records.filter((entry) => (
      [RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.workClaim, RESEARCH_RECORD_KINDS.outcome]
        .includes(entry.kind)
      && (entry.questionHash === record.questionHash
        || target(entry.workOrderHash)?.questionHash === record.questionHash)
      && Date.parse(entry.createdAt || '') <= Date.parse(record.createdAt || '')
    ));
    if (priorExecutionPlanning.length) {
      reasons.push('resolution policy must be frozen before work orders, claims, or outcomes for its question');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workOrder) {
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('work order must target a research question submission');
    for (const hash of record.hypothesisHashes || []) {
      const hypothesis = target(hash);
      if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
        reasons.push(`work order hypothesis does not belong to its question: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workClaim) {
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.outcome) {
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
        const plannedAnalysisIdentity = (({ methodId, version, artifactHash, parametersHash, runtimeIdentity }) => ({
          methodId, version, artifactHash, parametersHash, runtimeIdentity
        }))(order.work.plannedAnalysis || {});
        const outcomeAnalysisIdentity = (({ methodId, version, artifactHash, parametersHash, runtimeIdentity }) => ({
          methodId, version, artifactHash, parametersHash, runtimeIdentity
        }))(record.outcome?.analysis || {});
        if (JSON.stringify(plannedAnalysisIdentity) !== JSON.stringify(outcomeAnalysisIdentity)) {
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.cohort) {
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.evaluation) {
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) {
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationEvaluation) {
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
      if (JSON.stringify(record.evaluation?.evaluator) !== JSON.stringify(experiment.experiment?.evaluator)) {
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
            if (JSON.stringify(adjudicationMetricResult(definition, metric, index)) !== JSON.stringify(metric)) {
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
        if (JSON.stringify(expectedAssessment) !== JSON.stringify(record.evaluation?.assessment)) {
          reasons.push('adjudication evaluation assessment does not follow the frozen success policy');
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    const checkpoint = record.checkpoint || {};
    const question = target(checkpoint.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('discovery checkpoint must target a research question submission');
    }
    const orderedInputs = (checkpoint.inputRecordHashes || []).map((hash) => target(hash)).filter(Boolean);
    const expectedOrder = orderedInputs.slice().sort((left, right) => (
      String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
      || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
    ));
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
          && JSON.stringify(parent.checkpoint?.inputRecordHashes || []) === JSON.stringify(checkpoint.inputRecordHashes || [])) {
          reasons.push(`discovery checkpoint child input set is unchanged from parent: ${parentHash}`);
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.revocation) {
    const revokedTarget = target(record.targetHash);
    if (revokedTarget?.author?.identityRootId !== record.author?.identityRootId) reasons.push('only the original identity root may revoke its evidence');
    if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.revocation) reasons.push('revocation records cannot be revoked');
    if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      reasons.push('Discovery Contract checkpoints cannot be revoked; append a child checkpoint');
    }
    if (revoked.has(record.targetHash)) reasons.push('research record is already revoked');
  }
  return { ok: reasons.length === 0, reasons, targetHashes: targets };
}
