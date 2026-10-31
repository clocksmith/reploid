import { describe, expect, it } from 'vitest';
import { createPoolStore } from '../../server/pool/store.js';

describe('bounded in-memory Pool admission buckets', () => {
  it('refuses new identities at capacity without resetting existing quotas and recovers after expiry', () => {
    const store = createPoolStore();
    const consume = (key, now = 100) => store.consumeRateLimit({ key, now, maxRequests: 1, bucketMs: 1000 });
    for (let index = 0; index < 10000; index += 1) expect(consume(`client-${index}`).allowed).toBe(true);
    expect(consume('overflow').allowed).toBe(false);
    expect(consume('client-0').allowed).toBe(false);
    expect(consume('overflow', 1100).allowed).toBe(true);
  });
});
