import {
  REPUTATION_EVENT_TYPES,
  reduceReputationEvents
} from '../../self/pool/reputation.js';

const evidenceFields = [
  'acceptedReceipts',
  'rejectedReceipts',
  'timeouts',
  'canaryPasses',
  'canaryFailures',
  'challengePasses',
  'challengeFailures',
  'quorumMatches',
  'quorumMismatches',
  'policyViolations',
  'points'
];

export const hasLegacyReputationEvidence = (state = {}) => (
  evidenceFields.some((field) => Number(state[field] || 0) !== 0)
  || Number(state.passedCanaries || 0) !== 0
  || Number(state.failedCanaries || 0) !== 0
);

export const reputationEventIdFor = (event = {}) => {
  const sourceId = event.receiptHash
    || event.auditId
    || event.assignmentId
    || event.agreementHash
    || event.jobId
    || null;
  if (!event.type || !event.providerId || !sourceId) return null;
  return ['reputation', event.type, event.providerId, sourceId]
    .map((part) => String(part).replace(/[^a-z0-9_-]/gi, '_'))
    .join('_');
};

export const createReputationSeedEvent = (providerId, state = {}) => ({
  eventId: `reputation_seed_${String(providerId).replace(/[^a-z0-9_-]/gi, '_')}`,
  type: REPUTATION_EVENT_TYPES.seed,
  category: 'reputation',
  providerId,
  acceptedReceipts: Number(state.acceptedReceipts || 0),
  rejectedReceipts: Number(state.rejectedReceipts || 0),
  timeouts: Number(state.timeouts || 0),
  canaryPasses: Number(state.canaryPasses ?? state.passedCanaries ?? 0),
  canaryFailures: Number(state.canaryFailures ?? state.failedCanaries ?? 0),
  challengePasses: Number(state.challengePasses || 0),
  challengeFailures: Number(state.challengeFailures || 0),
  quorumMatches: Number(state.quorumMatches || 0),
  quorumMismatches: Number(state.quorumMismatches || 0),
  policyViolations: Number(state.policyViolations || 0),
  points: Number(state.points || 0),
  metadata: { migratedFromProjection: true }
});

export function projectProviderReputation(providerId, events = [], current = {}) {
  if (!events.length) return { ...current, providerId };
  const reduced = reduceReputationEvents(events).providers[providerId] || { providerId };
  let routingBlocked = false;
  let quarantineReason = null;
  let lastRejectionReasons = [];
  let lastCanaryAt = null;
  let lastCanaryReasons = [];
  let lastChallengeAt = null;
  let lastChallengeReasons = [];
  const ordered = [...events].sort((left, right) => {
    const timeOrder = String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
    return timeOrder || String(left.eventId || '').localeCompare(String(right.eventId || ''));
  });
  for (const event of ordered) {
    if (event.routingBlocked === true) routingBlocked = true;
    if (event.quarantineReason) quarantineReason = event.quarantineReason;
    if (event.clearRoutingBlock === true) routingBlocked = false;
    if (Array.isArray(event.clearQuarantineReasons) && event.clearQuarantineReasons.includes(quarantineReason)) {
      quarantineReason = null;
    }
    if (Array.isArray(event.reasons) && event.reasons.length > 0) lastRejectionReasons = event.reasons;
    if (event.type === REPUTATION_EVENT_TYPES.canaryPassed || event.type === REPUTATION_EVENT_TYPES.canaryFailed) {
      lastCanaryAt = event.createdAt || null;
      lastCanaryReasons = Array.isArray(event.reasons) ? event.reasons : [];
    }
    if (event.type === REPUTATION_EVENT_TYPES.challengePassed || event.type === REPUTATION_EVENT_TYPES.challengeFailed) {
      lastChallengeAt = event.createdAt || null;
      lastChallengeReasons = Array.isArray(event.reasons) ? event.reasons : [];
    }
  }
  const auditBlocks = [];
  if (Number(reduced.canaryFailures || 0) > Number(reduced.canaryPasses || 0)) {
    auditBlocks.push('canary_failed');
  }
  if (Number(reduced.challengeFailures || 0) > Number(reduced.challengePasses || 0)) {
    auditBlocks.push('challenge_failed');
  }
  if (auditBlocks.length > 0) {
    routingBlocked = true;
    quarantineReason = auditBlocks.at(-1);
  } else if (quarantineReason === 'canary_failed' || quarantineReason === 'challenge_failed') {
    routingBlocked = false;
    quarantineReason = null;
  }
  if (Number(reduced.policyViolations || 0) > 0) {
    routingBlocked = true;
    quarantineReason ||= 'model_or_runtime_identity_violation';
  } else if (Number(reduced.rejectedReceipts || 0) >= 3) {
    routingBlocked = true;
    quarantineReason ||= 'repeated_rejected_receipts';
  } else if (Number(reduced.timeouts || 0) >= 3) {
    routingBlocked = true;
    quarantineReason ||= 'repeated_assignment_timeouts';
  }
  return {
    ...current,
    ...reduced,
    providerId,
    routingBlocked,
    quarantineReason,
    lastRejectionReasons,
    lastCanaryAt,
    lastCanaryReasons,
    lastChallengeAt,
    lastChallengeReasons
  };
}

export default {
  hasLegacyReputationEvidence,
  reputationEventIdFor,
  createReputationSeedEvent,
  projectProviderReputation
};
