/**
 * @fileoverview Persistence-neutral Pool coordinator store contract.
 *
 * Store implementations own persistence and atomicity. They must expose the
 * same coordinator operations so routing and agreement behavior never depends
 * on whether a deployment uses memory or Firestore.
 */

export const POOL_STORE_OPERATIONS = Object.freeze([
  'consumeRateLimit',
  'registerProvider', 'heartbeat', 'listProviders', 'getProvider',
  'createJob', 'updateJob', 'listJobs', 'claimJobForAssignment', 'claimJobForAcceptance', 'getJob',
  'createAssignment', 'updateAssignment', 'getAssignment', 'nextAssignmentForProvider',
  'nextPendingAssignmentForProvider', 'setProviderStatus', 'expireStaleAssignments',
  'saveReceipt', 'getReceipt', 'listReceiptsForJob', 'saveAcceptance',
  'saveAssignmentCommitment', 'getAssignmentCommitment', 'listCommitmentsForJob',
  'saveAssignmentReveal', 'getAssignmentReveal', 'listRevealsForJob',
  'appendPoolEvent', 'listPoolEventsForJob', 'listPoolEventsForProvider', 'appendReputationEvent',
  'createSignalingSession', 'getSignalingSession', 'appendSignalMessage', 'listSignalMessages',
  'appendPeerRoomMessage', 'listPeerRoomMessages', 'listPeerRooms',
  'saveResearchRecord', 'getResearchRecord', 'listResearchRecords',
  'saveAdapterPublication', 'getAdapterPublication', 'listAdapterPublications', 'revokeAdapterPublication',
  'saveAdapterCanaryPublication', 'getAdapterCanaryPublication', 'listAdapterCanaryPublications',
  'appendLedger', 'listLedger', 'getReputation', 'updateReputation',
  'createAuditChallenge', 'getAuditChallenge', 'updateAuditChallenge', 'listAuditChallenges', 'getMetrics'
]);

export function validatePoolStoreContract(store = {}) {
  const missing = POOL_STORE_OPERATIONS.filter((operation) => typeof store[operation] !== 'function');
  return {
    ok: missing.length === 0,
    missing
  };
}

export function assertPoolStoreContract(store = {}) {
  const validation = validatePoolStoreContract(store);
  if (!validation.ok) {
    throw new TypeError(`Pool store contract is incomplete: ${validation.missing.join(', ')}`);
  }
  return store;
}

export default {
  POOL_STORE_OPERATIONS,
  validatePoolStoreContract,
  assertPoolStoreContract
};
