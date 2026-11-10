/** Bandwidth-rate enforcement for native custody transfers. A token bucket admits
 * bytes in FIFO order at the owner's rate. It starts empty, so a restart never
 * grants a burst, and holds at most one custody chunk, so bytes never run ahead
 * of the rate by more than one chunk. Cumulative REP-5 allowances stay separate. */

const positive = value => Number.isSafeInteger(value) && value > 0;

export function createByteRateLimiter({ bytesPerSecond, capacityBytes, now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!positive(bytesPerSecond) || !positive(capacityBytes) || typeof now !== 'function') throw new Error('Explicit byte rate and capacity required');
  const queue = [];
  let tokens = 0, updatedAt = now(), timer = null, admittedBytes = 0, waitedMs = 0, closed = false;
  const refill = () => {
    const at = now();
    if (at > updatedAt) tokens = Math.min(capacityBytes, tokens + (at - updatedAt) * bytesPerSecond / 1000);
    updatedAt = Math.max(updatedAt, at);
  };
  function pump() {
    refill();
    while (queue.length && tokens >= queue[0].bytes) {
      const waiter = queue.shift();
      tokens -= waiter.bytes; admittedBytes += waiter.bytes; waitedMs += now() - waiter.queuedAt;
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.resolve();
    }
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (queue.length) {
      const delay = Math.max(1, Math.ceil((queue[0].bytes - tokens) * 1000 / bytesPerSecond));
      timer = setTimer(() => { timer = null; pump(); }, delay);
      timer?.unref?.();
    }
  }
  return Object.freeze({
    bytesPerSecond, capacityBytes,
    /** Resolves when `bytes` may move. Cancelling a waiter spends none of the allowance. */
    take(bytes, signal) {
      if (!positive(bytes) || bytes > capacityBytes) return Promise.reject(new Error('Paced transfer exceeds one custody chunk'));
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (closed) return Promise.reject(new Error('Owner rate limiter closed'));
      return new Promise((resolve, reject) => {
        const waiter = { bytes, resolve, reject, signal, queuedAt: now() };
        waiter.abort = () => {
          const index = queue.indexOf(waiter);
          if (index < 0) return;
          queue.splice(index, 1); reject(signal.reason); pump();
        };
        signal?.addEventListener('abort', waiter.abort, { once: true });
        queue.push(waiter); pump();
      });
    },
    getState: () => ({ bytesPerSecond, capacityBytes, queued: queue.length,
      queuedBytes: queue.reduce((total, waiter) => total + waiter.bytes, 0), admittedBytes, waitedMs }),
    close() {
      closed = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
      for (const waiter of queue.splice(0)) {
        waiter.signal?.removeEventListener('abort', waiter.abort); waiter.reject(new Error('Owner rate limiter closed'));
      }
    }
  });
}

/** Custody payload bytes per direction: supplied chunks released to the channel
 * after pacing, and requested chunks received in full. */
export function createTransferMeter() {
  const totals = { suppliedBytes: 0, receivedBytes: 0 };
  return Object.freeze({ sent: bytes => { totals.suppliedBytes += bytes; }, received: bytes => { totals.receivedBytes += bytes; },
    getState: () => ({ ...totals }) });
}

/** Wraps the custody channel host port. Supplied chunks wait for upload tokens after
 * the supplier prepares them and before any byte is sent; requested chunks wait for
 * download tokens before the request leaves, so the channel deadline starts afterwards. */
export function paceCustodyChannel(createChannel, { upload = null, download = null, meter }) {
  return options => {
    const serve = typeof options.serve === 'function' ? async (request, controls) => {
      const response = await options.serve(request, controls);
      const bytes = response?.bytes?.byteLength;
      if (positive(bytes)) {
        await upload?.take(bytes, controls?.signal);
        meter.sent(bytes);
      }
      return response;
    } : options.serve;
    const bus = createChannel({ ...options, serve });
    return { ...bus, async requestChunk(message, controls) {
      await download?.take(message.sizeBytes, controls?.signal);
      const response = await bus.requestChunk(message, controls);
      meter.received(response?.bytes?.byteLength || 0);
      return response;
    } };
  };
}
