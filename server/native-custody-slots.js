/** Whole-model fills can prepare another signed grant while payload chunks are in
 * flight. All grants and peers on this native host still share its chunk limit.
 * Callers keep ownership of an active transfer until its cancellation settles. */
export function createNativeCustodySlots(limit) {
  let active = 0, peakActive = 0, backpressureWaits = 0, backpressureWaitMs = 0;
  const waiters = new Set();
  function wake() {
    while (active < limit && waiters.size) {
      const first = waiters.values().next().value;
      waiters.delete(first);
      active++;
      if (active > peakActive) peakActive = active;
      first();
    }
  }
  return {
    get active() { return active; },
    getStats: () => ({ limit, active, queued: waiters.size, peakActive, backpressureWaits, backpressureWaitMs: Number(backpressureWaitMs.toFixed(3)) }),
    serialize() { limit = 1; },
    async run(signal, operation) {
      signal.throwIfAborted();
      if (active < limit) {
        active++;
        if (active > peakActive) peakActive = active;
      } else {
        backpressureWaits++;
        const waitStarted = performance.now();
        await new Promise((resolve, reject) => {
          function admit() {
            backpressureWaitMs += performance.now() - waitStarted;
            signal.removeEventListener('abort', abort);
            resolve();
          }
          function abort() {
            backpressureWaitMs += performance.now() - waitStarted;
            waiters.delete(admit);
            reject(signal.reason);
          }
          waiters.add(admit);
          signal.addEventListener('abort', abort, { once: true });
        });
      }
      try {
        signal.throwIfAborted();
        return await operation();
      } finally {
        active--;
        wake();
      }
    }
  };
}
