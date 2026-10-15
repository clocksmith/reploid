/**
 * @fileoverview Memory and Firestore backends for Community Access.
 *
 * Both reuse the credit ledger's transactional backends over the Community
 * Access collections, so queue scenarios run identically on either store.
 */

import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { COMMUNITY_ACCESS_COLLECTIONS } from './store-contract.js';

export const createMemoryCommunityAccessState = createMemoryLedgerState;

/** `state` survives backend re-creation so tests can model a process restart. */
export const createMemoryCommunityAccessBackend = ({ state, hooks } = {}) => createMemoryLedgerBackend({
  state, hooks, collections: COMMUNITY_ACCESS_COLLECTIONS
});

export const createFirestoreCommunityAccessBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: COMMUNITY_ACCESS_COLLECTIONS
});

export default { createMemoryCommunityAccessState, createMemoryCommunityAccessBackend, createFirestoreCommunityAccessBackend };
