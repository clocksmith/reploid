import { abortable } from './cancellation.js';

export const TURN_NEXT = 'next';
export const TURN_STOP = 'stop';
export const TURN_RETURN = 'return';

/** One turn scheduler for all configured strategies. A turn never starts after cancellation. */
/** @param {{signal: AbortSignal, canContinue: () => boolean, turn: () => Promise<string | void>}} options */
export async function executeTurns({ signal, canContinue, turn }) {
  while (!signal.aborted && canContinue()) {
    const outcome = await turn();
    if (outcome === TURN_RETURN) return TURN_RETURN;
    if (outcome === TURN_STOP) break;
  }
  return TURN_STOP;
}

/** Owns cancellation and settlement; cancellation does not terminate borrowed JavaScript. */
export function createAttemptLifecycle() {
  /** @type {AbortController | null} */
  let controller = null;
  /** @type {Promise<unknown> | null} */
  let active = null;
  let closed = false;
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();
  /** @param {(signal: AbortSignal) => Promise<unknown>} operation */
  const start = operation => {
    if (closed) return Promise.reject(new Error('Agent is closed'));
    if (active) return active;
    controller = new AbortController();
    const signal = controller.signal;
    active = Promise.resolve().then(async () => {
      await Promise.allSettled([...pending]);
      signal.throwIfAborted();
      return operation(signal);
    }).finally(() => { active = null; });
    return active;
  };
  /** @param {() => unknown | Promise<unknown>} operation @param {AbortSignal | undefined} [signal] */
  const invoke = (operation, signal = controller?.signal) => {
    if (closed) return Promise.reject(new Error('Agent is closed'));
    signal?.throwIfAborted();
    const work = Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); });
    pending.add(work);
    work.then(() => pending.delete(work), () => pending.delete(work));
    return signal ? abortable(() => work, signal) : work;
  };
  /** @param {Error} [reason] */
  const cancel = reason => controller?.abort(reason || new Error('Execution cancelled'));
  return Object.freeze({ start, invoke, cancel,
    get signal() { return controller?.signal; },
    async settle() { await Promise.allSettled([...pending]); },
    async close() {
      closed = true;
      cancel();
      await active?.catch(() => {});
      await Promise.allSettled([...pending]);
    }
  });
}
