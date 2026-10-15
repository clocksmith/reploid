/**
 * @fileoverview In-memory credit-ledger store for local runs and tests.
 *
 * Transactions run one at a time, read before writing, and stage writes until
 * the operation returns; a failure before commit applies nothing. `state`
 * survives store re-creation so tests can model a process restart.
 */

import { LedgerError, cloneJson } from './domain.js';
import { createLedgerStore } from './engine.js';
import { LEDGER_COLLECTIONS, assertLedgerStoreContract } from './store-contract.js';

export const createMemoryLedgerState = () => ({ tables: new Map() });

/**
 * @param {object} [options]
 * @param {object} [options.state] shared tables from createMemoryLedgerState()
 * @param {object} [options.hooks] test-only fault points: beforeCommit(writes), afterCommit(writes)
 */
export function createMemoryLedgerBackend({ state = createMemoryLedgerState(), hooks = {} } = {}) {
  const table = (name) => {
    if (!LEDGER_COLLECTIONS[name]) throw new TypeError(`Unknown ledger collection: ${name}`);
    if (!state.tables.has(name)) state.tables.set(name, new Map());
    return state.tables.get(name);
  };
  let queue = Promise.resolve();

  const runTransaction = (operation) => {
    const run = queue.then(async () => {
      const writes = [];
      const tx = {
        async get(collection, id) {
          if (writes.length) throw new Error('ledger transactions must read before writing');
          return cloneJson(table(collection).get(id)) ?? null;
        },
        set(collection, id, value) {
          writes.push({ create: false, collection, id, value: cloneJson(value) });
        },
        create(collection, id, value) {
          writes.push({ create: true, collection, id, value: cloneJson(value) });
        }
      };
      const result = await operation(tx);
      for (const write of writes) {
        if (write.create && table(write.collection).has(write.id)) {
          throw new LedgerError('storage_conflict', `${write.collection}/${write.id} already exists`);
        }
      }
      if (hooks.beforeCommit) await hooks.beforeCommit(writes);
      for (const write of writes) table(write.collection).set(write.id, write.value);
      if (hooks.afterCommit) await hooks.afterCommit(writes);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    kind: 'memory',
    state,
    runTransaction,
    async get(collection, id) {
      return cloneJson(table(collection).get(id)) ?? null;
    },
    async list(collection, filter = null) {
      return [...table(collection).values()]
        .filter((record) => !filter || record?.[filter.field] === filter.value)
        .map(cloneJson);
    }
  };
}

export function createMemoryLedgerStore({ state, hooks, ...options } = {}) {
  return assertLedgerStoreContract(createLedgerStore({
    backend: createMemoryLedgerBackend({ state, hooks }),
    ...options
  }));
}

export default createMemoryLedgerStore;
