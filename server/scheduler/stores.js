/**
 * @fileoverview Memory and Firestore backends for the durable scheduler.
 *
 * Both reuse the credit ledger's transactional backends over the scheduler
 * collections, so lease and pass scenarios run identically on either store.
 */

import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { SCHEDULER_COLLECTIONS } from './store-contract.js';

export const createMemorySchedulerState = createMemoryLedgerState;

/** `state` survives backend re-creation so tests can model a process restart. */
export const createMemorySchedulerBackend = ({ state, hooks } = {}) => createMemoryLedgerBackend({
  state, hooks, collections: SCHEDULER_COLLECTIONS
});

export const createFirestoreSchedulerBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: SCHEDULER_COLLECTIONS
});

export default { createMemorySchedulerState, createMemorySchedulerBackend, createFirestoreSchedulerBackend };
