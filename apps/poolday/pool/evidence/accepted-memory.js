/** Accepted research memory: the only record set eligible for reuse; corrections supersede, duplicates count once. */
import {
  PUBLIC_FINDING_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS,
  projectResearchExecutionIndependence
} from '../evidence-record-contract.js';
import {
  compareResearchRecords,
  hasPublicEvidenceConsent
} from './primitives.js';
import {
  annotationIdentityMissing,
  publicProteinEvidenceProfileOf
} from './scientific-normalization.js';
import {
  activeResearchRecords,
  invalidatedResearchHashes,
  projectResearchReviewStates
} from './review-state.js';

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
      if (PUBLIC_FINDING_EVIDENCE_KINDS.includes(record.evidence?.kind)
        && record.evidence?.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        return 'public_evidence_contract_missing';
      }
      if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        try {
          publicProteinEvidenceProfileOf(record.evidence);
        } catch {
          return 'public_evidence_contract_invalid';
        }
        if (annotationIdentityMissing(record.evidence)) {
          return 'public_annotation_identity_missing';
        }
        const question = activeByHash.get(record.questionHash);
        if (question?.kind !== RESEARCH_RECORD_KINDS.submission || !hasPublicEvidenceConsent(question)) {
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
    const ordered = group.slice().sort(compareResearchRecords);
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
