/**
 * @fileoverview Persistence-neutral Pool coordinator store contract.
 *
 * Store implementations own persistence and atomicity. They must expose the
 * same coordinator operations so routing and agreement behavior never depends
 * on whether a deployment uses memory or Firestore.
 */

// Conservative application storage bounds, not a claim about backend maximums.
export const POOL_SETTLEMENT_STORAGE_BUDGET = Object.freeze({
  maxRecords: 256,
  maxRecordBytes: 512 * 1024,
  maxPlanBytes: 4 * 1024 * 1024
});

export const POOL_STORE_OPERATIONS = Object.freeze([
  'consumeRateLimit', 'getSettlementRecord', 'settleReceiptAcceptance',
  'registerProvider', 'heartbeat', 'listProviders', 'getProvider',
  'createJob', 'updateJob', 'listJobs', 'claimJobForAssignment', 'getJob',
  'createAssignment', 'updateAssignment', 'getAssignment', 'nextAssignmentForProvider',
  'nextPendingAssignmentForProvider', 'setProviderStatus', 'expireStaleAssignments',
  'saveReceipt', 'getReceipt', 'listReceiptsForJob',
  'saveAssignmentCommitment', 'getAssignmentCommitment', 'listCommitmentsForJob',
  'saveAssignmentReveal', 'getAssignmentReveal', 'listRevealsForJob',
  'appendPoolEvent', 'listPoolEventsForJob', 'listPoolEventsForProvider', 'appendReputationEvent',
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
