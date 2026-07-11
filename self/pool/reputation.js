/**
 * @fileoverview Client helpers for pool reputation display.
 */

export const REPUTATION_REDUCER_VERSION = 'poolday.reputation.reducer.v1';
export const REPUTATION_EVENT_TYPES = Object.freeze({
  seed: 'reputation_seed',
  providerAdvertised: 'provider_advertised',
  assignmentAccepted: 'assignment_accepted',
  commitReceived: 'commit_received',
  revealReceived: 'reveal_received',
  receiptValidated: 'receipt_validated',
  quorumMatch: 'quorum_match',
  quorumMismatch: 'quorum_mismatch',
  canaryPassed: 'canary_passed',
  canaryFailed: 'canary_failed',
  challengePassed: 'challenge_passed',
  challengeFailed: 'challenge_failed',
  requesterAccepted: 'requester_accepted',
  requesterDisputed: 'requester_disputed',
  timeout: 'timeout',
  staleAssignment: 'stale_assignment',
  policyViolation: 'policy_violation'
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value || 0)));

const eventDedupeKey = (event = {}) => (
  event.eventHash
  || event.eventId
  || [
    event.type,
    event.providerId,
    event.assignmentId,
    event.receiptHash,
    event.agreementHash,
    event.createdAt
  ].map((part) => String(part || '')).join(':')
);

const emptyProviderState = (providerId) => ({
  providerId,
  acceptedReceipts: 0,
  rejectedReceipts: 0,
  timeouts: 0,
  canaryPasses: 0,
  canaryFailures: 0,
  challengePasses: 0,
  challengeFailures: 0,
  quorumMatches: 0,
  quorumMismatches: 0,
  policyViolations: 0,
  points: 0,
  lastEventAt: null
});

const applyEvent = (state, event = {}) => {
  const next = { ...state };
  const type = event.type || event.eventType;
  const points = Number(event.points || 0);
  if (points) next.points += points;
  if (event.createdAt) next.lastEventAt = event.createdAt;
  switch (type) {
    case REPUTATION_EVENT_TYPES.seed:
      next.acceptedReceipts += Number(event.acceptedReceipts || 0);
      next.rejectedReceipts += Number(event.rejectedReceipts || 0);
      next.timeouts += Number(event.timeouts || 0);
      next.canaryPasses += Number(event.canaryPasses ?? event.passedCanaries ?? 0);
      next.canaryFailures += Number(event.canaryFailures ?? event.failedCanaries ?? 0);
      next.challengePasses += Number(event.challengePasses || 0);
      next.challengeFailures += Number(event.challengeFailures || 0);
      next.quorumMatches += Number(event.quorumMatches || 0);
      next.quorumMismatches += Number(event.quorumMismatches || 0);
      next.policyViolations += Number(event.policyViolations || 0);
      break;
    case REPUTATION_EVENT_TYPES.receiptValidated:
    case REPUTATION_EVENT_TYPES.requesterAccepted:
      next.acceptedReceipts += 1;
      break;
    case REPUTATION_EVENT_TYPES.quorumMatch:
      next.quorumMatches += 1;
      break;
    case REPUTATION_EVENT_TYPES.quorumMismatch:
      next.quorumMismatches += 1;
      next.rejectedReceipts += 1;
      break;
    case REPUTATION_EVENT_TYPES.canaryPassed:
      next.canaryPasses += 1;
      break;
    case REPUTATION_EVENT_TYPES.canaryFailed:
      next.canaryFailures += 1;
      next.rejectedReceipts += 1;
      break;
    case REPUTATION_EVENT_TYPES.challengePassed:
      next.challengePasses += 1;
      break;
    case REPUTATION_EVENT_TYPES.challengeFailed:
      next.challengeFailures += 1;
      next.rejectedReceipts += 1;
      break;
    case REPUTATION_EVENT_TYPES.timeout:
    case REPUTATION_EVENT_TYPES.staleAssignment:
      next.timeouts += 1;
      break;
    case REPUTATION_EVENT_TYPES.policyViolation:
      next.policyViolations += 1;
      next.rejectedReceipts += 1;
      break;
    case REPUTATION_EVENT_TYPES.requesterDisputed:
      next.rejectedReceipts += 1;
      break;
    default:
      break;
  }
  return next;
};

export function scoreReputationState(state = {}) {
  const positive = Number(state.acceptedReceipts || 0)
    + Number(state.canaryPasses || 0)
    + Number(state.challengePasses || 0)
    + Number(state.quorumMatches || 0);
  const negative = Number(state.rejectedReceipts || 0)
    + Number(state.timeouts || 0)
    + Number(state.canaryFailures || 0)
    + Number(state.challengeFailures || 0)
    + Number(state.quorumMismatches || 0)
    + Number(state.policyViolations || 0);
  const total = positive + negative;
  const score = total > 0 ? positive / total : 0;
  return {
    score: clamp01(score),
    totalEvidence: total,
    routingEligible: negative === 0 || score >= 0.6,
    ringEligible: total >= 3 && score >= 0.75 && Number(state.policyViolations || 0) === 0
  };
}

export function reduceReputationEvents(events = []) {
  const seen = new Set();
  const providers = new Map();
  const ordered = [...events].sort((left, right) => {
    const leftTime = String(left.createdAt || '');
    const rightTime = String(right.createdAt || '');
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return eventDedupeKey(left).localeCompare(eventDedupeKey(right));
  });
  for (const event of ordered) {
    const providerId = event.providerId || event.body?.providerId || null;
    if (!providerId) continue;
    const key = eventDedupeKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = providers.get(providerId) || emptyProviderState(providerId);
    providers.set(providerId, applyEvent(current, event));
  }
  const states = Object.fromEntries([...providers.entries()].map(([providerId, state]) => [
    providerId,
    {
      ...state,
      passedCanaries: state.canaryPasses,
      failedCanaries: state.canaryFailures,
      reducerVersion: REPUTATION_REDUCER_VERSION,
      ...scoreReputationState(state)
    }
  ]));
  return {
    reducerVersion: REPUTATION_REDUCER_VERSION,
    providers: states,
    eventCount: seen.size
  };
}

export function summarizeReputation(state = {}) {
  const accepted = Number(state.acceptedReceipts || 0);
  const rejected = Number(state.rejectedReceipts || 0);
  const timeouts = Number(state.timeouts || 0);
  const total = accepted + rejected + timeouts;
  const score = total > 0 ? accepted / total : 0;
  return {
    providerId: state.providerId || null,
    score,
    acceptedReceipts: accepted,
    rejectedReceipts: rejected,
    timeouts,
    routingEligible: score >= 0 || total === 0
  };
}

export default {
  REPUTATION_REDUCER_VERSION,
  REPUTATION_EVENT_TYPES,
  reduceReputationEvents,
  scoreReputationState,
  summarizeReputation
};
