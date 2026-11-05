import { assertPartition as assert, assertCapacity, canonicalPartitionJson } from './partition-contract.js';

/** Per-contributor admission owner. A slot stays held until cleanup settles. A closed owner, an
 * exhausted attempt history or no free slot refuses with CAPACITY_UNAVAILABLE, which reaches the
 * requester as that code rather than as a generic execution failure. */
export function createPartitionReservations({ limits, participantId, index, now = Date.now }) {
  assert(Number.isSafeInteger(limits.maxAttempts) && limits.maxAttempts > 0
    && Number.isSafeInteger(limits.maxConcurrentAttempts) && limits.maxConcurrentAttempts > 0,
  'Explicit reservation limits required');
  const records = new Map();
  let closed = false;
  const describe = ({ binding: _binding, ...record }) => structuredClone(record);
  const active = () => [...records.values()].filter(record => record.settledAt === null);
  const lookup = identity => {
    const record = records.get(identity.attemptId);
    assert(record && record.binding === canonicalPartitionJson(identity), 'Reservation identity mismatch');
    return record;
  };
  return Object.freeze({
    reserve(identity) {
      assertCapacity(!closed);
      assert(typeof identity?.attemptId === 'string' && identity.attemptId.length > 0, 'Reservation attempt identity required');
      if (records.has(identity.attemptId)) {
        const record = lookup(identity);
        assert(record.phase === 'reserved', 'Attempt reservation already settling or retired');
        return describe(record);
      }
      assertCapacity(records.size < limits.maxAttempts);
      assertCapacity(active().length < limits.maxConcurrentAttempts);
      const record = { identity: structuredClone(identity), binding: canonicalPartitionJson(identity), participantId, index,
        phase: 'reserved', reservedAt: now(), settlingAt: null, settledAt: null, failure: null,
        resources: { attemptSlots: 1, maxPromptTokens: limits.maxPromptTokens, maxTokens: limits.maxTokens,
          maxActivationBytes: limits.maxActivationBytes, scope: 'application-attempt-limits' } };
      records.set(identity.attemptId, record); return describe(record);
    },
    fail(identity, cause) {
      if (records.has(identity.attemptId)) lookup(identity).failure = String(cause?.message || cause);
    },
    settling(identity) {
      if (!records.has(identity.attemptId)) {
        assert(records.size < limits.maxAttempts, 'Contributor reservation history exhausted');
        // Cancellation can overtake admission. Keep a bounded tombstone so a
        // delayed, already-authorized reserve cannot reopen that attempt.
        records.set(identity.attemptId, { identity: structuredClone(identity), binding: canonicalPartitionJson(identity),
          participantId, index, phase: 'settling', reservedAt: null, settlingAt: now(), settledAt: null,
          failure: null, resources: null });
      }
      const record = lookup(identity);
      if (record.settledAt === null) { record.phase = 'settling'; record.settlingAt ??= now(); }
    },
    settled(identity) {
      if (!records.has(identity.attemptId)) return;
      const record = lookup(identity);
      record.settledAt ??= now(); record.phase = record.failure ? 'failed' : 'settled';
    },
    /** The stage's own signed evidence for a charged attempt, kept with its admission record. */
    attachEvidence(identity, evidence) {
      if (records.has(identity.attemptId)) lookup(identity).evidence = structuredClone(evidence);
    },
    failureOf: identity => (records.has(identity.attemptId) ? lookup(identity).failure : null),
    getState() {
      return { closed, active: active().length,
        availableSlots: closed || records.size >= limits.maxAttempts ? 0 : limits.maxConcurrentAttempts - active().length,
        records: [...records.values()].map(describe) };
    },
    close() { closed = true; },
    settleAll() {
      // Only the resident owner can call this, after runtime disposal resolves.
      for (const record of active()) {
        record.settlingAt ??= now(); record.settledAt = now();
        record.phase = record.failure ? 'failed' : 'settled';
      }
    }
  });
}
