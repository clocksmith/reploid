import { describe, expect, it } from 'vitest';
import { summarizeStartup } from '../../scripts/verify-gpu-startup.js';

describe('cold browser startup evidence denominator', () => {
  it('retains earlier initialization failures when a later attempt succeeds', () => {
    const result = summarizeStartup([
      { passed: false, stage: 'adapter-request', elapsedMs: 100 },
      { passed: false, stage: 'adapter-request', elapsedMs: 110 },
      { passed: false, stage: 'device-request', elapsedMs: 120 },
      { passed: true, stage: 'ready', elapsedMs: 150 }
    ], 4);
    expect(result).toMatchObject({ attempts: 4, successes: 1, failures: 3, successFraction: 0.25,
      failureBoundaries: { 'adapter-request': 2, 'device-request': 1 } });
  });
  it('cannot declare a completed experiment after dropping planned observations', () => {
    expect(() => summarizeStartup([{ passed: true, elapsedMs: 1 }], 20)).toThrow('Every planned startup');
    expect(() => summarizeStartup([], 0)).toThrow();
    expect(summarizeStartup([{ passed: false, stage: 'launch' }], 1).successfulStartupMs).toBeNull();
  });
});
