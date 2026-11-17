import assert from 'node:assert/strict';

// Explicit boundary-only telemetry. Never called by the timed request helper.
export function observeNativeExpertLoading(config, model, phase) {
  assert(config.expertLoadingObservation === undefined || typeof config.expertLoadingObservation === 'boolean',
    'expertLoadingObservation must be an explicit boolean');
  if (config.expertLoadingObservation !== true) return undefined;
  assert(phase === 'open' || phase === 'request', 'Expert observation requires an operation boundary');
  assert(typeof model?.advanced?.getExpertLoadingStats === 'function',
    'Selected source lacks explicit expert-loading observation');
  const stats = model.advanced.getExpertLoadingStats();
  assert(stats?.schema === 'doppler.expert-loading-stats/v1', 'Invalid expert-loading snapshot contract');
  return { phase, stats, scope: 'Explicit CPU snapshot after the operation clock stops; async counter sums may overlap; no GPU timing' };
}
