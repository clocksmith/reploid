/** One cumulative allowance per browser origin; IndexedDB serializes competing tabs. */
import { custodyBudgetError, releaseCustodyBudget, reserveCustodyBudget } from '../../../shared/vendor/reploid/artifacts/custody/supply-budget.js';

export async function openBrowserSupplyBudget({ maxBytes, allowInitialize, purpose = 'supply', existingOnly = false,
  name = purpose === 'supply' ? 'reploid-custody-budget-v1' : 'reploid-custody-acquisition-budget-v1', indexedDB = globalThis.indexedDB }) {
  if (!['supply', 'acquisition'].includes(purpose) || (existingOnly ? allowInitialize || maxBytes !== undefined : !Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
    throw custodyBudgetError('INVALID', 'Invalid persistent transfer allowance');
  }
  if (!indexedDB) throw custodyBudgetError('STORAGE', 'Persistent file contribution budget unavailable');
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, 1);
    let rejected = false, missing = false;
    opening.onupgradeneeded = () => {
      if (existingOnly) { missing = true; opening.transaction.abort(); return; }
      const store = opening.result.createObjectStore('allowance');
      if (allowInitialize) store.put({ schema: `reploid.custody-${purpose}-budget/v1`, maxBytes, reservedBytes: 0 }, purpose);
    };
    opening.onsuccess = () => { if (rejected) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => reject(custodyBudgetError(missing ? 'MISSING' : 'STORAGE', missing ? 'File contribution ledger not created' : 'File contribution ledger cannot open', opening.error));
    opening.onblocked = () => { rejected = true; reject(custodyBudgetError('STORAGE', 'File contribution ledger opening blocked')); };
  });
  let state = null, closed = false;
  const transaction = (bytes, apply = reserveCustodyBudget) => new Promise((resolve, reject) => {
    if (closed) { reject(custodyBudgetError('STORAGE', 'File contribution budget closed')); return; }
    let tx, failure, next;
    try {
      tx = db.transaction('allowance', 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('allowance'), read = store.get(purpose);
      read.onsuccess = () => {
        try {
          if (!read.result) throw custodyBudgetError('MISSING', 'File contribution ledger missing; previous allowance cannot be inferred');
          if (existingOnly && maxBytes === undefined) maxBytes = read.result?.maxBytes;
          next = apply(read.result, bytes, maxBytes, purpose); store.put(next, purpose); }
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
  return Object.freeze({ getState: () => state && { ...state }, reserve: bytes => transaction(bytes),
    // Only a download allowance returns bytes: those a failed transfer reserved and never received.
    ...(purpose === 'acquisition' ? { release: bytes => transaction(bytes, releaseCustodyBudget) } : {}),
    close() { if (!closed) { closed = true; db.close(); } } });
}

/** Separate cumulative download grant: every byte received stays counted, through failures and retries; a failed
 * transfer returns only the reserved bytes that never arrived (release), so a retry can fetch what is missing. */
export const openBrowserAcquisitionBudget = options => openBrowserSupplyBudget({ ...options, purpose: 'acquisition' });
