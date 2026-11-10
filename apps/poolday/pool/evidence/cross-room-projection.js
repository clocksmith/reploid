/** Cross-room projection of public evidence for one exact sequence; original-room acceptance stays provenance. */
import {
  ANNOTATION_EVIDENCE_KINDS,
  CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
  PROTEIN_ANNOTATION_SCOPES,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  EVIDENCE_POLICY,
  SHA256_PATTERN,
  compactText,
  compareResearchRecords,
  hasPublicEvidenceConsent,
  isSha256,
  unique
} from './primitives.js';
import {
  crossRoomSourceIdentityKey
} from './cross-room-normalization.js';
import {
  publicProteinEvidenceProfileOf
} from './scientific-normalization.js';
import {
  activeResearchRecords,
  invalidatedResearchHashes,
  researchRecordTargetHashes
} from './review-state.js';
import {
  projectAcceptedResearchMemory
} from './accepted-memory.js';

const CROSS_ROOM_SNAPSHOT_LIMIT = EVIDENCE_POLICY.crossRoomSnapshotLimit;

const connectedSequenceRoomRecords = (records, roomId, questionHashes) => {
  const roomRecords = records.filter((record) => record.roomId === roomId);
  const roomByHash = new Map(roomRecords.map((record) => [record.recordHash, record]));
  const included = new Set(questionHashes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of roomRecords) {
      const targets = researchRecordTargetHashes(record);
      if (!included.has(record.recordHash) && targets.some((targetHash) => included.has(targetHash))) {
        included.add(record.recordHash);
        changed = true;
      }
      if (!included.has(record.recordHash)) continue;
      for (const targetHash of targets) {
        if (!roomByHash.has(targetHash) || included.has(targetHash)) continue;
        included.add(targetHash);
        changed = true;
      }
    }
  }
  return roomRecords.filter((record) => included.has(record.recordHash)).sort(compareResearchRecords);
};

const sourceVersionProjection = (record) => {
  const reference = record.evidence?.reference || {};
  const provenance = record.evidence?.provenance || {};
  return {
    recordHash: record.recordHash,
    evidenceSchema: record.evidence?.schema || null,
    access: record.evidence?.access || null,
    kind: record.evidence?.kind || null,
    uri: reference.uri || null,
    accession: reference.accession || null,
    version: reference.version || null,
    contentHash: reference.contentHash || null,
    license: provenance.license || null,
    retrievedAt: provenance.retrievedAt || null,
    retrievalMethod: provenance.retrievalMethod || null,
    annotation: record.evidence?.annotation || null,
    finding: record.evidence?.finding || null,
    conditions: record.evidence?.conditions || null,
    transformations: record.evidence?.transformations || []
  };
};

const crossRoomQualification = (record) => {
  const reasons = [];
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    const source = sourceVersionProjection(record);
    if (!source.uri && !source.accession) reasons.push('source_identity_missing');
    if (!source.version && !source.contentHash) reasons.push('source_version_missing');
    if (!source.license) reasons.push('source_license_missing');
    if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
      try {
        publicProteinEvidenceProfileOf(record.evidence);
      } catch {
        reasons.push('public_evidence_contract_invalid');
      }
    }
    if (ANNOTATION_EVIDENCE_KINDS.includes(record.evidence?.kind)) {
      const annotation = record.evidence?.annotation;
      if (!annotation) reasons.push('annotation_identity_missing');
      else {
        if (!PROTEIN_ANNOTATION_SCOPES.includes(annotation.scope)) reasons.push('annotation_scope_missing');
        if (!annotation.ontology?.namespace || !annotation.ontology?.termId) reasons.push('annotation_ontology_identity_missing');
        if (!annotation.ontology?.version) reasons.push('annotation_ontology_version_missing');
        if (!isSha256(annotation.sequence?.hash) || !Number.isInteger(annotation.sequence?.length)) {
          reasons.push('annotation_sequence_identity_missing');
        }
        if (annotation.coordinates?.canonicalSystem !== CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM
          || !Number.isInteger(annotation.coordinates?.start)
          || !Number.isInteger(annotation.coordinates?.end)) reasons.push('annotation_coordinates_missing');
        if (!isSha256(annotation.identityHash)) reasons.push('annotation_identity_hash_missing');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.evidenceLinks?.length) {
    reasons.push('linked_source_license_not_declared');
  }
  if (![RESEARCH_RECORD_KINDS.priorEvidence, RESEARCH_RECORD_KINDS.result].includes(record.kind)) {
    reasons.push('contextual_source_qualification_required');
  }
  return {
    status: reasons.length ? 'needs_source_qualification' : 'source_metadata_complete',
    reasons: unique(reasons)
  };
};

/**
 * Project public evidence connected to one exact sequence across room
 * boundaries. Original-room acceptance is preserved as provenance only: no
 * candidate enters another room's decision memory without a new local review.
 */
export function projectCrossRoomSequenceEvidence(records = [], sequenceHash, {
  currentRoomId = null,
  limit = CROSS_ROOM_SNAPSHOT_LIMIT
} = {}) {
  const normalizedHash = compactText(sequenceHash, 160).toLowerCase();
  if (!SHA256_PATTERN.test(normalizedHash)) throw new TypeError('sequenceHash must be a SHA-256 identity');
  const requestedLimit = Number(limit || CROSS_ROOM_SNAPSHOT_LIMIT);
  if (!Number.isFinite(requestedLimit)) throw new TypeError('limit must be a finite number');
  const boundedLimit = Math.max(1, Math.min(CROSS_ROOM_SNAPSHOT_LIMIT, Math.floor(requestedLimit)));
  const normalizedCurrentRoomId = compactText(currentRoomId, 160) || null;
  const byHash = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.recordHash) continue;
    byHash.set(record.recordHash, record);
  }
  const snapshot = [...byHash.values()].sort(compareResearchRecords).slice(-boundedLimit);
  const submissions = snapshot.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.submission
    && record.sequence?.hash === normalizedHash
    && hasPublicEvidenceConsent(record)
  ));
  const questionsByRoom = new Map();
  for (const submission of submissions) {
    const questions = questionsByRoom.get(submission.roomId) || [];
    questions.push(submission.recordHash);
    questionsByRoom.set(submission.roomId, questions);
  }
  const includedRecords = new Map();
  const rooms = [...questionsByRoom.entries()].map(([roomId, questionHashes]) => {
    const roomRecords = connectedSequenceRoomRecords(snapshot, roomId, questionHashes);
    for (const record of roomRecords) includedRecords.set(record.recordHash, record);
    const active = activeResearchRecords(roomRecords);
    const invalidated = invalidatedResearchHashes(roomRecords);
    const memory = projectAcceptedResearchMemory(roomRecords);
    const sources = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence)
      .map(sourceVersionProjection);
    const sequenceLinks = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.sequenceLink)
      .map((record) => ({
        recordHash: record.recordHash,
        nucleotideSubmissionHash: record.link?.nucleotideSubmissionHash || null,
        proteinSubmissionHash: record.link?.proteinSubmissionHash || null,
        coordinates: record.link?.coordinates || null,
        translation: record.link?.translation || null
      }));
    return {
      roomId,
      currentRoom: Boolean(normalizedCurrentRoomId && roomId === normalizedCurrentRoomId),
      questionHashes: [...questionHashes].sort(),
      archiveRecordHashes: roomRecords.map((record) => record.recordHash),
      activeRecordHashes: active.map((record) => record.recordHash).sort(),
      invalidatedRecordHashes: [...invalidated].sort(),
      acceptedMemoryHashes: [...memory.acceptedHashes],
      memoryExclusions: memory.excluded,
      sourceVersions: sources,
      sequenceLinks
    };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId));
  const roomByAcceptedHash = new Map(rooms.flatMap((room) => (
    room.currentRoom
      ? []
      : room.acceptedMemoryHashes.map((recordHash) => [recordHash, room])
  )));
  const rawCandidates = [...roomByAcceptedHash.entries()].map(([recordHash, room]) => {
    const record = includedRecords.get(recordHash);
    return {
      recordHash,
      originRoomId: room.roomId,
      originQuestionHashes: room.questionHashes,
      kind: record?.kind || null,
      originalRoomAccepted: true,
      qualification: crossRoomQualification(record || {}),
      admission: 'requires_current_room_review'
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const candidateGroups = new Map();
  for (const candidate of rawCandidates) {
    const record = includedRecords.get(candidate.recordHash);
    const groupKey = record?.kind === RESEARCH_RECORD_KINDS.priorEvidence
      && candidate.qualification.status === 'source_metadata_complete'
      ? `source:${crossRoomSourceIdentityKey(record)}`
      : `record:${candidate.recordHash}`;
    const group = candidateGroups.get(groupKey) || [];
    group.push(candidate);
    candidateGroups.set(groupKey, group);
  }
  const candidates = [...candidateGroups.values()].map((group) => {
    const ordered = group.slice().sort((left, right) => compareResearchRecords(
      includedRecords.get(left.recordHash),
      includedRecords.get(right.recordHash)
    ));
    const representative = ordered[0];
    return {
      ...representative,
      deduplication: ordered.length > 1 ? 'same_declared_versioned_source' : 'unique_source_record',
      duplicateRecordHashes: ordered.map((candidate) => candidate.recordHash),
      duplicateOriginRoomIds: unique(ordered.map((candidate) => candidate.originRoomId)).sort(),
      duplicateOrigins: ordered.map((candidate) => ({
        recordHash: candidate.recordHash,
        roomId: candidate.originRoomId,
        questionHashes: candidate.originQuestionHashes
      }))
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const anchor = submissions[0] || null;
  return {
    schema: 'poolday.cross_room_sequence_evidence/v1',
    sequence: {
      hash: normalizedHash,
      alphabet: anchor?.sequence?.alphabet || null,
      length: anchor?.sequence?.length || null,
      value: anchor?.consent?.publicSequence === true ? anchor.sequence?.value || null : null
    },
    currentRoomId: normalizedCurrentRoomId,
    boundary: byHash.size >= boundedLimit ? 'bounded_input_snapshot' : 'input_snapshot',
    complete: byHash.size < boundedLimit,
    inputRecordCount: Array.isArray(records) ? records.length : 0,
    uniqueRecordCount: byHash.size,
    scannedRecordCount: snapshot.length,
    deduplicatedRecordCount: includedRecords.size,
    candidateRecordCount: rawCandidates.length,
    candidateSourceCount: candidates.length,
    rooms,
    candidates,
    records: [...includedRecords.values()].sort(compareResearchRecords)
  };
}
