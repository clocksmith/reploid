import { describe, expect, it } from 'vitest';
import { rectanglesOverlap } from '../../scripts/deploy-surface-layout.js';

describe('deployment navigation clearance', () => {
  const header = { left: 0, right: 1440, top: 0, bottom: 92 };
  const sidebar = { left: 0, right: 80, top: 0, bottom: 900 };
  it('accepts centered content below the current full-width header', () => {
    expect(rectanglesOverlap(header, { left: 405, right: 1035, top: 100, bottom: 900 })).toBe(false);
  });
  it('accepts content to the right of a sidebar', () => {
    expect(rectanglesOverlap(sidebar, { left: 80, right: 1400, top: 0, bottom: 900 })).toBe(false);
  });
  it('rejects content under a header even when horizontally centered', () => {
    expect(rectanglesOverlap(header, { left: 405, right: 1035, top: 91, bottom: 900 })).toBe(true);
  });
  it('rejects the original sidebar overlap regression', () => {
    expect(rectanglesOverlap(sidebar, { left: 79, right: 1400, top: 100, bottom: 900 })).toBe(true);
  });
  it('accepts touching edges without accepting a real intersection', () => {
    expect(rectanglesOverlap(header, { left: 0, right: 1440, top: 92, bottom: 900 })).toBe(false);
    expect(rectanglesOverlap(header, header)).toBe(true);
  });
  it('fails closed on missing, non-finite or invisible measurements', () => {
    for (const invalid of [null, {}, { ...header, top: NaN }, { ...header, bottom: 0 }]) {
      expect(() => rectanglesOverlap(header, invalid)).toThrow(/visible, finite/);
      expect(() => rectanglesOverlap(invalid, header)).toThrow(/visible, finite/);
    }
  });
});
