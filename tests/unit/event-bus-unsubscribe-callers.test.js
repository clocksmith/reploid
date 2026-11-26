import { describe, expect, it, vi } from 'vitest';
import EventBusModule from '../../shared/infrastructure/event-bus.js';
import UtilsModule from '../../shared/core/utils.js';
import SemanticMemoryModule from '../../self/capabilities/cognition/semantic/semantic-memory-llm.js';

// The event bus has no off(): a subscriber keeps the function on() returns. These callers used to
// call EventBus.off on dispose, which threw, so the handler was never removed.
describe('event bus subscribers release their handlers on dispose', () => {
  it('semantic memory stops learning from agent history after dispose', async () => {
    vi.useFakeTimers();
    const Utils = UtilsModule.factory();
    const EventBus = EventBusModule.factory({ Utils });
    const files = new Map();
    const VFS = {
      read: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path); },
      write: async (path, text) => { files.set(path, text); },
      exists: async path => files.has(path)
    };
    const memory = SemanticMemoryModule.factory({ Utils, EventBus, VFS, LLMClient: {} });
    await memory.init();
    await expect(memory.dispose()).resolves.toBeUndefined();
    // After dispose nothing is subscribed, so emitting cannot schedule learning work.
    const spy = vi.spyOn(globalThis, 'setTimeout');
    EventBus.emit('agent:history', { type: 'llm_response', content: 'x'.repeat(200) });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('a second init does not add a second subscription', async () => {
    const Utils = UtilsModule.factory();
    const EventBus = EventBusModule.factory({ Utils });
    const on = vi.spyOn(EventBus, 'on');
    const VFS = { read: async () => { throw new Error('missing'); }, write: async () => {}, exists: async () => false };
    const memory = SemanticMemoryModule.factory({ Utils, EventBus, VFS, LLMClient: {} });
    await memory.init();
    await memory.dispose();
    await memory.init();
    expect(on).toHaveBeenCalledTimes(2);
    await memory.dispose();
  });
});
