/**
 * @fileoverview Memory and Firestore backends for accounts.
 *
 * Both reuse the credit ledger's transactional backends over the account
 * collections, so account scenarios run identically on either store.
 */

import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { createAccountStore } from './engine.js';
import { ACCOUNT_COLLECTIONS } from './store-contract.js';

export const createMemoryAccountState = createMemoryLedgerState;

/** `state` survives backend re-creation so tests can model a process restart. */
export const createMemoryAccountBackend = ({ state, hooks } = {}) => createMemoryLedgerBackend({
  state, hooks, collections: ACCOUNT_COLLECTIONS
});

export const createFirestoreAccountBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: ACCOUNT_COLLECTIONS
});

export const createMemoryAccountStore = ({ state, hooks, ...options } = {}) => createAccountStore({
  backend: createMemoryAccountBackend({ state, hooks }), ...options
});

export const createFirestoreAccountStore = ({ firestore, collectionPrefix = '', ...options } = {}) => createAccountStore({
  backend: createFirestoreAccountBackend({ firestore, collectionPrefix }), ...options
});

export default {
  createMemoryAccountState,
  createMemoryAccountBackend,
  createFirestoreAccountBackend,
  createMemoryAccountStore,
  createFirestoreAccountStore
};
