import { describe, expect, it } from 'vitest';
import UtilsModule from '../../shared/core/utils.js';
import EventBusModule from '../../shared/infrastructure/event-bus.js';
import CircuitBreakerModule from '../../self/infrastructure/circuit-breaker.js';
import ErrorStoreModule from '../../self/infrastructure/error-store.js';

// The error store listened for tool:circuit_open, which nothing emits; the breaker emits circuit:open.
describe('error store records a tripped circuit', () => {
  it('adds a warning when a circuit breaker opens', async () => {
    const Utils = UtilsModule.factory();
    const EventBus = EventBusModule.factory({ Utils });
    const files = new Map();
    const VFS = {
      read: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path); },
      write: async (path, text) => { files.set(path, text); return true; },
      exists: async path => files.has(path),
      mkdir: async () => true
    };
    const store = ErrorStoreModule.factory({ Utils, VFS, EventBus });
    const breaker = CircuitBreakerModule.factory({ Utils, EventBus }).create({ name: 'ToolBreaker', threshold: 2 });
    breaker.recordFailure('ReadFile', new Error('timeout'));
    breaker.recordFailure('ReadFile', new Error('timeout'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const errors = await store.getErrors();
    expect(errors.some(e => e.type === 'circuit:open' && /ReadFile/.test(e.message))).toBe(true);
  });
});
