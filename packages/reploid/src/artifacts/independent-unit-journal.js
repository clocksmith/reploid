import { snapshotJson } from '../config/index.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Independent units: ${message}`); };
const same = (a, b) => JSON.stringify(snapshotJson(a)) === JSON.stringify(snapshotJson(b));
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const request = operation => new Promise((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error);
});

/** Requester aggregate storage. It neither verifies signatures nor grants disclosure. */
export async function openIndependentUnitJournal({ requesterId, name, policy, indexedDB = globalThis.indexedDB }) {
  policy = snapshotJson(policy);
  assert(digest(requesterId) && typeof name === 'string' && name.length > 0 && indexedDB, 'requester, name and IndexedDB required');
  for (const field of ['maxRecords', 'maxBytes', 'maxUnits', 'maxAttemptsPerUnit', 'retentionMs', 'maxFutureMs', 'storageTimeoutMs']) {
    assert(Number.isSafeInteger(policy[field]) && policy[field] > 0, `bounded ${field} required`);
  }
  const opening = indexedDB.open(`${name}:${requesterId}`, 1);
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => fail(new Error('Independent unit journal opening expired')), policy.storageTimeoutMs);
    opening.onupgradeneeded = () => {
      if (settled) opening.transaction.abort();
      else opening.result.createObjectStore('aggregates', { keyPath: 'parentId' });
    };
    opening.onblocked = () => fail(new Error('Independent unit journal opening blocked'));
    opening.onerror = () => fail(opening.error);
    opening.onsuccess = () => {
      if (settled) { opening.result.close(); return; }
      settled = true; clearTimeout(timer); resolve(opening.result);
    };
  });
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const transact = async action => {
    assert(!closed, 'journal closed');
    const tx = db.transaction('aggregates', 'readwrite', { durability: 'strict' });
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* Already settled. */ } }, policy.storageTimeoutMs);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = () => { clearTimeout(timer); resolve(); };
      tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Independent unit transaction aborted')); };
      tx.onerror = () => {};
    });
    finished.catch(() => {});
    try {
      const store = tx.objectStore('aggregates');
      const rows = await request(store.getAll(null, policy.maxRecords + 1));
      assert(rows.length <= policy.maxRecords, 'persisted record budget exceeded');
      const live = [];
      for (const row of rows) {
        assert(row.schema === 'reploid.independent-unit-aggregate/v1' && row.requesterId === requesterId
          && Number.isSafeInteger(row.retainUntil), 'invalid retained aggregate');
        if (row.retainUntil <= Date.now()) await request(store.delete(row.parentId));
        else live.push(row);
      }
      assert(live.reduce((sum, row) => sum + bytes(row), 0) <= policy.maxBytes, 'persisted byte budget exceeded');
      const save = async row => {
        const others = live.filter(value => value.parentId !== row.parentId);
        assert(others.length < policy.maxRecords
          && others.reduce((sum, value) => sum + bytes(value), bytes(row)) <= policy.maxBytes, 'aggregate storage budget exhausted');
        await request(store.put(row));
        return structuredClone(row);
      };
      const result = await action(live, save);
      await finished;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* Already settled. */ }
      await finished.catch(() => {});
      throw error;
    }
  };
  const find = (rows, parentId) => {
    const row = rows.find(value => value.parentId === parentId);
    assert(row, 'aggregate not found');
    return row;
  };
  const mutable = row => {
    assert(row.expiresAt > Date.now(), 'aggregate expired');
    assert(row.status === 'pending', 'aggregate is not pending');
  };
  return {
    async create(input) {
      const value = snapshotJson(input);
      assert(value.requesterId === requesterId && typeof value.parentId === 'string'
        && value.parentId.length > 0 && value.parentId.length <= 256 && digest(value.identity), 'aggregate identity required');
      assert(Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now()
        && value.expiresAt <= Date.now() + policy.maxFutureMs
        && Number.isSafeInteger(value.expiresAt + policy.retentionMs), 'future bounded expiry required');
      assert(Array.isArray(value.units) && value.units.length > 0 && value.units.length <= policy.maxUnits
        && new Set(value.units.map(unit => unit.unitId)).size === value.units.length
        && value.units.every(unit => digest(unit.unitId) && Array.isArray(unit.positions)
          && unit.positions.length > 0 && unit.positions.every(position => Number.isSafeInteger(position) && position >= 0)), 'bounded unique units required');
      const positions = value.units.flatMap(unit => unit.positions).sort((a, b) => a - b);
      assert(positions.every((position, index) => position === index), 'unit positions must cover inputs exactly once');
      return transact(async (rows, save) => {
        const prior = rows.find(row => row.parentId === value.parentId);
        if (prior) { assert(same(prior.manifest, value), 'parent identity collision'); return structuredClone(prior); }
        return save({ schema: 'reploid.independent-unit-aggregate/v1', parentId: value.parentId,
          requesterId, manifest: value, expiresAt: value.expiresAt, retainUntil: value.expiresAt + policy.retentionMs,
          status: 'pending', units: value.units.map(unit => ({ unitId: unit.unitId, attempts: [], outcome: null })) });
      });
    },
    get(parentId) { return transact(rows => structuredClone(find(rows, parentId))); },
    async assign(parentId, unitId, expectedAttemptNumber, input) {
      const attempt = snapshotJson(input);
      assert(digest(attempt.jobHash) && typeof attempt.assignmentId === 'string' && attempt.assignmentId.length > 0
        && typeof attempt.attemptId === 'string' && attempt.attemptId.length > 0
        && digest(attempt.providerId) && Number.isSafeInteger(attempt.attemptNumber)
        && attempt.attemptNumber === expectedAttemptNumber + 1, 'existing job assignment and next attempt required');
      return transact(async (rows, save) => {
        const row = find(rows, parentId); mutable(row);
        const unit = row.units.find(value => value.unitId === unitId);
        assert(unit && !unit.outcome, 'unit unavailable or committed');
        assert((unit.attempts.at(-1)?.attemptNumber ?? 0) === expectedAttemptNumber, 'attempt writer was superseded');
        assert(unit.attempts.length < policy.maxAttemptsPerUnit
          && !unit.attempts.some(value => value.attemptId === attempt.attemptId || value.jobHash === attempt.jobHash), 'new bounded attempt required');
        unit.attempts.push(attempt);
        return save(row);
      });
    },
    async commit(parentId, unitId, jobHash, input) {
      const outcome = snapshotJson(input);
      assert(digest(outcome.identity) && outcome.result?.job?.messageHash === jobHash, 'bound outcome required');
      return transact(async (rows, save) => {
        const row = find(rows, parentId);
        const unit = row.units.find(value => value.unitId === unitId);
        assert(unit?.attempts.at(-1)?.jobHash === jobHash, 'attempt writer was superseded');
        if (unit.outcome) {
          assert(same(unit.outcome.result.job, outcome.result.job)
            && same(unit.outcome.result.execution, outcome.result.execution)
            && unit.outcome.identity === outcome.identity, 'conflicting duplicate outcome');
          return structuredClone(row);
        }
        mutable(row);
        unit.outcome = { ...outcome, location: `indexeddb:${encodeURIComponent(name)}/${encodeURIComponent(requesterId)}/${encodeURIComponent(parentId)}/${unitId}` };
        if (row.units.every(value => value.outcome)) row.status = 'completed';
        return save(row);
      });
    },
    cancel(parentId) {
      return transact(async (rows, save) => {
        const row = find(rows, parentId);
        if (row.status === 'pending') row.status = 'cancelled';
        return save(row);
      });
    },
    close() { closed = true; db.close(); }
  };
}
