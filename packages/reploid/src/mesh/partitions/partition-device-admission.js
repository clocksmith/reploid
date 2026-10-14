import failureMessages from '../../transport/partition-errors.json' with { type: 'json' };
import { assertPartition as assert } from './partition-contract.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const unavailable = () => Object.assign(new Error(failureMessages.CAPACITY_UNAVAILABLE), { code: 'CAPACITY_UNAVAILABLE' });

/** One admission budget per executing device (Launch 3, opt-in). It charges declared application
 * allocations, not measured physical memory: each resident's weights once, plus `bytes` and one
 * slot per admitted attempt, across every resident and route on the device. Callers release an
 * attempt only after its cleanup settles, and a resident only after its provider closed.
 *
 * With `queue`, an attempt that does not fit waits instead of failing. Waiting is bounded in
 * length, per requester and in time; each bound fails with CAPACITY_UNAVAILABLE. Grants go to the
 * route owner (coordinator) with the fewest attempts admitted on this device, then the one served
 * least recently, then first come, first served, with no overtaking by smaller requests. */
export function createDeviceAdmission({ maxBytes, maxConcurrentAttempts, queue = null }) {
  assert(positive(maxBytes) && positive(maxConcurrentAttempts), 'Explicit device admission budget required');
  assert(queue === null || ['maxQueued', 'maxQueuedPerRequester', 'maxWaitMs'].every(key => positive(queue[key])),
    'Explicit bounded admission queue required');
  const residents = new Map(), attempts = new Map(), waiting = [], served = new Map();
  let sequence = 0, grants = 0;
  const attemptRows = () => [...attempts.values()].flatMap(rows => [...rows.values()]);
  const residentBytes = () => [...residents.values()].reduce((total, bytes) => total + bytes, 0);
  const attemptBytes = () => attemptRows().reduce((total, row) => total + row.bytes, 0);
  const free = () => maxBytes - residentBytes() - attemptBytes();
  const fits = bytes => attemptRows().length < maxConcurrentAttempts && bytes <= free();
  const admittedFor = routeKey => attemptRows().filter(row => row.routeKey === routeKey).length;
  function charge(entry) {
    attempts.get(entry.owner).set(entry.attemptId, { bytes: entry.bytes, routeKey: entry.routeKey });
    served.set(entry.routeKey, grants++);
    // Forget idle route owners so this record stays bounded; a returning owner counts as least recent.
    if (served.size > maxConcurrentAttempts + (queue?.maxQueued ?? 0)) for (const key of served.keys()) {
      if (!admittedFor(key) && !waiting.some(row => row.routeKey === key)) served.delete(key);
    }
  }
  function settle(entry, error) {
    const at = waiting.indexOf(entry);
    if (at < 0) return;
    waiting.splice(at, 1);
    clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.onAbort);
    if (error) entry.reject(error); else { charge(entry); entry.resolve(); }
  }
  function pump() {
    while (waiting.length) {
      const next = waiting.reduce((best, entry) => {
        const order = admittedFor(entry.routeKey) - admittedFor(best.routeKey)
          || (served.get(entry.routeKey) ?? -1) - (served.get(best.routeKey) ?? -1) || entry.sequence - best.sequence;
        return order < 0 ? entry : best;
      });
      if (!fits(next.bytes)) return;
      settle(next, null);
    }
  }
  return Object.freeze({
    /** Charge resident weights once; a resident that does not fit is never offered. */
    admitResident(owner, bytes) {
      assert(owner && typeof owner === 'object' && positive(bytes), 'Device resident charge requires an owner and weight bytes');
      if (residents.has(owner)) return;
      if (bytes > free()) throw Object.assign(new Error('Device allocation budget cannot hold this resident'), { code: 'RESOURCE_EXHAUSTED' });
      residents.set(owner, bytes); attempts.set(owner, new Map());
    },
    /** Admit one attempt on one resident; repeated admission of the same attempt charges once. */
    async admit({ owner, attemptId, bytes, requesterId = null, routeKey = null, signal }) {
      assert(residents.has(owner) && typeof attemptId === 'string' && attemptId.length > 0 && positive(bytes),
        'Device attempt admission requires an admitted resident, attempt and allocation');
      if (attempts.get(owner).has(attemptId)) return;
      const queued = waiting.find(entry => entry.owner === owner && entry.attemptId === attemptId);
      if (queued) return queued.promise;
      signal?.throwIfAborted();
      if (!waiting.length && fits(bytes)) { charge({ owner, attemptId, bytes, routeKey }); return; }
      if (!queue || waiting.length >= queue.maxQueued
        || waiting.filter(entry => entry.requesterId === requesterId).length >= queue.maxQueuedPerRequester) throw unavailable();
      const { promise, resolve, reject } = Promise.withResolvers();
      const entry = { owner, attemptId, bytes, requesterId, routeKey, sequence: sequence++, promise, resolve, reject, signal };
      entry.timer = setTimeout(() => settle(entry, unavailable()), queue.maxWaitMs);
      entry.onAbort = () => settle(entry, signal.reason);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      waiting.push(entry); pump();
      return promise;
    },
    release(owner, attemptId) { attempts.get(owner)?.delete(attemptId); pump(); },
    releaseResident(owner) {
      for (const entry of waiting.filter(row => row.owner === owner)) settle(entry, unavailable());
      residents.delete(owner); attempts.delete(owner); pump();
    },
    /** Attempts of `bytes` each that could still be admitted without waiting. */
    available(bytes) {
      assert(positive(bytes), 'Device availability requires an attempt allocation');
      if (waiting.length) return 0;
      return Math.max(0, Math.min(maxConcurrentAttempts - attemptRows().length, Math.floor(free() / bytes)));
    },
    getState: () => ({ maxBytes, maxConcurrentAttempts, residents: residents.size, residentBytes: residentBytes(),
      attemptBytes: attemptBytes(), active: attemptRows().length, availableBytes: free(),
      ...(queue ? { queued: waiting.length, maxQueued: queue.maxQueued } : {}) })
  });
}
