export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; this.isTimeout = true; }
}

export class RetryExhaustedError extends Error {
  constructor(message, attempts, lastError) {
    super(message); this.name = 'RetryExhaustedError'; this.attempts = attempts; this.lastError = lastError;
  }
}

function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((r) => { clearTimeout(timeoutId); resolve(r); }).catch((e) => { clearTimeout(timeoutId); reject(e); });
  });
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function withTimeoutAndRetry(fn, options = {}) {
  const { timeoutMs = 30000, operationName = 'Operation', maxAttempts = 3, initialDelayMs = 1000, shouldRetry = () => true, onRetry } = options;
  let lastError, delayMs = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await withTimeout(fn(attempt), timeoutMs, `${operationName} (attempt ${attempt})`); }
    catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) break;
      if (onRetry) onRetry(error, attempt, delayMs);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
  throw new RetryExhaustedError(`Operation failed after ${maxAttempts} attempts`, maxAttempts, lastError);
}
