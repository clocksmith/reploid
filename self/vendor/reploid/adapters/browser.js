export { createMemoryStore, createVfs } from '../artifacts/store.js';
export * from '../artifacts/identity.js';
export * from '../artifacts/receipt.js';
export { default as receipt } from '../artifacts/receipt.js';
import { snapshotJson } from '../config/index.js';

export function createIndexedDbStore({ databaseName, storeName, version, openTimeoutMs,
  indexedDB = globalThis.indexedDB, keyPath = null }) {
  if (typeof databaseName !== 'string' || !databaseName || typeof storeName !== 'string' || !storeName
    || !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1) {
    throw new TypeError('Explicit database name, store name, version and open timeout are required');
  }
  if (!indexedDB?.open) throw new Error('IndexedDB is unavailable');
  let db = null, opening = null, closed = false, cancelOpen = null;
  const transactions = new Set();
  const open = () => {
    if (closed) return Promise.reject(new Error('Store is closed'));
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error('IndexedDB open timed out')), openTimeoutMs);
      const finish = (error, result) => {
        if (settled) { result?.close(); return; }
        settled = true;
        cancelOpen = null;
        clearTimeout(timer);
        if (error || closed) { result?.close(); reject(error || new Error('Store is closed')); }
        else { db = result; db.onversionchange = () => { result.close(); if (db === result) db = null; }; resolve(db); }
      };
      cancelOpen = () => finish(new Error('Store is closed'));
      let request;
      try { request = indexedDB.open(databaseName, version); }
      catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        if (settled || closed) { request.transaction.abort(); return; }
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, keyPath === null ? undefined : { keyPath });
        }
      };
      request.onsuccess = () => finish(null, request.result);
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(new Error('IndexedDB upgrade is blocked'));
    }).finally(() => { opening = null; });
    return opening;
  };
  const transaction = async (mode, operation) => {
    const database = await open();
    if (closed) throw new Error('Store is closed');
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      transactions.add(tx);
      let result;
      tx.oncomplete = () => { transactions.delete(tx); resolve(result); };
      tx.onabort = () => { transactions.delete(tx); reject(tx.error || new Error('IndexedDB transaction aborted')); };
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      try {
        const request = operation(tx.objectStore(storeName));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { tx.abort(); reject(error); }
    });
  };
  return Object.freeze({
    async init() { await open(); return true; },
    async get(key) { return (await transaction('readonly', store => store.get(String(key)))) ?? null; },
    async set(key, value) {
      const data = snapshotJson(value);
      if (keyPath !== null && data[keyPath] !== String(key)) throw new Error('IndexedDB key-path mismatch');
      await transaction('readwrite', store => keyPath === null ? store.put(data, String(key)) : store.put(data));
    },
    async delete(key) { await transaction('readwrite', store => store.delete(String(key))); return true; },
    async keys(prefix = '') { return (await transaction('readonly', store => store.getAllKeys())).map(String).filter(key => key.startsWith(prefix)).sort(); },
    async close() { closed = true; cancelOpen?.(); for (const tx of transactions) { try { tx.abort(); } catch {} } transactions.clear(); if (opening) await opening.catch(() => {}); db?.close(); db = null; }
  });
}
