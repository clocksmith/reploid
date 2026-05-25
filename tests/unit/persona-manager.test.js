import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PersonaManager from '../../self/core/persona-manager.js';

describe('PersonaManager', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no fixture')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('seeds the browser ecosystem model into core persona instructions', async () => {
    const manager = PersonaManager.factory({
      Utils: { logger },
      VFS: null,
      EventBus: null
    });

    const slots = await manager.getPromptSlots();
    const prompt = slots.coreInstructions;

    expect(prompt).toContain('same-origin browser substrate');
    expect(prompt).toContain('/self is canonical');
    expect(prompt).toContain('A terminal exposes host shell power');
    expect(prompt).toContain('IndexedDB stores live self, memory, traces, and code');
    expect(prompt).toContain('OPFS stores larger artifacts');
    expect(prompt).toContain('Service Worker and blob module loading');
    expect(prompt).toContain('Web Workers isolate verification');
    expect(prompt).toContain('WebGPU, WASM, canvas, and media APIs');
    expect(prompt).toContain('WebRTC, BroadcastChannel, and WebSocket paths');
    expect(prompt).toContain('permission-mediated browser APIs');
    expect(prompt).toContain('Default to Shadow for self changes');
    expect(prompt).not.toContain('browser-based VFS');
    expect(prompt).not.toContain('full DOM access');
    expect(prompt).not.toContain('all Web APIs');
  });
});
