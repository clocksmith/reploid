/**
 * @fileoverview Persistence-neutral credit-ledger store contract.
 *
 * Memory and Firestore implementations expose the same operations over the
 * same transitions; only the transactional backend differs.
 */

export const LEDGER_STORE_OPERATIONS = Object.freeze([
  'openAccount', 'getAccount', 'issueCredits', 'getLot',
  'createQuote', 'getQuote', 'acceptQuote',
  'bindAttempt', 'recordAttemptOutcome', 'getReservation', 'listReservations',
  'settleReservation', 'resolveQualityReview', 'getQualityReview', 'refundSettlement',
  'reverseIssuance', 'getReversal',
  'recordFundingCommitment', 'getFundingCommitment', 'allocateFunding', 'releaseFundingAllocation',
  'getFundingAllocation', 'listFundingAllocations',
  'expireReservations', 'transferCredits', 'listJournal', 'auditAccount', 'getSolvencySnapshot'
]);

// A backend runs `runTransaction(operation)` where operation receives
// { get(collection, id), set(collection, id, value), create(collection, id, value) },
// reads before writes, and commits every write atomically or none.
export const LEDGER_BACKEND_OPERATIONS = Object.freeze(['runTransaction', 'get', 'list']);

// Logical collection -> physical collection. Separate from Poolday points and
// compute/resource collections by name and authority.
export const LEDGER_COLLECTIONS = Object.freeze({
  accounts: 'credit_accounts',
  lots: 'credit_lots',
  quotes: 'credit_quotes',
  reservations: 'credit_reservations',
  reviews: 'credit_quality_reviews',
  journal: 'credit_journal',
  reversals: 'credit_reversals',
  commitments: 'credit_funding_commitments',
  allocations: 'credit_funding_allocations',
  claims: 'credit_claims',
  idempotency: 'credit_idempotency'
});

const missingOperations = (target, operations) => operations.filter((operation) => typeof target?.[operation] !== 'function');

export function validateLedgerStoreContract(store) {
  const missing = missingOperations(store, LEDGER_STORE_OPERATIONS);
  return { ok: missing.length === 0, missing };
}

export function assertLedgerStoreContract(store) {
  const { ok, missing } = validateLedgerStoreContract(store);
  if (!ok) throw new TypeError(`Credit ledger store contract is incomplete: ${missing.join(', ')}`);
  return store;
}

export function assertLedgerBackend(backend) {
  const missing = missingOperations(backend, LEDGER_BACKEND_OPERATIONS);
  if (missing.length) throw new TypeError(`Credit ledger backend is incomplete: ${missing.join(', ')}`);
  return backend;
}

export default {
  LEDGER_STORE_OPERATIONS,
  LEDGER_BACKEND_OPERATIONS,
  LEDGER_COLLECTIONS,
  validateLedgerStoreContract,
  assertLedgerStoreContract,
  assertLedgerBackend
};
