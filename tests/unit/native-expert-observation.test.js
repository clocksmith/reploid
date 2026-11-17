// @vitest-environment node
import { expect, it } from 'vitest';
import { observeNativeExpertLoading } from '../fixtures/native-expert-observation.js';

it('leaves ordinary and legacy requests free of optional snapshot work', () => {
  const model = { get advanced() { throw Error('Ordinary operation must not inspect the model'); } };
  expect(observeNativeExpertLoading({}, model, 'request')).toBeUndefined();
  expect(observeNativeExpertLoading({ expertLoadingObservation: false }, model, 'open')).toBeUndefined();
  expect(() => observeNativeExpertLoading({ expertLoadingObservation: 'true' }, model, 'request')).toThrow('boolean');
});

it('takes one explicit typed boundary snapshot and rejects unsupported sources', () => {
  const config = { expertLoadingObservation: true };
  const snapshot = { schema: 'doppler.expert-loading-stats/v1', profilerEnabled: true,
    routedExpertCache: { phaseProfiles: { decode: { sourceReadBytes: 12 } } } };
  let calls = 0;
  const model = { advanced: { getExpertLoadingStats() { calls++; return snapshot; } } };
  const result = observeNativeExpertLoading(config, model, 'request');
  expect(result).toMatchObject({ phase: 'request', stats: snapshot });
  expect(calls).toBe(1);
  expect(result.scope).toContain('after the operation clock');
  expect(() => observeNativeExpertLoading(config, {}, 'open')).toThrow('lacks explicit');
  expect(() => observeNativeExpertLoading(config, model, 'token')).toThrow('operation boundary');
  expect(() => observeNativeExpertLoading(config, { advanced: { getExpertLoadingStats: () => ({}) } }, 'request')).toThrow('snapshot contract');
});
