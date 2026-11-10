/**
 * @fileoverview The room's complete evidence archive: every admitted, corrected, revoked,
 * invalidated or quarantined record with its archive state. Nothing is dropped.
 */
import { revokedResearchHashes } from '../../pool/evidence-network.js';
import { RESEARCH_KINDS, asText, sorted, recordTitle, recordSummary } from './room-projection-records.js';

export const acceptedCorrectionsByTarget = (active, reviewStates) => new Map(
  active
    .filter((record) => record.kind === RESEARCH_KINDS.claim)
    .filter((record) => record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')
    .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted')
    .map((record) => [record.targetHash, record])
);

export const statusForRecord = (record, reviewStates, invalidated, acceptedCorrections) => {
  if (invalidated.has(record.recordHash)) return 'invalidated';
  if (acceptedCorrections.has(record.recordHash)) return 'corrected';
  return reviewStates.get(record.recordHash)?.state || 'unreviewed';
};

const isCorrection = (record = {}) => record.kind === RESEARCH_KINDS.claim
  && (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects');

const archiveStateForRecord = ({
  record,
  reviewStates,
  invalidated,
  revoked,
  acceptedCorrections
}) => {
  if (revoked.has(record.recordHash)) return 'revoked';
  if (invalidated.has(record.recordHash)) return 'invalidated';
  if (acceptedCorrections.has(record.recordHash)) return 'superseded';
  if (record.kind === RESEARCH_KINDS.revocation) return 'revocation_recorded';
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) return 'checkpointed';
  if (record.kind === RESEARCH_KINDS.outcome && record.outcome?.attempt?.status === 'failed') return 'failed';
  const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
  if (isCorrection(record) && reviewState === 'accepted') return 'corrected';
  if (['accepted', 'rejected', 'needs_revision', 'replication_requested', 'disputed'].includes(reviewState)) {
    return reviewState;
  }
  return 'provisional';
};

const dedupeQuarantine = (quarantinedRecords = [], rejectedRecords = []) => {
  const entries = new Map();
  for (const candidate of [...rejectedRecords, ...quarantinedRecords]) {
    const record = candidate?.record && typeof candidate.record === 'object' ? candidate.record : null;
    const recordHash = asText(candidate?.recordHash || record?.recordHash, null);
    const reason = asText(candidate?.reason, 'Rejected by verification or admission policy');
    const key = `${recordHash || 'unknown'}:${reason}`;
    entries.set(key, {
      id: `quarantine:${key}`,
      recordHash,
      claimedKind: asText(record?.kind, null),
      claimedCreatedAt: asText(record?.createdAt, null),
      reason,
      quarantinedAt: asText(candidate?.quarantinedAt, null),
      state: 'rejected',
      provenance: 'verification_quarantine'
    });
  }
  return [...entries.values()].sort((left, right) => (
    asText(left.claimedCreatedAt).localeCompare(asText(right.claimedCreatedAt))
    || asText(left.recordHash).localeCompare(asText(right.recordHash))
  ));
};

const countArchiveStates = (entries = []) => entries.reduce((counts, entry) => ({
  ...counts,
  [entry.state]: (counts[entry.state] || 0) + 1
}), {});

export function projectCompleteEvidenceArchive({
  roomId,
  records = [],
  reviewStates = new Map(),
  invalidated = new Set(),
  acceptedCorrections = new Map(),
  rememberedHashes = new Set(),
  memoryExclusions = [],
  quarantinedRecords = [],
  syncState = {}
} = {}) {
  const revoked = revokedResearchHashes(records);
  const exclusionsByHash = new Map(memoryExclusions.map((entry) => [entry.recordHash, entry]));
  const entries = sorted(records).map((record) => {
    const exclusion = exclusionsByHash.get(record.recordHash) || null;
    const correction = acceptedCorrections.get(record.recordHash) || null;
    return {
      id: record.recordHash,
      recordHash: record.recordHash,
      kind: record.kind,
      state: archiveStateForRecord({ record, reviewStates, invalidated, revoked, acceptedCorrections }),
      title: recordTitle(record),
      summary: recordSummary(record),
      createdAt: record.createdAt || null,
      provenance: {
        authority: 'signed_research_record',
        authorRole: record.author?.role || record.author?.roleId || null,
        authorIdentityRootId: record.author?.identityRootId || null,
        signatureDomain: record.signatureDomain || null
      },
      decisionMemoryAdmitted: rememberedHashes.has(record.recordHash),
      decisionMemoryExclusionReason: exclusion?.reason || null,
      supersededByHash: correction?.recordHash || exclusion?.supersededByHash || null
    };
  });
  const rejected = dedupeQuarantine(quarantinedRecords, syncState.rejectedRecords || []);
  const phase = ['local_only', 'synchronizing', 'synchronized', 'stale'].includes(syncState.phase)
    ? syncState.phase
    : 'local_only';
  return {
    schema: 'poolday.complete_room_evidence_archive/v1',
    roomId: asText(roomId, 'reploid-default'),
    boundary: phase === 'synchronized'
      ? 'verified_local_and_coordinator_snapshot'
      : phase === 'synchronizing'
        ? 'verified_local_snapshot_coordinator_pending'
        : phase === 'stale'
          ? 'verified_local_snapshot_coordinator_stale'
          : 'verified_local_snapshot',
    immutableRecordHashes: entries.map((entry) => entry.recordHash),
    entries,
    rejected,
    stateCounts: countArchiveStates([...entries, ...rejected])
  };
}
