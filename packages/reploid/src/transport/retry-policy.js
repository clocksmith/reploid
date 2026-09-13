/**
 * @fileoverview Shared bounded retry policy for Poolday browser transports.
 */

const finiteMilliseconds = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export function retryAfterMsFromError(error, { maxDelayMs } = {}) {
  const bound = Math.max(1, finiteMilliseconds(maxDelayMs));
  const explicit = finiteMilliseconds(error?.retryAfterMs);
  const seconds = finiteMilliseconds(error?.retryAfter) * 1000;
  const requested = explicit || seconds;
  return Math.min(bound, requested);
}

export function boundedRetryDelay({
  consecutiveFailures = 0,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  retryAfterMs = 0
} = {}) {
  const maximum = Math.max(1, finiteMilliseconds(maxDelayMs));
  const base = Math.min(maximum, Math.max(1, finiteMilliseconds(baseDelayMs)));
  const failures = Math.max(0, Math.floor(finiteMilliseconds(consecutiveFailures)));
  const exponential = failures === 0
    ? 0
    : Math.min(maximum, base * (2 ** Math.max(0, failures - 1)));
  return Math.max(exponential, Math.min(maximum, finiteMilliseconds(retryAfterMs)));
}

export default {
  boundedRetryDelay,
  retryAfterMsFromError
};
