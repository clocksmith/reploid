/** One cumulative allowance per browser origin; IndexedDB serializes competing tabs. */
import { custodyBudgetError, reserveCustodyBudget } from '../vendor/reploid/artifacts/custody/supply-budget.js';

export async function openBrowserSupplyBudget({ maxBytes, allowInitialize, name = 'reploid-custody-budget-v1', indexedDB = globalThis.indexedDB }) {
  if (!indexedDB) throw custodyBudgetError('STORAGE', 'Persistent file contribution budget unavailable');
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    let rejected = false;
    opening.onupgradeneeded = () => {
      const store = opening.result.createObjectStore('allowance');
      if (allowInitialize) store.put({ schema: 'reploid.custody-supply-budget/v1', maxBytes, reservedBytes: 0 }, 'supply');
    };
    opening.onsuccess = () => { if (rejected) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => reject(custodyBudgetError('STORAGE', 'File contribution ledger cannot open', opening.error));
    opening.onblocked = () => { rejected = true; reject(custodyBudgetError('STORAGE', 'File contribution ledger opening blocked')); };
  });
  let state = null, closed = false;
  const transaction = bytes => new Promise((resolve, reject) => {
    if (closed) { reject(custodyBudgetError('STORAGE', 'File contribution budget closed')); return; }
    let tx, failure, next;
    try {
      tx = db.transaction('allowance', 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('allowance'), read = store.get('supply');
      read.onsuccess = () => {
        try { next = reserveCustodyBudget(read.result, bytes, maxBytes); store.put(next, 'supply'); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { state = next; resolve({ ...state }); };
      tx.onabort = () => reject(failure || custodyBudgetError('STORAGE', 'File contribution reservation not confirmed', tx.error));
      tx.onerror = () => {};
    } catch (cause) { reject(custodyBudgetError('STORAGE', 'File contribution budget transaction failed', cause)); }
  });
  db.onversionchange = () => { closed = true; db.close(); };
  try { await transaction(0); }
  catch (error) { db.close(); throw error; }
  return Object.freeze({ getState: () => state && { ...state }, reserve: transaction,
    close() { if (!closed) { closed = true; db.close(); } } });
}
