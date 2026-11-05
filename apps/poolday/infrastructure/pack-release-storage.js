/** Browser-owned monotonic release checkpoints. Doppler verifies signed history. */
const requireValue = (value, message) => { if (!value) throw new Error(`Pack release storage: ${message}`); };
const valid = checkpoint => Number.isSafeInteger(checkpoint?.sequence) && checkpoint.sequence >= 0
  && (checkpoint.sequence === 0 ? checkpoint.digest === null : /^sha256:[a-f0-9]{64}$/.test(checkpoint.digest));
const same = (left, right) => left.sequence === right.sequence && left.digest === right.digest;

export async function openPackReleaseCheckpoints({ name = 'reploid-pack-releases-v1', indexedDB = globalThis.indexedDB } = {}) {
  requireValue(indexedDB, 'IndexedDB unavailable');
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('checkpoints');
  const db = await new Promise((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = (key, update) => new Promise((resolve, reject) => {
    requireValue(!closed, 'store closed');
    requireValue(/^sha256:[a-f0-9]{64}$/.test(key), 'bounded namespace digest required');
    const transaction = db.transaction('checkpoints', 'readwrite');
    const store = transaction.objectStore('checkpoints');
    let result;
    let failure;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || transaction.error || new Error('Pack release checkpoint transaction aborted'));
    transaction.onerror = () => {};
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        const current = read.result ?? { sequence: 0, digest: null };
        requireValue(valid(current), 'stored checkpoint is invalid');
        result = update(current);
        store.put(result, key);
      } catch (error) { failure = error; transaction.abort(); }
    };
  });
  return {
    read: key => transact(key, current => current),
    advance(key, expected, next) {
      requireValue(valid(expected) && valid(next) && next.sequence > 0, 'valid checkpoints required');
      const prior = structuredClone(expected);
      const observed = structuredClone(next);
      return transact(key, current => {
        if (same(current, observed)) return current;
        requireValue(same(current, prior), 'checkpoint changed during verification');
        requireValue(observed.sequence > current.sequence, 'rollback or fork rejected');
        return observed;
      });
    },
    close() { closed = true; db.close(); }
  };
}
