/**
 * @fileoverview The room's current result and recovery state: the latest receipt-backed result
 * and the synchronization or review phase the room must recover through.
 */
import { asText, publicationConsent } from './room-projection-records.js';

export const projectResult = (
  result,
  submission,
  reviewStates,
  agreement,
  modelEvidence,
  acceptedCorrections,
  rememberedHashes
) => {
  if (!result) return null;
  const consent = publicationConsent(submission);
  const reviewState = reviewStates.get(result.recordHash)?.state || 'unreviewed';
  return {
    sourceHash: result.recordHash,
    status: acceptedCorrections.has(result.recordHash)
      ? 'corrected'
      : reviewState === 'accepted' && !rememberedHashes.has(result.recordHash)
        ? 'accepted_pending_replication'
        : reviewState,
    embeddingDimensions: result.embedding?.dimensions || result.modelContract?.dimensions || null,
    model: {
      id: result.modelContract?.id || null,
      hash: result.modelContract?.hash || null,
      manifestHash: result.modelContract?.manifestHash || null,
      tokenizerHash: result.modelContract?.tokenizerHash || null,
      runtime: result.modelContract?.runtime || null,
      backend: result.modelContract?.backend || null,
      artifactIdentity: result.modelContract?.artifactIdentity || null
    },
    runtimeIdentity: result.compute?.runtimeProfileHash || result.modelContract?.runtime || null,
    receiptHash: result.compute?.receiptHash || null,
    agreement,
    uncertainty: modelEvidence?.uncertainty?.map((entry) => asText(entry.detail)).filter(Boolean) || [],
    evidenceNextAction: modelEvidence?.nextAction
      ? {
          kind: modelEvidence.nextAction.kind,
          reason: modelEvidence.nextAction.reason,
          targetHash: modelEvidence.nextAction.targetHash
        }
      : null,
    reviewState,
    publication: {
      sequence: consent.sequence,
      embedding: consent.embedding,
      residue: consent.residue
    },
    hasRawEmbedding: consent.embedding && Array.isArray(result.embedding?.values),
    residueEvidencePublished: consent.residue && Boolean(result.sequenceEvidence)
  };
};

const RECOVERY_LABELS = Object.freeze({
  local_only: 'Local-only recovery',
  synchronizing: 'Synchronizing',
  synchronized: 'Synchronized',
  stale: 'Stale coordinator view',
  rejected: 'Rejected records',
  invalidated: 'Invalidated evidence',
  awaiting_review: 'Awaiting review',
  awaiting_replication: 'Awaiting independent execution'
});

export const projectRecovery = ({
  syncState = {},
  invalidatedCount = 0,
  awaitingReview = false,
  awaitingReplication = false,
  activeCount = 0
} = {}) => {
  const phase = ['local_only', 'synchronizing', 'synchronized', 'stale'].includes(syncState.phase)
    ? syncState.phase
    : 'local_only';
  const states = [];
  if (phase === 'stale' && activeCount > 0) states.push('local_only');
  states.push(phase);
  if (Array.isArray(syncState.rejectedRecords) && syncState.rejectedRecords.length) states.push('rejected');
  if (invalidatedCount > 0) states.push('invalidated');
  if (awaitingReview) states.push('awaiting_review');
  if (awaitingReplication) states.push('awaiting_replication');
  const uniqueStates = [...new Set(states)];
  return {
    phase,
    remote: asText(syncState.remote, 'unknown'),
    states: uniqueStates,
    labels: uniqueStates.map((state) => RECOVERY_LABELS[state]),
    rejectedRecords: Array.isArray(syncState.rejectedRecords)
      ? syncState.rejectedRecords.map((entry) => ({ ...entry }))
      : [],
    invalidatedCount,
    remoteError: syncState.remoteError ? asText(syncState.remoteError) : null,
    checkedAt: syncState.checkedAt || null
  };
};
