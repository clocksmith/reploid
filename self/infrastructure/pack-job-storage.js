/** Native atomic attempt storage. Poolday supplies resolved policy and verifies signed evidence. */
const assert = (ok, message) => { if (!ok) throw new Error(`Pack job journal: ${message}`); };
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});
const keyFor = value => JSON.stringify([value.requesterId, value.jobId, value.attemptId]);

export async function openPackJobJournal({ providerId, policy: policyInput, name, maxAttempts, maxBytes,
  indexedDB = globalThis.indexedDB } = {}) {
  const policy = structuredClone(policyInput);
  assert(digest(providerId) && indexedDB && policy, 'provider identity, resolved policy and IndexedDB required');
  for (const field of ['databaseVersion', 'maxRecords', 'recordCeiling', 'maxSavedBytes', 'byteCeiling',
    'retentionMs', 'maxFutureMs', 'maxIdentityCharacters', 'storageTimeoutMs']) {
    assert(Number.isSafeInteger(policy[field]) && policy[field] > 0, `policy.${field} required`);
  }
  assert(policy.storageFailureBehavior === 'reject' && policy.durability === 'strict'
    && policy.cleanup === 'expire-then-delete-after-retention', 'unsupported storage policy');
  name = name === undefined ? policy.databaseName : name;
  maxAttempts = maxAttempts === undefined ? policy.maxRecords : maxAttempts;
  maxBytes = maxBytes === undefined ? policy.maxSavedBytes : maxBytes;
  assert(typeof name === 'string' && name.length > 0 && typeof policy.storeName === 'string'
    && Number.isSafeInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= policy.recordCeiling
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= policy.byteCeiling, 'invalid storage bounds');
  const descriptor = input => {
    const value = structuredClone(input);
    assert(digest(value?.requesterId) && digest(value.jobHash), 'exact requester and signed job hashes required');
    for (const field of ['jobId', 'attemptId']) assert(typeof value[field] === 'string' && value[field].length > 0
      && value[field].length <= policy.maxIdentityCharacters, 'bounded attempt identity required');
    assert(Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now()
      && value.expiresAt <= Date.now() + policy.maxFutureMs, 'bounded future expiry required');
    assert(value.binding === null || (value.binding && digest(value.binding.requestHash)
      && typeof value.binding.assignmentId === 'string' && Number.isSafeInteger(value.binding.attemptNumber)
      && value.binding.attemptNumber > 0 && value.binding.operation && value.binding.model && Array.isArray(value.binding.adapterSet)), 'explicit immutable attempt binding required');
    return { requesterId: value.requesterId, jobId: value.jobId, attemptId: value.attemptId,
      jobHash: value.jobHash, expiresAt: value.expiresAt, binding: value.binding };
  };
  const opening = indexedDB.open(`${name}:${providerId}`, policy.databaseVersion);
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => fail(new Error('Pack job journal open deadline exceeded')), policy.storageTimeoutMs);
    opening.onupgradeneeded = () => {
      if (settled) { opening.transaction.abort(); return; }
      if (!opening.result.objectStoreNames.contains(policy.storeName)) opening.result.createObjectStore(policy.storeName, { keyPath: 'key' });
    };
    opening.onblocked = () => fail(new Error('Pack job journal upgrade blocked'));
    opening.onerror = () => fail(opening.error);
    opening.onsuccess = () => {
      if (settled) { opening.result.close(); return; }
      settled = true; clearTimeout(timer); resolve(opening.result);
    };
  });
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = async action => {
    assert(!closed, 'closed');
    const tx = db.transaction(policy.storeName, 'readwrite', { durability: policy.durability });
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* Already settled. */ } }, policy.storageTimeoutMs);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = () => { clearTimeout(timer); resolve(); };
      tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Pack job journal transaction aborted')); };
      tx.onerror = () => {};
    });
    finished.catch(() => {});
    try {
      const store = tx.objectStore(policy.storeName);
      const records = await request(store.getAll(null, policy.recordCeiling + 1));
      assert(records.length <= policy.recordCeiling, 'record count exceeds protocol ceiling');
      const live = [];
      for (let record of records) {
        assert(record.key === keyFor(record) && digest(record.requesterId) && digest(record.jobHash)
          && Number.isSafeInteger(record.expiresAt) && Array.isArray(record.updates), 'corrupt persisted attempt; explicit recovery required');
        if (record.schema === policy.legacyRecordSchema) {
          assert(Object.hasOwn(policy.legacyStates, record.status), 'unknown legacy attempt state');
          record = { ...record, schema: policy.recordSchema, status: policy.legacyStates[record.status],
            outcome: record.updates.at(-1)?.body?.status ?? 'legacy-interrupted', binding: null,
            retainUntil: record.expiresAt + policy.retentionMs };
          await request(store.put(record));
        }
        assert(record.schema === policy.recordSchema && policy.states.includes(record.status)
          && Number.isSafeInteger(record.retainUntil) && record.retainUntil >= record.expiresAt, 'corrupt persisted state');
        if (record.retainUntil <= Date.now()) { await request(store.delete(record.key)); continue; }
        if (record.expiresAt <= Date.now() && record.status !== 'expired') {
          record = { ...record, status: 'expired' }; await request(store.put(record));
        }
        live.push(record);
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
  const find = (records, value, owner) => {
    const prior = records.find(record => record.key === keyFor(value));
    assert(prior && prior.jobHash === value.jobHash && prior.owner === owner, 'attempt writer was superseded');
    assert(JSON.stringify(prior.binding) === JSON.stringify(value.binding), 'immutable attempt binding changed');
    return prior;
  };
  return {
    async claim(input, owner) {
      const value = descriptor(input);
      assert(value.binding !== null && typeof owner === 'string' && owner.length > 0, 'attempt binding and writer required');
      return transact(async (records, save) => {
        const key = keyFor(value);
        let prior = records.find(record => record.key === key);
        if (prior) {
          assert(prior.jobHash === value.jobHash, 'attempt was already observed with a different signed envelope');
          assert(prior.status !== 'expired', 'attempt expired');
          assert(prior.binding === null || JSON.stringify(prior.binding) === JSON.stringify(value.binding), 'immutable attempt binding changed');
          prior = { ...prior, binding: value.binding, expiresAt: value.expiresAt };
          if (['accepted', 'running'].includes(prior.status) && prior.owner !== owner) {
            prior = { ...prior, owner, status: 'interrupted', outcome: 'provider-replaced' };
          }
          if (['interrupted', 'cancelled'].includes(prior.status)) prior.owner = owner;
          return { created: false, record: await save(prior) };
        }
        return { created: true, record: await save({ schema: policy.recordSchema, key, ...value, owner,
          status: 'accepted', outcome: null, retainUntil: value.expiresAt + policy.retentionMs, updates: [] }) };
      });
    },
    async markRunning(input, owner) {
      const value = descriptor(input);
      return transact(async (records, save) => {
        const prior = find(records, value, owner);
        assert(prior.status === 'accepted' && prior.updates.length === 0, 'only accepted attempt can start');
        return save({ ...prior, status: 'running' });
      });
    },
    async append(input, owner, message) {
      const value = descriptor(input), copy = structuredClone(message);
      return transact(async (records, save) => {
        const prior = find(records, value, owner), body = copy.body;
        assert(body.jobHash === prior.jobHash && body.requestHash === prior.binding.requestHash
          && body.updateIndex === prior.updates.length
          && body.previousUpdateHash === (prior.updates.at(-1)?.messageHash ?? null), 'response does not extend durable stream');
        assert(prior.status !== 'expired' && !['completed', 'failed', 'busy', 'cancelled'].includes(prior.updates.at(-1)?.body?.status), 'response after terminal record');
        assert(prior.status === 'running' || ['failed', 'busy', 'cancelled'].includes(body.status), 'unstarted or interrupted attempt cannot publish completion');
        assert(Object.hasOwn(policy.outcomeStates, body.status), 'invalid response status');
        return save({ ...prior, status: policy.outcomeStates[body.status], outcome: body.status, updates: [...prior.updates, copy] });
      });
    },
    async cancel(input, owner) {
      const value = descriptor(input);
      return transact(async (records, save) => {
        const key = keyFor(value), prior = records.find(record => record.key === key);
        assert(!prior || prior.jobHash === value.jobHash, 'cancellation differs from retained attempt');
        if (prior?.status === 'expired' || ['completed', 'failed', 'busy', 'cancelled'].includes(prior?.updates.at(-1)?.body?.status)) return structuredClone(prior);
        return save({ schema: policy.recordSchema, key, ...value, updates: [], ...prior, owner, status: 'cancelled',
          outcome: 'requester-cancelled', retainUntil: Math.max(prior?.retainUntil ?? 0, value.expiresAt + policy.retentionMs) });
      });
    },
    async getStats() {
      return transact(records => ({ attempts: records.length, storedBytes: records.reduce((sum, record) => sum + size(record), 0),
        states: Object.fromEntries(policy.states.map(state => [state, records.filter(record => record.status === state).length])),
        maxAttempts, maxBytes, retentionMs: policy.retentionMs, storage: 'indexeddb', persistence: 'browser-managed' }));
    },
    close() { closed = true; db.close(); }
  };
}
