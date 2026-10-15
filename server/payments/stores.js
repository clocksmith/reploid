/**
 * @fileoverview Memory and Firestore backends for purchase reconciliation.
 *
 * Both reuse the credit ledger's transactional backends over the payment
 * collections, so reconciliation scenarios run identically on either store.
 */

import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { PAYMENT_COLLECTIONS } from './store-contract.js';

export const createMemoryPaymentState = createMemoryLedgerState;

/** `state` survives backend re-creation so tests can model a process restart. */
export const createMemoryPaymentBackend = ({ state, hooks } = {}) => createMemoryLedgerBackend({
  state, hooks, collections: PAYMENT_COLLECTIONS
});

export const createFirestorePaymentBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: PAYMENT_COLLECTIONS
});

export default { createMemoryPaymentState, createMemoryPaymentBackend, createFirestorePaymentBackend };
