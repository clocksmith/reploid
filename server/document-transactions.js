/** Transaction and replay mechanics; callers retain validation and authority. */
import { cloneJson, hashCanonical, sha256Hex } from './ledger/domain.js';

const idempotencyId = (operation, scopeId, key) => sha256Hex(`${operation}\u0000${scopeId}\u0000${key}`);

export function applyDocumentWrites(tx, writes) {
  for (const write of writes) {
    if (write.create) tx.create(write.collection, write.id, write.value);
    else tx.set(write.collection, write.id, write.value);
  }
}

export function createDocumentTransactions({ backend, fail, applyWrites = applyDocumentWrites }) {
  const priorResult = (record, requestHash, operation) => {
    if (!record) return null;
    if (record.requestHash !== requestHash) {
      fail('idempotency_conflict', 'idempotency key was already used with a different request', { operation });
    }
    return { result: cloneJson(record.result) };
  };

  const lookupIdempotent = async ({ operation, scopeId, idempotencyKey, request }) => priorResult(
    await backend.get('idempotency', idempotencyId(operation, scopeId, idempotencyKey)),
    hashCanonical({ operation, request }),
    operation
  );

  const transact = (body) => backend.runTransaction(async (tx) => {
    const { result, writes } = await body(tx);
    applyWrites(tx, writes);
    return cloneJson(result);
  });

  const mutate = ({ operation, scopeId, idempotencyKey, request, now, body }) => {
    const requestHash = hashCanonical({ operation, request });
    const recordId = idempotencyId(operation, scopeId, idempotencyKey);
    return backend.runTransaction(async (tx) => {
      const prior = priorResult(await tx.get('idempotency', recordId), requestHash, operation);
      if (prior) return prior.result;
      const { result, writes } = await body(tx);
      applyWrites(tx, writes);
      tx.create('idempotency', recordId, { operation, scopeId, idempotencyKey, requestHash, result, recordedAt: now });
      return cloneJson(result);
    });
  };

  return { lookupIdempotent, transact, mutate };
}
