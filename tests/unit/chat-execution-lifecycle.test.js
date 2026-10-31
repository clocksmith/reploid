import { afterEach, expect, it, vi } from 'vitest';

const { createScheduler } = vi.hoisted(() => ({ createScheduler: vi.fn() }));
vi.mock('../../self/vendor/reploid/chat/index.js', () => ({
  createChatScheduler: createScheduler,
  remoteDisclosureKind: () => null
}));
import { createChatExecution } from '../../self/host/chat-execution.js';

const options = () => ({ service: {}, models: [], getModels: () => [], profile: {} });
afterEach(() => { createScheduler.mockReset(); });

it('retries an owned scheduler after failed close and shares in-flight closure', async () => {
  const close = vi.fn().mockRejectedValueOnce(new Error('Cleanup failed')).mockResolvedValue(undefined);
  createScheduler.mockReturnValue({ close });
  const execution = createChatExecution(options());
  const first = execution.close();
  expect(execution.close()).toBe(first);
  await expect(first).rejects.toThrow('Cleanup failed');
  await execution.close();
  await execution.close();
  expect(close).toHaveBeenCalledTimes(2);
});

it('never closes a borrowed scheduler', async () => {
  const close = vi.fn();
  const execution = createChatExecution({ ...options(), scheduler: { close } });
  await execution.close();
  await execution.close();
  expect(createScheduler).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
