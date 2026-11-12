export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; this.isTimeout = true; }
}

export class RetryExhaustedError extends Error {
  constructor(message, attempts, lastError) {
    super(message); this.name = 'RetryExhaustedError'; this.attempts = attempts; this.lastError = lastError;
  }
}

/**
 * Stops waiting for `promise` after `timeoutMs` with a TimeoutError. The
 * operation itself is not stopped unless `controller` is supplied and honored.
 */
export function withTimeout(promise, timeoutMs, operationName = 'Operation', controller = null) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const error = new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`);
      controller?.abort(error);
      reject(error);
    }, timeoutMs);
    promise.then((r) => { clearTimeout(timeoutId); resolve(r); }).catch((e) => { clearTimeout(timeoutId); reject(e); });
  });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function withTimeoutAndRetry(fn, options = {}) {
  const { timeoutMs = 30000, operationName = 'Operation', maxAttempts = 3, initialDelayMs = 1000, shouldRetry = () => true, onRetry } = options;
  let lastError, delayMs = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    try { return await withTimeout(Promise.resolve().then(() => fn(attempt, controller.signal)), timeoutMs, `${operationName} (attempt ${attempt})`, controller); }
    catch (error) {
      lastError = error;
      // A deadline does not prove the borrowed operation stopped. Never replay it.
      if (error instanceof TimeoutError || attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw new RetryExhaustedError(`Operation failed after ${attempt} attempts`, attempt, error);
      }
      if (onRetry) onRetry(error, attempt, delayMs);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
  throw new RetryExhaustedError(`Operation failed after ${maxAttempts} attempts`, maxAttempts, lastError);
}
