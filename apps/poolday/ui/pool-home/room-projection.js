/**
 * @fileoverview Pure Research Room projection over existing Poolday records.
 *
 * This module never persists, signs, or mutates evidence. It exposes stable
 * identifiers and hashes so the room can present one causal view without
 * becoming a second authority. It composes the room from the room-*-projection
 * modules and record helpers in this folder.
 */
import {
  activeResearchRecords,
  buildQuestionLifecycles,
  invalidatedResearchHashes,
  projectResearchResolutionCriteria,
  projectResearchReviewStates,
  rankProposedCandidateActions
} from '../../pool/evidence-network.js';
import { projectGovernedResearchCycle } from '../../pool/research-cycle.js';
import { RESEARCH_KINDS, asText, recordTitle } from './room-projection-records.js';
import { projectAdjudicationProof } from './room-adjudication-proof.js';
import { acceptedCorrectionsByTarget, projectCompleteEvidenceArchive } from './room-evidence-archive.js';
import {
  evidenceAgreement,
  latest,
  resultForQuestion,
  projectParticipants,
  buildTimeline
} from './room-timeline-projection.js';
import { projectProposals, projectUnresolved } from './room-open-work-projection.js';
import { projectResult, projectRecovery } from './room-result-projection.js';
import {
  scopeRoomSources,
  projectPriorRoomEvidence,
  projectCampaignQueue,
  projectDiscoveryContractCheckpoint
} from './room-context-projection.js';

export { projectCompleteEvidenceArchive } from './room-evidence-archive.js';

export function projectResearchRoom({
  roomId,
  routeId = 'home',
  researchRecords = [],
  quarantinedRecords = [],
  crossRoomEvidence = {},
  campaignQueue = {},
  receipts = [],
  peerEvents = [],
  syncState = {}
} = {}) {
  const scopedRecords = researchRecords.filter((record) => !roomId || record.roomId === roomId);
  const scopedReceipts = scopeRoomSources(receipts, roomId);
  const scopedPeerEvents = scopeRoomSources(peerEvents, roomId);
  const active = activeResearchRecords(scopedRecords);
  const invalidated = invalidatedResearchHashes(scopedRecords);
  const reviewStates = new Map(projectResearchReviewStates(scopedRecords).map((entry) => [entry.recordHash, entry]));
  const acceptedCorrections = acceptedCorrectionsByTarget(active, reviewStates);
  const submission = latest(active, RESEARCH_KINDS.submission);
  const result = resultForQuestion(active, submission);
  const agreement = evidenceAgreement(result, scopedRecords);
  const cycle = projectGovernedResearchCycle(scopedRecords, { questionHash: submission?.recordHash || null });
  const resolutionCriteria = projectResearchResolutionCriteria(scopedRecords, submission?.recordHash || null);
  const rememberedHashes = new Set(cycle.memory.acceptedHashes);
  const tasks = cycle.actions;
  const ranked = cycle.ranking.rankedCandidates || [];
  const rankedById = new Map(ranked.map((task) => [task.actionId, task]));
  const projectedTasks = tasks
    .map((task) => ({ ...task, ...(rankedById.get(task.taskId) || {}) }))
    .sort((left, right) => Number(right.heuristicPriority || 0) - Number(left.heuristicPriority || 0));
  const candidateRanking = rankProposedCandidateActions(scopedRecords);
  const signedCandidateActions = candidateRanking.admittedCandidates.map((candidate) => ({
    actionType: 'signed_candidate_action',
    actionId: candidate.actionId,
    actionKind: candidate.actionKind,
    title: candidate.title,
    targetHash: candidate.recordHash,
    reason: candidate.rationale,
    status: candidate.humanApprovalState === 'approved' ? 'approved' : 'proposed',
    heuristicPriority: candidate.rankingScore,
    basis: 'signed_candidate_contract',
    basisHashes: candidate.affectedHypothesisHashes,
    approvalRecordHashes: candidate.approvalRecordHashes,
    contractHash: candidate.actionId,
    rawValueComponents: candidate.rawValueComponents,
    scientificCost: candidate.scientificCost,
    uncertainty: candidate.uncertainty,
    execution: candidate.execution,
    rankingStatus: candidate.rankingStatus,
    allocationAuthority: candidate.allocationAuthority,
    executionAuthority: candidate.executionAuthority
  }));
  const nextActions = [...signedCandidateActions, ...projectedTasks];
  const participants = projectParticipants(active, scopedPeerEvents, result, submission);
  const question = submission
    ? {
        submissionHash: submission.recordHash,
        sequenceHash: submission.sequence?.hash || null,
        sequenceLength: submission.sequence?.length || null,
        intent: submission.requesterIntent || null,
        consent: {
          sequence: submission.consent?.publicSequence === true,
          embedding: submission.consent?.publishEmbedding === true,
          residue: submission.consent?.publishResidueEvidence === true
        },
        modelContract: submission.modelContract || null,
        policyId: submission.policyId || null,
        clarity: cycle.clarity
      }
    : null;
  const activeByHash = new Map(active.map((record) => [record.recordHash, record]));
  const memory = cycle.memory.records.map((entry) => {
    const record = activeByHash.get(entry.recordHash);
    return {
      id: entry.recordHash,
      kind: entry.kind,
      occurredAt: record?.createdAt || null,
      title: recordTitle(record),
      status: 'accepted',
      sourceHash: entry.recordHash,
      reviewDecisionHashes: entry.reviewDecisionHashes
    };
  });
  const archive = projectCompleteEvidenceArchive({
    roomId,
    records: scopedRecords,
    reviewStates,
    invalidated,
    acceptedCorrections,
    rememberedHashes,
    memoryExclusions: cycle.memory.excluded,
    quarantinedRecords,
    syncState
  });
  const priorRoomEvidence = projectPriorRoomEvidence({
    roomId,
    submission,
    currentRecords: scopedRecords,
    crossRoomEvidence
  });
  const proteinCampaign = projectCampaignQueue({ submission, campaignQueue });
  const adjudicationProof = projectAdjudicationProof(active, reviewStates);
  const discoveryContract = projectDiscoveryContractCheckpoint({
    records: scopedRecords,
    submission,
    cycle
  });
  const cycleExclusions = new Map(cycle.memory.excluded.map((entry) => [entry.recordHash, entry]));
  const decisionMemory = {
    schema: 'poolday.decision_memory_projection/v1',
    policyId: cycle.policyId,
    admissionPolicy: cycle.memory.policy,
    decisionContextHash: submission?.recordHash || null,
    sourceArchiveSchema: archive.schema,
    acceptedHashes: [...cycle.memory.acceptedHashes],
    entries: memory,
    excluded: [
      ...archive.entries
        .filter((entry) => !rememberedHashes.has(entry.recordHash))
        .map((entry) => ({
          recordHash: entry.recordHash,
          state: entry.state,
          reason: cycleExclusions.get(entry.recordHash)?.reason || entry.state,
          supersededByHash: entry.supersededByHash
        })),
      ...archive.rejected.map((entry) => ({
        recordHash: entry.recordHash,
        archiveEntryId: entry.id,
        state: 'rejected',
        reason: entry.reason,
        supersededByHash: null
      }))
    ]
  };
  const proposals = projectProposals(active, reviewStates, acceptedCorrections);
  const unresolved = projectUnresolved({
    active,
    reviewStates,
    latestResult: result,
    latestResultRemembered: result ? rememberedHashes.has(result.recordHash) : false,
    agreement,
    tasks: nextActions,
    acceptedCorrections
  });
  const timeline = buildTimeline({
    records: scopedRecords,
    peerEvents: scopedPeerEvents,
    receipts: scopedReceipts,
    reviewStates,
    invalidated,
    acceptedCorrections,
    agreement
  });
  const status = !submission
    ? 'ready'
    : !result
      ? 'investigating'
      : acceptedCorrections.has(result.recordHash)
        ? 'corrected'
        : reviewStates.get(result.recordHash)?.state === 'accepted'
          ? rememberedHashes.has(result.recordHash) ? 'remembered' : 'awaiting_replication'
          : 'awaiting_review';
  const recovery = projectRecovery({
    syncState,
    invalidatedCount: invalidated.size,
    awaitingReview: status === 'awaiting_review',
    awaitingReplication: status === 'awaiting_replication',
    activeCount: active.length
  });
  const modelEvidence = submission
    ? buildQuestionLifecycles(scopedRecords).find((entry) => entry.question?.recordHash === submission.recordHash)?.modelEvidence || null
    : null;
  return {
    roomId: asText(roomId, 'reploid-default'),
    routeId: asText(routeId, 'home'),
    status,
    recovery,
    question,
    participants,
    latestResult: projectResult(
      result,
      submission,
      reviewStates,
      agreement,
      modelEvidence,
      acceptedCorrections,
      rememberedHashes
    ),
    unresolved,
    nextActions: nextActions.slice(0, 5).map((task) => ({
      id: task.actionId || task.taskId,
      kind: task.actionKind || task.kind || 'next_action',
      targetHash: task.targetHash,
      reason: task.reason,
      status: task.status || 'proposed',
      priority: task.heuristicPriority || null,
      basis: task.basis || 'governance',
      basisHashes: task.basisHashes || [],
      approvalRecordHashes: task.approvalRecordHashes || [],
      actionType: task.actionType || 'projected_governance_task',
      title: task.title || null,
      contractHash: task.contractHash || null,
      rawValueComponents: task.rawValueComponents || null,
      scientificCost: task.scientificCost || null,
      uncertainty: task.uncertainty || [],
      execution: task.execution || null,
      rankingStatus: task.rankingStatus || null,
      allocationAuthority: task.allocationAuthority || 'none',
      executionAuthority: task.executionAuthority || 'none'
    })),
    archive,
    priorRoomEvidence,
    proteinCampaign,
    adjudicationProof,
    resolutionCriteria,
    discoveryContract,
    decisionMemory,
    memory: decisionMemory.entries,
    memoryExclusions: decisionMemory.excluded,
    proposals,
    timeline,
    cycle,
    candidateActions: candidateRanking,
    nextQuestion: cycle.nextQuestion,
    modelEvidence: modelEvidence ? {
      agreement: modelEvidence.agreement?.status || 'not_assessed',
      disagreement: modelEvidence.disagreement?.status || 'not_assessed',
      sourceCount: modelEvidence.modelSources?.length || 0,
      sharedResiduePositions: modelEvidence.sharedResiduePositions?.length || 0
    } : null,
    counts: {
      records: scopedRecords.length,
      active: active.length,
      invalidated: invalidated.size,
      rejected: recovery.rejectedRecords.length,
      archive: archive.entries.length + archive.rejected.length,
      memory: memory.length,
      priorRoomCandidates: priorRoomEvidence.candidates.length,
      campaignEntries: proteinCampaign.entries.length,
      unresolved: unresolved.length,
      timeline: timeline.length
    }
  };
}

export const researchRoomAgreementLabels = Object.freeze({
  agreement_assessed: 'Agreement assessed',
  disagreement_assessed: 'Disagreement assessed',
  not_assessed: 'Not assessed',
  evidence_unavailable: 'Evidence unavailable'
});

export default { projectResearchRoom, researchRoomAgreementLabels };
