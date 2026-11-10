import queuePolicy from './partition-attempt-queue-policy.json' with { type: 'json' };
import { assertPartition as assert, partitionFailure } from './partition-contract.js';

export const ATTEMPT_QUEUE_POLICY_SCHEMA = 'reploid.partition-attempt-queue-policy/v1';
const POLICY_KEYS = Object.freeze(['schema', 'maxQueuedAttempts', 'maxQueuedPerRequester', 'maxQueueWaitMs']);
const positive = value => Number.isSafeInteger(value) && value > 0;

/** Every member is required and nothing is defaulted in JavaScript. */
export function validateAttemptQueuePolicy(policy) {
  const keys = policy && typeof policy === 'object' && !Array.isArray(policy) ? Object.keys(policy) : [];
  assert(keys.length === POLICY_KEYS.length && POLICY_KEYS.every(key => keys.includes(key))
    && policy.schema === ATTEMPT_QUEUE_POLICY_SCHEMA
    && ['maxQueuedAttempts', 'maxQueuedPerRequester', 'maxQueueWaitMs'].every(key => positive(policy[key]))
    && policy.maxQueuedPerRequester <= policy.maxQueuedAttempts && policy.maxQueueWaitMs <= 2147483647,
  `Explicit ${ATTEMPT_QUEUE_POLICY_SCHEMA} required: ${POLICY_KEYS.join(', ')}`);
  return Object.freeze({ ...policy });
}

/** The partitions component's own waiting bounds, checked when this module loads. */
export const ATTEMPT_QUEUE_POLICY = validateAttemptQueuePolicy(queuePolicy);

/**
 * Coordinator admission for already-authorized ordered attempts. An attempt whose route has no
 * free slot waits here instead of failing; while it waits nothing is tokenized, reserved, granted
 * or disclosed to any stage. Entries are admitted in arrival order: the earliest waiting entry
 * whose route can run it now goes first, so one route's limit never idles another route's
 * capacity and later entries of the same route never overtake earlier ones.
 *
 * `admit()` resolves with a ticket the route owner holds until the attempt's coordinator-side
 * work ends (`release()`); `opened()` marks that the attempt now holds the coordinator stage's
 * own reservation, so a gate can count tickets that have not yet reserved it. Each gate
 * `check({ admitted, opening })` sees its key's live tickets and every ticket not yet opened, and
 * returns true to admit, false to keep waiting, or throws to refuse an entry its route can no
 * longer run (that error is the entry's failure).
 *
 * Bounds fail explicitly: a full queue (overall or for one authenticated requester) with
 * CAPACITY_QUEUE_FULL; a wait reaching the policy limit, or the attempt's own deadline (its
 * disclosure window) first, with CAPACITY_QUEUE_TIMEOUT and `bound` 'policy' or 'authorization'.
 * Cancellation removes the entry with the signal's reason; nothing was held, so nothing settles.
 */
export function createPartitionAttemptQueue({ policy, now = Date.now }) {
  const bounds = validateAttemptQueuePolicy(policy);
  assert(typeof now === 'function', 'Queue clock required');
  const waiting = [], tickets = new Set();
  let opening = 0;
  const admittedFor = key => [...tickets].filter(ticket => ticket.key === key).length;
  const ask = entry => entry.check({ admitted: admittedFor(entry.key), opening });
  function grant(key, queuedAt) {
    const record = { key, opened: false };
    tickets.add(record); opening++;
    const queuedMs = queuedAt === null ? 0 : Math.max(0, now() - queuedAt);
    return Object.freeze({ queued: queuedAt !== null, queuedMs,
      opened() { if (!record.opened && tickets.has(record)) { record.opened = true; opening--; } },
      release() {
        if (!tickets.delete(record)) return;
        if (!record.opened) { record.opened = true; opening--; }
        pump();
      } });
  }
  function settle(entry, error) {
    const index = waiting.indexOf(entry);
    if (index < 0) return;
    waiting.splice(index, 1);
    clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.onAbort);
    if (error) entry.reject(error); else entry.resolve(grant(entry.key, entry.queuedAt));
  }
  function pump() {
    for (const entry of [...waiting]) {
      if (!waiting.includes(entry)) continue;
      let admit;
      try { admit = ask(entry) === true; } catch (error) { settle(entry, error); continue; }
      if (admit) settle(entry, null);
    }
  }
  return Object.freeze({
    policy: bounds,
    // Async so every refusal, including an already-aborted signal, is a rejection; the decision and
    // any enqueueing still happen synchronously, in call order.
    async admit({ key, attemptId, requesterId, deadlineAt = Infinity, signal, check, onQueued = () => {} }) {
      assert(key !== undefined && key !== null && typeof attemptId === 'string' && attemptId.length > 0
        && typeof requesterId === 'string' && requesterId.length > 0 && typeof check === 'function'
        && typeof onQueued === 'function' && (deadlineAt === Infinity || Number.isFinite(deadlineAt)),
      'Queued attempt key, identity, authenticated requester and admission check required');
      signal?.throwIfAborted();
      assert(!waiting.some(entry => entry.attemptId === attemptId), 'Attempt is already waiting for admission');
      // Earlier arrivals take any capacity first; an entry that fits after them is admitted at once.
      pump();
      const entry = { key, attemptId, requesterId, check, signal, queuedAt: null };
      let fits;
      try { fits = ask(entry) === true; } catch (error) { return Promise.reject(error); }
      if (fits) return Promise.resolve(grant(key, null));
      const at = now(), policyAt = at + bounds.maxQueueWaitMs, limit = Math.min(policyAt, deadlineAt);
      const bound = deadlineAt < policyAt ? 'authorization' : 'policy';
      if (limit <= at) return Promise.reject(partitionFailure('CAPACITY_QUEUE_TIMEOUT', { bound }));
      if (waiting.length >= bounds.maxQueuedAttempts
        || waiting.filter(row => row.requesterId === requesterId).length >= bounds.maxQueuedPerRequester) {
        return Promise.reject(partitionFailure('CAPACITY_QUEUE_FULL'));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      Object.assign(entry, { resolve, reject, queuedAt: at });
      entry.timer = setTimeout(() => settle(entry, partitionFailure('CAPACITY_QUEUE_TIMEOUT', { bound })), limit - at);
      entry.onAbort = () => settle(entry, signal.reason ?? new Error('Queued attempt cancelled'));
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      waiting.push(entry);
      try { onQueued({ position: waiting.length, queuedAt: at, waitUntil: limit }); } catch {}
      return promise;
    },
    /** Re-evaluate waiting entries after capacity may have changed. */
    pump,
    getState: () => ({ queued: waiting.length, admitted: tickets.size, opening, ...bounds })
  });
}
