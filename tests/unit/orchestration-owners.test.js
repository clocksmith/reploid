// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createPartitionPreparationOwner } from '../../packages/reploid/src/mesh/partitions/preparation-owner.js';
import { createHttpRequestOwner } from '../../server/http-request-owner.js';
import { resolveRuntimeMode } from '../../self/core/runtime-mode.js';

afterEach(() => vi.useRealTimers());

it('retries only failed preparation resources and releases ownership after settlement', async () => {
  const source = { storage: { close: vi.fn().mockRejectedValueOnce(Error('storage busy')).mockResolvedValue() } };
  const release = { close: vi.fn().mockResolvedValue() }, resident = { close: vi.fn().mockResolvedValue() };
  const deregister = vi.fn(), onSettled = vi.fn();
  const owner = createPartitionPreparationOwner({ source, registerCleanup: () => deregister, onSettled });
  owner.release = release; owner.resident = resident;
  await expect(owner.close()).rejects.toThrow('storage busy');
  expect(deregister).not.toHaveBeenCalled();
  await owner.close(); await owner.close();
  expect(resident.close).toHaveBeenCalledTimes(1);
  expect(release.close).toHaveBeenCalledTimes(1);
  expect(source.storage.close).toHaveBeenCalledTimes(2);
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(deregister).toHaveBeenCalledTimes(1);
});

it('aborts disconnected HTTP work while retaining it until the caller settles', async () => {
  const owner = createHttpRequestOwner({ timeoutMs: 1000 });
  const req = new EventEmitter(), res = new EventEmitter();
  const scope = owner.begin(req, res, { disconnectError: () => Error('disconnected'), deadlineError: () => Error('deadline') });
  req.emit('aborted');
  expect(scope.signal.reason.message).toBe('disconnected');
  expect(owner.size).toBe(1);
  const closing = owner.close(() => Error('closed'), () => Error('unsettled'));
  scope.finish(); await closing;
  expect(owner.size).toBe(0);
  expect(req.listenerCount('aborted')).toBe(0);
  expect(res.listenerCount('close')).toBe(0);
});

it('keeps HTTP cleanup retryable after its settlement deadline', async () => {
  vi.useFakeTimers();
  const owner = createHttpRequestOwner({ timeoutMs: 5 });
  const scope = owner.begin(new EventEmitter(), new EventEmitter(), {
    disconnectError: () => Error('disconnected'), deadlineError: () => Error('deadline')
  });
  const pending = owner.close(() => Error('closed'), () => Error('unsettled'));
  const assertion = expect(pending).rejects.toThrow('unsettled');
  await vi.advanceTimersByTimeAsync(5); await assertion;
  expect(owner.size).toBe(1);
  scope.finish();
  await owner.close(() => Error('closed'), () => Error('unsettled'));
  expect(vi.getTimerCount()).toBe(0);
});

it('resolves explicit, boot and stored modes consistently without accepting unknown modes', () => {
  const storage = { getItem: () => 'x' };
  expect(resolveRuntimeMode({ win: {}, storage })).toBe('x');
  expect(resolveRuntimeMode({ win: { getReploidMode: () => 'zero' }, storage })).toBe('zero');
  expect(resolveRuntimeMode({ mode: 'x', win: { getReploidMode: () => 'zero' }, storage })).toBe('x');
  expect(() => resolveRuntimeMode({ mode: 'unknown', storage })).toThrow('Unknown runtime mode');
  expect(resolveRuntimeMode({ win: {}, storage: { getItem() { throw Error('unavailable'); } } })).toBe('reploid');
});
