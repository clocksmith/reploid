// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { closeOwnedPeerRoom } from '../fixtures/peers/pooled/close-owned-room.js';
it('awaits shared engine/expert owners exactly once before device closure and releases only its GPU', async () => {
  const owned = {}, calls = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: owned } });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const experts = { close: vi.fn(async () => { await held; calls.push('experts'); }) };
  const engine = { experts, close: vi.fn(async () => { await experts.close(); calls.push('engine'); }) };
  const room = { ai: { engine, experts }, async close() {
    // Mirrors the SDK's swallowed, unawaited duplicate callbacks.
    this.ai.engine.close().catch(() => {}); this.ai.experts.close().catch(() => {}); calls.push('device');
  } };
  try {
    const pending = closeOwnedPeerRoom(room, new Set([owned]));
    await Promise.resolve(); await Promise.resolve(); expect(calls).toEqual([]);
    release(); await pending;
    expect(calls).toEqual(['experts', 'engine', 'device']);
    expect(experts.close).toHaveBeenCalledOnce(); expect(engine.close).toHaveBeenCalledOnce();
    expect(globalThis.navigator.gpu).toBeUndefined();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator;
  }
});
it('attempts room cleanup on owner failure and preserves another GPU instance', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), other = {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: other } });
  const room = { ai: { engine: { close() { throw new Error('failed worker'); } } }, close: vi.fn() };
  try {
    await expect(closeOwnedPeerRoom(room, new Set([{}]))).rejects.toThrow('Owned peer cleanup failed');
    expect(room.close).toHaveBeenCalledOnce(); expect(globalThis.navigator.gpu).toBe(other);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator;
  }
});
