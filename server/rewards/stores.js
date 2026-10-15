/**
 * @fileoverview Memory and Firestore backends for contribution rewards.
 *
 * Both reuse the credit ledger's transactional backends over the reward
 * collections, so reward scenarios run identically on either store.
 */

import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { REWARD_COLLECTIONS } from './store-contract.js';

export const createMemoryRewardState = createMemoryLedgerState;

/** `state` survives backend re-creation so tests can model a process restart. */
export const createMemoryRewardBackend = ({ state, hooks } = {}) => createMemoryLedgerBackend({
  state, hooks, collections: REWARD_COLLECTIONS
});

export const createFirestoreRewardBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: REWARD_COLLECTIONS
});

export default { createMemoryRewardState, createMemoryRewardBackend, createFirestoreRewardBackend };
