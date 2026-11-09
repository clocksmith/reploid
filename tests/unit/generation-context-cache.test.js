import { it, expect, vi } from 'vitest';
import { createGenerationContextCache } from '../../packages/reploid/src/mesh/generation-context-cache.js';

it('retains independent contexts, evicts the least recent idle context and reserves bytes before creation', () => {
  const created = [];
  const cache = createGenerationContextCache({ policy: { maxEntries: 4, maxBytes: 20, maxEntryBytes: 10, idleMs: 1000 },
    create: () => { const context = { close: vi.fn() }; created.push(context); return context; } });
  const a = cache.acquire('requester-a/thread-a'), b = cache.acquire('requester-b/thread-a');
  expect(a.context).not.toBe(b.context);
  expect(cache.acquire('third')).toBeNull();
  a.release(); b.release();
  const again = cache.acquire('requester-a/thread-a');
  expect(again.context).toBe(a.context); again.release();
  const third = cache.acquire('third');
  expect(b.context.close).toHaveBeenCalledOnce();
  expect(a.context.close).not.toHaveBeenCalled();
  third.release(); cache.close();
  expect(created.every(context => context.close.mock.calls.length === 1)).toBe(true);
});

it('charges actual retained bytes while reserving the full allowance for active execution', () => {
  const cache = createGenerationContextCache({ policy: { maxEntries: 4, maxBytes: 20, maxEntryBytes: 10, idleMs: 1000 },
    create: () => ({ close: vi.fn(), getStats: () => ({ allocatedBytes: 3 }) }) });
  const a = cache.acquire('a'); a.release();
  const b = cache.acquire('b'); b.release();
  const c = cache.acquire('c'); c.release();
  const d = cache.acquire('d');
  expect([a, b, c].every(item => item.context.close.mock.calls.length === 0)).toBe(true);
  d.release(); cache.close();
});

it('surfaces an expiry failure on the next admission and permits cleanup retry', () => {
  vi.useFakeTimers();
  try {
    const close = vi.fn().mockImplementationOnce(() => { throw new Error('cleanup failed'); });
    const cache = createGenerationContextCache({ policy: { maxEntries: 1, maxBytes: 10, maxEntryBytes: 10, idleMs: 10 },
      create: () => ({ close }) });
    cache.acquire('a').release(); vi.advanceTimersByTime(11);
    expect(() => cache.acquire('b')).toThrow('expiry failed');
    cache.close(); expect(close).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('expires idle memory, never expires executing memory, and discards cancelled work after settlement', () => {
  vi.useFakeTimers();
  try {
    const create = () => ({ close: vi.fn() });
    const cache = createGenerationContextCache({ policy: { maxEntries: 2, maxBytes: 20, maxEntryBytes: 10, idleMs: 50 }, create });
    const a = cache.acquire('a'), b = cache.acquire('b');
    a.release(); vi.advanceTimersByTime(51);
    expect(a.context.close).toHaveBeenCalledOnce();
    expect(b.context.close).not.toHaveBeenCalled();
    expect(() => cache.close()).toThrow('settle');
    b.release({ discard: true });
    expect(b.context.close).toHaveBeenCalledOnce();
    cache.close(); expect(() => cache.acquire('a')).toThrow('closed');
  } finally { vi.useRealTimers(); }
});
