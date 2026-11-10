import { describe, it, expect, vi } from 'vitest';
import { abortable, abortableBefore } from '../../packages/reploid/src/cancellation.js';

describe('borrowed operation cancellation', () => {
  it('releases its signal listener even when the borrowed operation never settles', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const pending = abortable(() => { started(); return new Promise(() => {}); }, controller.signal);
    const rejected = expect(pending).rejects.toThrow('cancel pending host work');
    await ready;
    controller.abort(new Error('cancel pending host work'));
    await rejected;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('stops waiting at the deadline with the caller\'s error, or earlier on abort with the signal\'s reason', async () => {
    const never = () => new Promise(() => {});
    const expired = () => new Error('admission deadline exceeded');
    await expect(abortableBefore(never, new AbortController().signal, { deadline: Date.now() + 5, expired }))
      .rejects.toThrow('admission deadline exceeded');
    const controller = new AbortController();
    const pending = abortableBefore(never, controller.signal, { deadline: Date.now() + 60_000, expired });
    controller.abort(new Error('caller stopped'));
    await expect(pending).rejects.toThrow('caller stopped');
    await expect(abortableBefore(async () => 'admitted', new AbortController().signal, { deadline: Date.now() + 60_000, expired }))
      .resolves.toBe('admitted');
  });
});
