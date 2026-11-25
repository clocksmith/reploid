import { expect, it, vi } from 'vitest';
import { createCoalescedRefresh } from '../../apps/poolday/host/coalesced-refresh.js';

it('refreshes at once when idle, folds a burst into one later refresh, and spaces slow refreshes by twice their cost', () => {
  vi.useFakeTimers();
  try {
    let clock = 0, cost = 1;
    const runs = [];
    const refresh = createCoalescedRefresh(() => { runs.push(clock); clock += cost; }, { minimumMs: 100, now: () => clock });
    // A swarm event after a quiet spell is shown at once.
    refresh.request();
    expect(runs).toEqual([0]);
    // A burst of 50 peer events inside the interval becomes one refresh at its end.
    for (let event = 0; event < 50; event++) refresh.request();
    expect(runs).toHaveLength(1);
    clock = 101; vi.advanceTimersByTime(100);
    expect(runs).toEqual([0, 101]);
    // A refresh that takes 300 ms on a loaded computer: the next waits 600 ms after it, not 100.
    cost = 300; clock = 500; refresh.request();
    expect(runs).toEqual([0, 101, 500]);
    refresh.request();
    clock = 900; vi.advanceTimersByTime(400);
    expect(runs).toHaveLength(3);
    clock = 1400; vi.advanceTimersByTime(200);
    expect(runs).toEqual([0, 101, 500, 1400]);
    // Closed: nothing pending runs and new requests are ignored.
    refresh.request(); refresh.close(); vi.advanceTimersByTime(10000); refresh.request();
    expect(runs).toHaveLength(4);
  } finally { vi.useRealTimers(); }
});

it('keeps refreshing after a refresh throws', () => {
  let clock = 0, calls = 0;
  const refresh = createCoalescedRefresh(() => { calls++; throw new Error('listener failed'); }, { minimumMs: 100, now: () => clock });
  expect(() => refresh.request()).toThrow('listener failed');
  clock = 500;
  expect(() => refresh.request()).toThrow('listener failed');
  expect(calls).toBe(2);
});
