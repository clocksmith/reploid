/** Native durable attempt claims and signed responses. No execution/admission authority. */
const assert = (ok, message) => { if (!ok) throw new Error(`Pack job journal: ${message}`); };
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
const keyFor = value => JSON.stringify([value.requesterId, value.jobId, value.attemptId]);
const descriptor = value => {
  assert(digest(value?.requesterId) && digest(value.jobHash), 'exact requester and signed job hashes required');
  for (const field of ['jobId', 'attemptId']) assert(typeof value[field] === 'string' && value[field].length > 0
    && value[field].length <= 128, 'bounded attempt identity required');
  assert(Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now()
    && value.expiresAt <= Date.now() + 300000, 'bounded future expiry required');
};

export async function openPackJobJournal({ providerId, name = 'reploid-pack-jobs-v1', maxAttempts = 128,
  maxBytes = 64 * 1024 * 1024, indexedDB = globalThis.indexedDB } = {}) {
  assert(digest(providerId) && indexedDB, 'provider identity and IndexedDB required');
  assert(Number.isSafeInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 256
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 64 * 1024 * 1024, 'invalid storage bounds');
  const opening = indexedDB.open(`${name}:${providerId}`, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('attempts', { keyPath: 'key' });
  const db = await request(opening);
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = async action => {
    assert(!closed, 'closed');
    const tx = db.transaction('attempts', 'readwrite');
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Pack job journal transaction aborted'));
      tx.onerror = () => {};
    });
    finished.catch(() => {});
    try {
      const store = tx.objectStore('attempts');
      // The persisted ledger is bounded independently from in-memory provider state.
      const records = await request(store.getAll(null, 257));
      assert(records.length <= 256, 'record count exceeds protocol ceiling');
      const live = [];
      for (const record of records) {
        assert(record.schema === 'reploid.pack-job-journal/v1' && record.key === keyFor(record)
          && digest(record.requesterId) && digest(record.jobHash) && Number.isSafeInteger(record.expiresAt)
          && Array.isArray(record.updates) && ['running', 'completed', 'failed', 'busy', 'cancelled', 'interrupted'].includes(record.status),
        'corrupt persisted attempt; explicit recovery required');
        if (record.expiresAt <= Date.now()) await request(store.delete(record.key));
        else live.push(record);
      }
      assert(live.length <= maxAttempts && live.reduce((sum, record) => sum + size(record), 0) <= maxBytes, 'persisted budget exceeded');
      const save = async record => {
        const others = live.filter(row => row.key !== record.key);
        assert(others.length < maxAttempts && others.reduce((sum, row) => sum + size(row), size(record)) <= maxBytes, 'durable attempt budget exhausted');
        await request(store.put(record));
        return structuredClone(record);
      };
      const result = await action(live, save);
      await finished;
      assert(!closed, 'closed');
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* Already settled. */ }
      await finished.catch(() => {});
      throw error;
    }
  };
  return {
    async claim(value, owner) {
      descriptor(value); assert(typeof owner === 'string' && owner.length > 0, 'writer identity required');
      return transact(async (records, save) => {
        const key = keyFor(value), prior = records.find(record => record.key === key);
        if (prior) {
          assert(prior.jobHash === value.jobHash, 'attempt was already observed with a different signed envelope');
          // A replacement provider invalidates an unfinished writer. It never
          // assumes another process stopped calculating and never reruns this attempt.
          if (prior.status === 'running' && prior.owner !== owner) {
            return { created: false, record: await save({ ...prior, owner, status: 'interrupted' }) };
          }
          if (['interrupted', 'cancelled'].includes(prior.status)) {
            return { created: false, record: await save({ ...prior, owner }) };
          }
          return { created: false, record: structuredClone(prior) };
        }
        return { created: true, record: await save({ schema: 'reploid.pack-job-journal/v1', key,
          ...value, owner, status: 'running', updates: [] }) };
      });
    },
    async append(value, owner, message) {
      descriptor(value);
      const copy = structuredClone(message);
      return transact(async (records, save) => {
        const prior = records.find(record => record.key === keyFor(value));
        assert(prior && prior.jobHash === value.jobHash && prior.owner === owner, 'attempt writer was superseded');
        const body = copy.body;
        assert(body.jobHash === prior.jobHash && body.updateIndex === prior.updates.length
          && body.previousUpdateHash === (prior.updates.at(-1)?.messageHash ?? null), 'response does not extend durable stream');
        assert(!['completed', 'failed', 'busy'].includes(prior.status)
          && !['completed', 'failed', 'busy', 'cancelled'].includes(prior.updates.at(-1)?.body?.status), 'response after terminal record');
        assert(prior.status === 'running' || ['failed', 'cancelled'].includes(body.status), 'interrupted attempt cannot publish completion');
        assert(['partial', 'completed', 'failed', 'busy', 'cancelled'].includes(body.status), 'invalid response status');
        const next = { ...prior, status: body.status === 'partial' ? 'running' : body.status, updates: [...prior.updates, copy] };
        return save(next);
      });
    },
    async cancel(value, owner) {
      descriptor(value);
      return transact(async (records, save) => {
        const key = keyFor(value), prior = records.find(record => record.key === key);
        assert(!prior || prior.jobHash === value.jobHash, 'cancellation differs from retained attempt');
        if (prior?.status === 'completed') return structuredClone(prior);
        return save({ ...(prior || { schema: 'reploid.pack-job-journal/v1', key, ...value, updates: [] }),
          owner, status: 'cancelled', expiresAt: Math.max(prior?.expiresAt ?? 0, value.expiresAt) });
      });
    },
    async getStats() {
      return transact(records => ({ attempts: records.length, storedBytes: records.reduce((sum, record) => sum + size(record), 0),
        maxAttempts, maxBytes, storage: 'indexeddb', persistence: 'browser-managed' }));
    },
    close() { closed = true; db.close(); }
  };
}
