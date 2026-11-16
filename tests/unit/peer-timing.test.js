import { afterEach, expect, it, vi } from 'vitest';
import { observeWithTimeout } from '../../apps/poolday/pool/observation-timeout.js';
import { getPeerExecutionConfig } from '../../apps/poolday/host/peer-execution-config.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('resolves relay budgets and freezes overrides at dispatch without sharing mutable generation', () => {
  window.history.replaceState(null, '', '/?relay=local');
  const local = getPeerExecutionConfig();
  window.history.replaceState(null, '', '/?relay=server');
  vi.stubGlobal('REPLOID_POOL_RECEIPT_WINDOW_MS', 1234);
  const server = getPeerExecutionConfig();
  expect(local.discoveryWindowMs).toBe(1200);
  expect(server.discoveryWindowMs).toBe(8000);
  expect(server.transportConnectWindowMs).toBe(20000);
  expect(server.queueWindowMs).toBe(1234);
  expect(local.receiptWindowMs).toBe(60000);
  expect(Object.isFrozen(server)).toBe(true);
  expect(server.generation).not.toBe(local.generation);
});
it('times out observation without cancelling borrowed work and observes its later rejection', async () => {
  vi.useFakeTimers();
  let reject;
  const work = new Promise((_resolve, failed) => { reject = failed; });
  const bounded = observeWithTimeout(work, 10, 'observation deadline');
  const assertion = expect(bounded).rejects.toThrow('observation deadline');
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
  reject(new Error('borrowed work settled later'));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
it('clears the deadline on early success or failure', async () => {
  vi.useFakeTimers();
  await expect(observeWithTimeout(Promise.resolve(42), 10, 'late')).resolves.toBe(42);
  await expect(observeWithTimeout(Promise.reject(new Error('original')), 10, 'late')).rejects.toThrow('original');
  expect(vi.getTimerCount()).toBe(0);
});
