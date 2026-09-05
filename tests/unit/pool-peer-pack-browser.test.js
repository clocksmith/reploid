import { describe, it, expect } from 'vitest';
import { assertPhysicalAdapter } from '../fixtures/peer-pack-browser.js';

describe('peer execution physical-adapter evidence', () => {
  it('accepts explicit non-fallback evidence at either browser API location', () => {
    expect(assertPhysicalAdapter({ info: { isFallbackAdapter: false } })).toBe(false);
    expect(assertPhysicalAdapter({ isFallbackAdapter: false })).toBe(false);
  });

  it('rejects fallback, absent, malformed, and contradictory evidence', () => {
    for (const adapter of [null, {}, { info: {} }, { isFallbackAdapter: true },
      { info: { isFallbackAdapter: true } }, { info: { isFallbackAdapter: 'false' } },
      { info: { isFallbackAdapter: false }, isFallbackAdapter: true },
      { info: { isFallbackAdapter: true }, isFallbackAdapter: false }]) {
      expect(() => assertPhysicalAdapter(adapter)).toThrow('confirmed non-fallback');
    }
  });
});
