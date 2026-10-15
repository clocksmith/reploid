/**
 * @fileoverview Persistence-neutral Community Access store contract.
 *
 * Funding, queue, usage and rate records live in their own collections on a
 * transactional document backend with the credit ledger's backend shape.
 * Pool balances, reservations and settlement stay in the ledger.
 */

import { assertLedgerBackend } from '../ledger/store-contract.js';

export const COMMUNITY_ACCESS_OPERATIONS = Object.freeze([
  'recordFunding', 'getFunding', 'resumeFunding', 'expireQueue', 'requestAccess', 'getRequest', 'describeAvailability', 'admitWaiting',
  'getSubsidyReport'
]);

// Logical collection -> physical collection.
export const COMMUNITY_ACCESS_COLLECTIONS = Object.freeze({
  fundings: 'community_access_fundings',
  entries: 'community_access_requests',
  usage: 'community_access_usage',
  counters: 'community_access_rate_counters',
  occupancy: 'community_access_occupancy'
});

export function validateCommunityAccessContract(store) {
  const missing = COMMUNITY_ACCESS_OPERATIONS.filter((operation) => typeof store?.[operation] !== 'function');
  return { ok: missing.length === 0, missing };
}

export function assertCommunityAccessContract(store) {
  const { ok, missing } = validateCommunityAccessContract(store);
  if (!ok) throw new TypeError(`Community Access store contract is incomplete: ${missing.join(', ')}`);
  return store;
}

export const assertCommunityAccessBackend = (backend) => assertLedgerBackend(backend);

export default {
  COMMUNITY_ACCESS_OPERATIONS,
  COMMUNITY_ACCESS_COLLECTIONS,
  validateCommunityAccessContract,
  assertCommunityAccessContract,
  assertCommunityAccessBackend
};
