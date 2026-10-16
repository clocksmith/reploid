import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeoutAndRetry } from '../../packages/reploid/src/agent/tool-operation-retry.js';
import spawnWorker from '../../self/tools/SpawnWorker.js';
import loadModule from '../../self/tools/LoadModule.js';

afterEach(() => vi.useRealTimers());

describe('tool operation retries', () => {
  it('returns the original result without retrying a successful operation', async () => {
    const result = { workerId: 'worker-1' };
    const operation = vi.fn().mockResolvedValue(result);
    expect(await withTimeoutAndRetry(operation)).toBe(result);
    expect(operation).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('retains attempt numbers, backoff and the retry callback', async () => {
    vi.useFakeTimers();
    const error = new Error('busy');
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ready');
    const onRetry = vi.fn();
    const result = withTimeoutAndRetry(operation, { initialDelayMs: 20, onRetry });
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe('ready');
    expect(operation.mock.calls).toEqual([[1], [2]]);
    expect(onRetry).toHaveBeenCalledWith(error, 1, 20);
  });

  it('does not retry a rejected error excluded by the caller policy', async () => {
    const error = new SyntaxError('invalid module');
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withTimeoutAndRetry(operation, { shouldRetry: () => false })).rejects.toMatchObject({
      name: 'RetryExhaustedError', lastError: error
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('preserves timeout details and clears its timer', async () => {
    vi.useFakeTimers();
    const pending = withTimeoutAndRetry(() => new Promise(() => {}), { timeoutMs: 10, maxAttempts: 1 });
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'RetryExhaustedError', lastError: { name: 'TimeoutError', isTimeout: true }
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps SpawnWorker using its supplied manager and result shape', async () => {
    const spawn = vi.fn().mockResolvedValue({ workerId: 'worker-2', promise: Promise.resolve() });
    const result = await spawnWorker({ task: 'inspect', type: 'analyze' }, { WorkerManager: { spawn } });
    expect(result).toMatchObject({ workerId: 'worker-2', type: 'analyze', status: 'spawned' });
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'inspect', type: 'analyze', depth: 0 }));
  });
  it('keeps consumer failure messages when retries are exhausted', async () => {
    await expect(spawnWorker({ task: 'inspect', maxRetries: 0 }, {
      WorkerManager: { spawn: () => Promise.reject(new Error('pool unavailable')) }
    })).rejects.toThrow('Worker spawn failed after 1 attempts: pool unavailable');
    await expect(loadModule({ path: '/self/example.js', maxRetries: 0 }, {
      SubstrateLoader: { loadModule: () => Promise.reject(new Error('module unavailable')) }
    })).rejects.toThrow('Module load failed after 1 attempts: module unavailable');
  });

});
