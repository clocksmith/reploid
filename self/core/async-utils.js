/**
 * @fileoverview Async Utilities for Reploid
 *
 * Provides timeout, retry, and resilience patterns for async operations.
 * Used by tools that make network calls, long-running operations, or
 * operations that could fail transiently.
 */

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [operationName] - Name for error messages
 * @returns {Promise} - Resolves with result or rejects with TimeoutError
 */
export function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Custom error class for timeouts
 */
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.isTimeout = true;
  }
}

/**
 * Custom error class for retry exhaustion
 */
export class RetryExhaustedError extends Error {
  constructor(message, attempts, lastError) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=1000] - Initial delay between retries
 * @param {number} [options.maxDelayMs=30000] - Maximum delay between retries
 * @param {number} [options.backoffMultiplier=2] - Exponential backoff multiplier
 * @param {Function} [options.shouldRetry] - Predicate to determine if retry should occur
 * @param {Function} [options.onRetry] - Callback on each retry attempt
 * @returns {Promise} - Result of successful execution
 */
export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry = null
  } = options;

  let lastError;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        break;
      }

      // Notify retry callback
      if (onRetry) {
        onRetry(error, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      // Exponential backoff
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  throw new RetryExhaustedError(
    `Operation failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError
  );
}

/**
 * Combine timeout and retry for robust async operations
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Combined options
 * @param {number} [options.timeoutMs=30000] - Timeout per attempt
 * @param {number} [options.maxAttempts=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=1000] - Initial retry delay
 * @param {string} [options.operationName] - Name for error messages
 * @param {Function} [options.shouldRetry] - Predicate for retry
 * @param {Function} [options.onRetry] - Retry callback
 * @returns {Promise} - Result of successful execution
 */
export async function withTimeoutAndRetry(fn, options = {}) {
  const {
    timeoutMs = 30000,
    operationName = 'Operation',
    ...retryOptions
  } = options;

  return withRetry(
    async (attempt) => {
      return withTimeout(fn(attempt), timeoutMs, `${operationName} (attempt ${attempt})`);
    },
    {
      ...retryOptions,
      // Always retry on timeout
      shouldRetry: (error, attempt) => {
        if (error.isTimeout) return true;
        if (retryOptions.shouldRetry) return retryOptions.shouldRetry(error, attempt);
        return isTransientError(error);
      }
    }
  );
}

/**
 * Check if an error is likely transient and worth retrying
 * @param {Error} error - The error to check
 * @returns {boolean}
 */
export function isTransientError(error) {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) return true;
  if (error.name === 'NetworkError') return true;
  if (error.message?.includes('network')) return true;
  if (error.message?.includes('ECONNREFUSED')) return true;
  if (error.message?.includes('ETIMEDOUT')) return true;
  if (error.message?.includes('ENOTFOUND')) return true;

  // Timeout errors
  if (error.isTimeout) return true;

  // HTTP 5xx errors
  if (error.status >= 500 && error.status < 600) return true;
  if (error.code === 503) return true; // Service unavailable
  if (error.code === 429) return true; // Too many requests

  // Worker errors
  if (error.message?.includes('worker')) return true;

  return false;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise with external resolve/reject
 * @returns {{promise: Promise, resolve: Function, reject: Function}}
 */
export function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Race a promise against a timeout with cancellation support
 * @param {Function} fn - Function that returns a promise
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {Object} [options] - Options
 * @param {Function} [options.onCancel] - Called when timeout triggers (for cleanup)
 * @returns {Promise}
 */
export async function raceWithTimeout(fn, timeoutMs, options = {}) {
  const { onCancel } = options;
  const abortController = new AbortController();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      abortController.abort();
      if (onCancel) onCancel();
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    fn(abortController.signal),
    timeoutPromise
  ]);
}

/**
 * Execute multiple promises with individual timeouts
 * @param {Array<{fn: Function, timeoutMs: number, name: string}>} tasks - Tasks to execute
 * @param {Object} [options] - Options
 * @param {boolean} [options.continueOnError=false] - Continue if some tasks fail
 * @returns {Promise<Array<{name: string, result?: any, error?: Error}>>}
 */
export async function executeWithTimeouts(tasks, options = {}) {
  const { continueOnError = false } = options;

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      try {
        const result = await withTimeout(task.fn(), task.timeoutMs, task.name);
        return { name: task.name, result };
      } catch (error) {
        if (!continueOnError) throw error;
        return { name: task.name, error };
      }
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { name: tasks[i].name, error: r.reason };
  });
}

export default {
  withTimeout,
  withRetry,
  withTimeoutAndRetry,
  raceWithTimeout,
  executeWithTimeouts,
  isTransientError,
  sleep,
  createDeferred,
  TimeoutError,
  RetryExhaustedError
};
