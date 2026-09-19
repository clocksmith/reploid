import { createAttemptLifecycle, executeTurns } from './lifecycle.js';
export { TURN_NEXT, TURN_STOP, TURN_RETURN } from './lifecycle.js';
import { isRetryableToolError } from './tool-retry.js';
import { dispatchTool } from './tool-dispatch.js';
import { isTransientProviderFailure } from './provider-recovery.js';
import { snapshotJson } from '../config/index.js';

/** @typedef {import('./engine-contracts.js').ExecutionEvent} ExecutionEvent */
/**
 * Execution authority shared by the task and lab strategies. Strategies supply
 * context, candidate selection, planning and presentation; this owner alone
 * invokes providers/tools, schedules retries and commits execution observations.
 * @param {{onEvent?: (event: ExecutionEvent) => void}} [options]
 */
export function createExecutionEngine({ onEvent } = {}) {
  const lifecycle = createAttemptLifecycle();
  let closed = false;
  let active = false;
  let sequence = 0;
  let retryToken = 0;
  let retryWaiting = false;
  let retryTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let deadline = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const events = /** @type {ExecutionEvent[]} */ ([]);
  /** @param {ExecutionEvent['type']} type @param {Record<string, import('../config/index.js').Json>} [data] */
  const record = (type, data = {}) => {
    const event = snapshotJson({ sequence: ++sequence, type, ...data });
    events.push(event);
    // Bounded operational history, not scientific or independently verified evidence.
    if (events.length > 256) events.shift();
    try { onEvent?.(snapshotJson(event)); } catch { /* Observation cannot change execution authority. */ }
  };
  const cancelRetry = () => {
    retryToken++;
    retryWaiting = false;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const signal = () => {
    if (closed) throw new Error('Agent is closed');
    if (!active || !lifecycle.signal) throw new Error('No active attempt');
    lifecycle.signal.throwIfAborted();
    return lifecycle.signal;
  };
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  const invoke = operation => lifecycle.invoke(operation, signal());
  /** @param {number} delayMs */
  const delay = delayMs => {
    const attemptSignal = signal();
    if (delayMs <= 0) return Promise.resolve();
    return invoke(() => new Promise((resolve, reject) => {
      const finish = () => { attemptSignal.removeEventListener('abort', abort); resolve(undefined); };
      const timer = setTimeout(finish, Math.max(0, delayMs));
      const abort = () => { clearTimeout(timer); reject(attemptSignal.reason); };
      attemptSignal.addEventListener('abort', abort, { once: true });
    }));
  };
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  const provider = async operation => {
    signal();
    record('provider.started');
    try {
      const result = await invoke(operation);
      signal();
      record('provider.completed');
      return result;
    } catch (error) {
      record(lifecycle.signal?.aborted ? 'provider.cancelled' : 'provider.failed');
      throw error;
    }
  };
  /**
   * @template M, R
   * @param {{candidates: M[], request: (model: M) => Promise<R>,
   * onFailure?: (error: unknown, model: M, index: number, retrying: boolean) => void,
   * onSuccess?: (model: M, index: number) => void}} options
   */
  const generate = async ({ candidates, request, onFailure, onSuccess }) => {
    if (!candidates.length) throw new Error('No provider candidates available');
    for (const [index, model] of candidates.entries()) {
      signal();
      try {
        const response = await provider(() => request(model));
        onSuccess?.(model, index);
        return { response, model };
      } catch (error) {
        signal();
        const retrying = isTransientProviderFailure(error) && index < candidates.length - 1;
        onFailure?.(error, model, index, retrying);
        if (!retrying) throw error;
      }
    }
    throw new Error('No provider candidates available');
  };
  /** @param {import('./engine-contracts.js').ToolRequest} request */
  const tool = async request => {
    const started = Date.now();
    const retries = request.retry?.maxRetries ?? 0;
    if (!Number.isSafeInteger(retries) || retries < 0
      || !Number.isFinite(request.retry?.delayMs ?? 0) || (request.retry?.delayMs ?? 0) < 0) throw new TypeError('Invalid tool retry budget');
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal();
      record('tool.started', { name: request.call.name });
      try {
        const value = await invoke(() => dispatchTool({ ...request, signal: signal() }));
        signal();
        record('tool.completed', { name: request.call.name });
        return { status: /** @type {const} */ ('completed'), value, duration: Date.now() - started };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = lifecycle.signal?.aborted ? 'cancelled'
          : /^(Host denied tool:|Tool is not permitted by configuration:)/.test(message) ? 'denied' : 'failed';
        record(`tool.${status}`, { name: request.call.name });
        if (status === 'cancelled') throw error;
        if (status === 'failed' && attempt < retries && isRetryableToolError(error)) {
          await delay((request.retry?.delayMs || 0) * (attempt + 1));
          continue;
        }
        return { status, error, duration: Date.now() - started };
      }
    }
    throw new Error('Invalid tool retry budget');
  };
  /**
   * Plans are supplied by strategies. Execution, cancellation and result ordering
   * are shared. A recovery/next-step call must re-enter tool() and be authorized.
   * @template C, R
   * @param {{groups: {mode: string, calls: C[]}[], execute: (call: C) => Promise<R>,
   * failed?: (result: R) => boolean, stopOnFailure?: boolean,
   * skipped?: (call: C, failedCall: C) => R,
   * next?: (result: R) => C[], maxFollowups?: number,
   * before?: (group: {mode: string, calls: C[]}, index: number) => void,
   * after?: (results: R[], group: {mode: string, calls: C[]}) => void}} options
   */
  const batch = async ({ groups, execute, failed = () => false, stopOnFailure = false,
    skipped, next = () => [], maxFollowups = 0, before, after }) => {
    const results = /** @type {R[]} */ ([]);
    let failedCall = /** @type {C | undefined} */ (undefined);
    let followups = 0;
    for (const [index, group] of groups.entries()) {
      signal();
      if (failedCall !== undefined && stopOnFailure) {
        if (skipped) results.push(...group.calls.map(call => skipped(call, /** @type {C} */ (failedCall))));
        continue;
      }
      before?.(group, index);
      /** @type {R[]} */
      const entries = group.mode === 'parallel'
        ? await Promise.all(group.calls.map(call => { signal(); return execute(call); }))
        : [];
      if (group.mode !== 'parallel') {
        for (const call of group.calls) {
          signal();
          if (failedCall !== undefined && stopOnFailure) {
            if (skipped) entries.push(skipped(call, failedCall));
            continue;
          }
          const result = await execute(call);
          signal();
          entries.push(result);
          if (failed(result)) { failedCall = call; continue; }
          for (const chained of next(result)) {
            signal();
            if (followups >= maxFollowups) break;
            followups++;
            const child = await execute(chained);
            signal();
            entries.push(child);
            if (failed(child)) { failedCall = chained; break; }
          }
        }
      }
      signal();
      results.push(...entries);
      after?.(entries, group);
    }
    return results;
  };
  return Object.freeze({
    invoke, delay, provider, generate, tool, batch,
    /** @param {import('./engine-contracts.js').ProviderResponse} response @param {(text: string) => import('./engine-contracts.js').ToolCall[]} parse */
    interpret(response, parse) {
      signal();
      const content = String(response?.raw || response?.content || '').trim();
      const calls = response?.toolCalls?.length ? response.toolCalls : parse(content);
      const result = structuredClone({ content, calls: calls || [] });
      record('response.interpreted', { toolCount: result.calls.length });
      return result;
    },
    /** @param {(signal: AbortSignal) => Promise<unknown>} operation @param {{timeoutMs?: number, onTimeout?: () => void}} [control] */
    start(operation, { timeoutMs, onTimeout } = {}) {
      if (closed) return Promise.reject(new Error('Agent is closed'));
      return lifecycle.start(async attemptSignal => {
        active = true;
        record('attempt.started');
        if (timeoutMs !== undefined) deadline = setTimeout(() => {
          lifecycle.cancel(new Error('Execution deadline reached'));
          onTimeout?.();
        }, timeoutMs);
        try { return await operation(attemptSignal); }
        finally {
          if (deadline !== null) clearTimeout(deadline);
          deadline = null;
          active = false;
          record(attemptSignal.aborted ? 'attempt.cancelled' : 'attempt.settled');
        }
      });
    },
    /** @param {{canContinue: () => boolean, turn: () => Promise<string | void>}} strategy */
    turns(strategy) { return executeTurns({ ...strategy, signal: signal() }); },
    /** @param {number} delayMs @param {() => void} resume */
    scheduleRetry(delayMs, resume) {
      if (closed) throw new Error('Agent is closed');
      signal();
      cancelRetry();
      record('retry.scheduled', { delayMs });
      const token = retryToken;
      retryWaiting = true;
      retryTimer = setTimeout(async () => {
        retryTimer = null;
        await lifecycle.whenIdle();
        if (closed || lifecycle.signal?.aborted || token !== retryToken) return;
        retryWaiting = false;
        record('retry.ready');
        resume();
      }, Math.max(0, delayMs));
    },
    cancelRetry,
    get retryPending() { return retryWaiting; },
    /** @param {Error} [reason] */
    cancel(reason) { cancelRetry(); lifecycle.cancel(reason); },
    /** @template {import('../config/index.js').Json} T @param {T} state @returns {T} */
    checkpoint(state) {
      if (lifecycle.isActive || retryWaiting || lifecycle.pendingCount > 0) throw new Error('Pause execution before checkpointing');
      return snapshotJson(state);
    },
    getEvents() { return structuredClone(events); },
    async close() { closed = true; cancelRetry(); await lifecycle.close(); }
  });
}
