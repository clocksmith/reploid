import { describe, expect, it } from 'vitest';

import { boundedRetryDelay, retryAfterMsFromError } from '../../self/pool/retry-policy.js';

describe('Poolday retry policy', () => {
  it('uses exponential retry with a hard upper bound', () => {
    expect(boundedRetryDelay({ consecutiveFailures: 1, baseDelayMs: 100, maxDelayMs: 500 })).toBe(100);
    expect(boundedRetryDelay({ consecutiveFailures: 3, baseDelayMs: 100, maxDelayMs: 500 })).toBe(400);
    expect(boundedRetryDelay({ consecutiveFailures: 5, baseDelayMs: 100, maxDelayMs: 500 })).toBe(500);
  });

  it('honors retry hints without allowing an unbounded delay', () => {
    expect(retryAfterMsFromError({ retryAfter: 2 }, { maxDelayMs: 5000 })).toBe(2000);
    expect(retryAfterMsFromError({ retryAfterMs: 9000 }, { maxDelayMs: 5000 })).toBe(5000);
    expect(boundedRetryDelay({
      consecutiveFailures: 1,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      retryAfterMs: 2000
    })).toBe(2000);
  });
});
