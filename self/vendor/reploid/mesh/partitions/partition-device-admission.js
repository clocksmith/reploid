import failureMessages from '../../transport/partition-errors.json' with { type: 'json' };
import { assertPartition as assert } from './partition-contract.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const unavailable = () => Object.assign(new Error(failureMessages.CAPACITY_UNAVAILABLE), { code: 'CAPACITY_UNAVAILABLE' });

/** One admission budget per executing device (Launch 3, opt-in). It charges declared application
 * allocations, not measured physical memory: each resident's weights once, plus `bytes` and one
 * slot per admitted attempt, across every resident and route on the device. Callers release an
 * attempt only after its cleanup settles, and a resident only after its provider closed. */
export function createDeviceAdmission({ maxBytes, maxConcurrentAttempts }) {
  assert(positive(maxBytes) && positive(maxConcurrentAttempts), 'Explicit device admission budget required');
  const residents = new Map(), attempts = new Map();
  const attemptRows = () => [...attempts.values()].flatMap(rows => [...rows.values()]);
  const residentBytes = () => [...residents.values()].reduce((total, bytes) => total + bytes, 0);
  const attemptBytes = () => attemptRows().reduce((total, bytes) => total + bytes, 0);
  const free = () => maxBytes - residentBytes() - attemptBytes();
  return Object.freeze({
    /** Charge resident weights once; a resident that does not fit is never offered. */
    admitResident(owner, bytes) {
      assert(owner && typeof owner === 'object' && positive(bytes), 'Device resident charge requires an owner and weight bytes');
      if (residents.has(owner)) return;
      if (bytes > free()) throw Object.assign(new Error('Device allocation budget cannot hold this resident'), { code: 'RESOURCE_EXHAUSTED' });
      residents.set(owner, bytes); attempts.set(owner, new Map());
    },
    /** Admit one attempt on one resident; repeated admission of the same attempt charges once. */
    async admit({ owner, attemptId, bytes }) {
      assert(residents.has(owner) && typeof attemptId === 'string' && attemptId.length > 0 && positive(bytes),
        'Device attempt admission requires an admitted resident, attempt and allocation');
      const rows = attempts.get(owner);
      if (rows.has(attemptId)) return;
      if (attemptRows().length >= maxConcurrentAttempts || bytes > free()) throw unavailable();
      rows.set(attemptId, bytes);
    },
    release(owner, attemptId) { attempts.get(owner)?.delete(attemptId); },
    releaseResident(owner) { residents.delete(owner); attempts.delete(owner); },
    /** Attempts of `bytes` each that could still be admitted. */
    available(bytes) {
      assert(positive(bytes), 'Device availability requires an attempt allocation');
      return Math.max(0, Math.min(maxConcurrentAttempts - attemptRows().length, Math.floor(free() / bytes)));
    },
    getState: () => ({ maxBytes, maxConcurrentAttempts, residents: residents.size, residentBytes: residentBytes(),
      attemptBytes: attemptBytes(), active: attemptRows().length, availableBytes: free() })
  });
}
