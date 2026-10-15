/**
 * @fileoverview Firestore credit-ledger store.
 *
 * Every mutation runs in one `firestore.runTransaction`: the account balance,
 * reservation, journal entries, uniqueness claims and idempotency record
 * commit together or not at all. Contending transactions are retried by
 * Firestore and re-read current balances, so concurrent devices cannot
 * overdraw. `transaction.create` makes journal, claim and idempotency
 * documents append-only.
 */

import { cloneJson } from './domain.js';
import { createLedgerStore } from './engine.js';
import { LEDGER_COLLECTIONS, assertLedgerStoreContract } from './store-contract.js';

export function createFirestoreLedgerBackend({ firestore, collectionPrefix = '' } = {}) {
  if (!firestore?.collection || typeof firestore.runTransaction !== 'function') {
    throw new Error('Firestore collection() and runTransaction() are required');
  }
  const prefix = String(collectionPrefix || '').trim();
  const collection = (name) => {
    const physical = LEDGER_COLLECTIONS[name];
    if (!physical) throw new TypeError(`Unknown ledger collection: ${name}`);
    return firestore.collection(prefix ? `${prefix}_${physical}` : physical);
  };
  const ref = (name, id) => collection(name).doc(id);
  const data = (snapshot) => (snapshot.exists ? cloneJson(snapshot.data()) : null);

  return {
    kind: 'firestore',
    runTransaction: (operation) => firestore.runTransaction(async (transaction) => operation({
      get: async (name, id) => data(await transaction.get(ref(name, id))),
      set: (name, id, value) => {
        transaction.set(ref(name, id), cloneJson(value));
      },
      create: (name, id, value) => {
        transaction.create(ref(name, id), cloneJson(value));
      }
    })),
    async get(name, id) {
      return data(await ref(name, id).get());
    },
    async list(name, filter = null) {
      const query = filter ? collection(name).where(filter.field, '==', filter.value) : collection(name);
      const snapshot = await query.get();
      return snapshot.docs.map((entry) => cloneJson(entry.data()));
    }
  };
}

export function createFirestoreLedgerStore({ firestore, collectionPrefix = '', ...options } = {}) {
  return assertLedgerStoreContract(createLedgerStore({
    backend: createFirestoreLedgerBackend({ firestore, collectionPrefix }),
    ...options
  }));
}

export default createFirestoreLedgerStore;
