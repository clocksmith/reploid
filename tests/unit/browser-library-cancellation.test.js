import { describe, it, expect, vi } from 'vitest';
import { abortable } from '../../packages/reploid/src/agent/cancellation.js';

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
});
