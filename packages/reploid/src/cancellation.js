/**
 * The library's one abort race. Agent execution, transport, custody, retrieval
 * and hosts stop awaiting borrowed work when its signal aborts; the borrowed
 * work itself may keep running until its owner settles it.
 */

/** @template T @param {() => T | Promise<T>} operation @param {AbortSignal} signal @returns {Promise<T>} */
export function abortable(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * abortable() that also stops waiting at `deadline` (epoch milliseconds),
 * rejecting with `expired()`; the operation itself is not cancelled.
 * @template T @param {() => T | Promise<T>} operation @param {AbortSignal} signal
 * @param {{ deadline: number, expired: () => unknown }} limit @returns {Promise<T>}
 */
export function abortableBefore(operation, signal, { deadline, expired }) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(expired()), Math.max(0, deadline - Date.now()));
  return abortable(operation, AbortSignal.any([signal, timeout.signal])).finally(() => clearTimeout(timer));
}

/**
 * Awaits work that has already started unless `signal` aborts first. A failure
 * the work reports after the abort stays handled.
 * @template T @param {T | Promise<T>} pending @param {AbortSignal} signal @returns {Promise<T>}
 */
export function untilAborted(pending, signal) {
  const started = Promise.resolve(pending);
  started.catch(() => {});
  return abortable(() => started, signal);
}
