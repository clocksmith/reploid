/**
 * @fileoverview The question's surrounding context: prior-room evidence for the exact sequence,
 * the campaign queue position and the Discovery Contract checkpoint state.
 */
import { activeResearchRecords, compareResearchDecisionContexts } from '../../pool/evidence-network.js';
import { discoveryContractSourceRecords } from '../../pool/discovery-contract.js';
import {
  RESEARCH_KINDS,
  asText,
  asArray,
  sorted,
  unique,
  recordTitle,
  recordSummary
} from './room-projection-records.js';

const sourceRoomId = (source = {}) => source.roomId
  || source.record?.roomId
  || source.body?.roomId
  || source.detail?.roomId
  || null;

export const scopeRoomSources = (sources, roomId) => sources.filter((source) => {
  const sourceId = sourceRoomId(source);
  return !sourceId || !roomId || sourceId === roomId;
});

export const projectPriorRoomEvidence = ({ roomId, submission, currentRecords = [], crossRoomEvidence = {} } = {}) => {
  const projection = crossRoomEvidence?.projection || null;
  const sequenceMatches = Boolean(
    submission?.sequence?.hash
    && projection?.sequence?.hash === submission.sequence.hash
  );
  const recordsByHash = new Map(asArray(projection?.records).map((record) => [record.recordHash, record]));
  const roomsById = new Map(asArray(projection?.rooms).map((room) => [room.roomId, room]));
  const candidates = sequenceMatches
    ? asArray(projection?.candidates)
      .filter((candidate) => candidate.originRoomId !== roomId)
      .map((candidate) => {
        const record = recordsByHash.get(candidate.recordHash) || null;
        const originQuestion = recordsByHash.get(record?.questionHash) || null;
        const originRoom = roomsById.get(candidate.originRoomId) || null;
        const duplicateRecordHashes = asArray(candidate.duplicateRecordHashes).length
          ? asArray(candidate.duplicateRecordHashes)
          : [candidate.recordHash];
        const attachedRecord = currentRecords.find((entry) => (
          entry.kind === RESEARCH_KINDS.priorEvidence
          && duplicateRecordHashes.includes(entry.evidence?.reference?.contentHash)
        )) || null;
        const qualification = candidate.qualification || { status: 'needs_source_qualification', reasons: ['qualification_missing'] };
        const contextComparison = compareResearchDecisionContexts(originQuestion, submission);
        return {
          id: candidate.recordHash,
          recordHash: candidate.recordHash,
          originRoomId: candidate.originRoomId,
          originQuestionHashes: asArray(candidate.originQuestionHashes),
          kind: candidate.kind || record?.kind || 'research_evidence',
          title: recordTitle(record),
          summary: recordSummary(record),
          createdAt: record?.createdAt || null,
          originalRoomAccepted: candidate.originalRoomAccepted === true,
          qualification,
          deduplication: asText(candidate.deduplication, 'unique_source_record'),
          duplicateRecordHashes,
          duplicateOriginRoomIds: asArray(candidate.duplicateOriginRoomIds),
          duplicateOrigins: asArray(candidate.duplicateOrigins),
          admission: 'requires_current_room_review',
          attachable: record?.kind === RESEARCH_KINDS.priorEvidence
            && qualification.status === 'source_metadata_complete'
            && contextComparison.status !== 'context_unavailable'
            && !attachedRecord,
          attachedRecordHash: attachedRecord?.recordHash || null,
          annotation: record?.evidence?.annotation || null,
          contextComparison,
          sourceVersions: asArray(originRoom?.sourceVersions),
          sourceRecord: record
        };
      })
    : [];
  return {
    schema: 'poolday.prior_room_evidence_projection/v1',
    phase: asText(crossRoomEvidence?.phase, 'idle'),
    sequenceHash: submission?.sequence?.hash || null,
    sequenceMatches,
    registryBoundary: crossRoomEvidence?.registryBoundary || null,
    roomCount: sequenceMatches
      ? asArray(projection?.rooms).filter((room) => room.roomId !== roomId).length
      : 0,
    candidates,
    error: crossRoomEvidence?.error ? asText(crossRoomEvidence.error) : null
  };
};

export const projectCampaignQueue = ({ submission, campaignQueue = {} } = {}) => {
  const projection = campaignQueue?.projection || null;
  const entries = asArray(projection?.entries);
  const current = submission?.sequence?.hash
    ? entries.find((entry) => entry.sequence?.hash === submission.sequence.hash) || null
    : null;
  return {
    schema: 'poolday.room_campaign_queue_projection/v1',
    phase: asText(campaignQueue?.phase, 'idle'),
    policy: projection?.policy || null,
    boundary: projection?.boundary || null,
    complete: projection?.complete === true,
    current,
    eligibleCount: entries.filter((entry) => entry.priority?.eligible).length,
    entries: entries.slice(0, 5),
    error: campaignQueue?.error ? asText(campaignQueue.error) : null
  };
};

export const projectDiscoveryContractCheckpoint = ({ records, submission, cycle } = {}) => {
  if (!submission) return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status: 'question_missing',
    currentInputSet: false,
    canCheckpoint: false,
    latest: null,
    unfrozenRecordHashes: [],
    triggerKinds: []
  };
  const checkpoints = sorted(records.filter((record) => (
    record.kind === RESEARCH_KINDS.discoveryCheckpoint
    && record.checkpoint?.questionHash === submission.recordHash
  )));
  const latestCheckpoint = checkpoints.at(-1) || null;
  const sourceRecords = discoveryContractSourceRecords(records, submission.recordHash);
  const sourceHashes = sourceRecords.map((record) => record.recordHash);
  if (!latestCheckpoint) return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status: 'checkpoint_missing',
    currentInputSet: false,
    canCheckpoint: true,
    latest: null,
    unfrozenRecordHashes: sourceHashes,
    triggerKinds: []
  };
  const frozenInputs = new Set(latestCheckpoint.checkpoint.inputRecordHashes || []);
  const currentInputSet = JSON.stringify(sourceHashes) === JSON.stringify(latestCheckpoint.checkpoint.inputRecordHashes || []);
  const activeSourceHashes = new Set(activeResearchRecords(sourceRecords).map((record) => record.recordHash));
  const invalidatedParentInputHashes = (latestCheckpoint.checkpoint.activeInputRecordHashes || [])
    .filter((hash) => !activeSourceHashes.has(hash));
  const remembered = new Set(cycle?.memory?.acceptedHashes || []);
  const removedDecisionMemoryHashes = (latestCheckpoint.checkpoint.state?.decisionMemory?.acceptedHashes || [])
    .filter((hash) => !remembered.has(hash));
  const unfrozenRecords = sourceRecords.filter((record) => !frozenInputs.has(record.recordHash));
  const triggerKinds = [];
  for (const record of unfrozenRecords) {
    if (record.kind === RESEARCH_KINDS.claim && record.claim?.relation === 'contradicts') triggerKinds.push('contradiction');
    if (record.kind === RESEARCH_KINDS.claim
      && (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')) triggerKinds.push('correction');
    if (record.kind === RESEARCH_KINDS.revocation) triggerKinds.push('revocation');
    if (record.kind === RESEARCH_KINDS.outcome
      && record.replicationOfHash
      && record.outcome?.attempt?.status === 'failed') triggerKinds.push('failed_replication');
  }
  if (invalidatedParentInputHashes.length) triggerKinds.push('policy_active_input_invalidated');
  if (removedDecisionMemoryHashes.length) triggerKinds.push('decision_memory_reopened');
  const prospectiveTriggers = unique(triggerKinds).sort();
  const status = currentInputSet
    ? latestCheckpoint.checkpoint.state?.status === 'reopened' ? 'reopened' : 'current'
    : prospectiveTriggers.length ? 'reopen_required' : 'checkpoint_required';
  return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status,
    currentInputSet,
    canCheckpoint: !currentInputSet,
    latest: {
      recordHash: latestCheckpoint.recordHash,
      createdAt: latestCheckpoint.createdAt,
      stateHash: latestCheckpoint.checkpoint.stateHash,
      projectionId: latestCheckpoint.checkpoint.projection?.id || null,
      projectionArtifactHash: latestCheckpoint.checkpoint.projection?.artifactHash || null,
      parentCheckpointHashes: [...(latestCheckpoint.checkpoint.parentCheckpointHashes || [])],
      inputRecordCount: latestCheckpoint.checkpoint.inputRecordHashes?.length || 0,
      activeInputRecordCount: latestCheckpoint.checkpoint.activeInputRecordHashes?.length || 0,
      decisionMemoryCount: latestCheckpoint.checkpoint.state?.decisionMemory?.acceptedHashes?.length || 0,
      stateStatus: latestCheckpoint.checkpoint.state?.status || 'open'
    },
    unfrozenRecordHashes: unfrozenRecords.map((record) => record.recordHash),
    triggerKinds: prospectiveTriggers.length
      ? prospectiveTriggers
      : [...(latestCheckpoint.checkpoint.state?.reopen?.triggerKinds || [])],
    invalidatedParentInputHashes,
    removedDecisionMemoryHashes
  };
};
