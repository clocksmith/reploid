import assert from 'node:assert/strict';

export const NATIVE_PROFILE_TIMING_SCOPE = 'deep-xray-reset-to-inspection-receipt/diagnostic-v1';

// Explicit instrumented diagnostics only. Deep X-Ray collects quality evidence,
// enables GPU timestamp queries and changes command batching; never a speed claim.
export async function runNativeProfileRequest({ model, prompt, promptIds, generation, timeoutMs, signal }) {
  assert(typeof prompt === 'string' && prompt.length > 0 && Array.isArray(promptIds) && promptIds.length > 0
    && promptIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Profile request requires exact prompt IDs');
  assert(generation && Number.isSafeInteger(generation.maxTokens) && generation.maxTokens >= 2
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'Profile request requires finite decode and timeout bounds');
  const ids = [...promptIds], settings = structuredClone(generation);
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  active.throwIfAborted();
  const started = performance.now();
  await model.resetGenerationState();
  active.throwIfAborted();
  const receipt = await model.inspect.generate(prompt, {
    policyId: 'demo/deep-xray', inputTokenIds: [...ids], generation: { ...settings, signal: active },
  });
  active.throwIfAborted();
  const wallMs = performance.now() - started;
  assert.deepEqual(receipt.inputTokenIds, ids, 'Profile request input IDs changed');
  assert(receipt.policy?.id === 'demo/deep-xray' && receipt.policy.modifiesExecution === true
    && receipt.policy.performanceRepresentative === false && receipt.policy.gpuTimestampQueries === true
    && receipt.performanceRepresentative === false, 'Profile request requires the explicit nonrepresentative GPU timestamp policy');
  assert(typeof receipt.outputText === 'string' && Array.isArray(receipt.generatedTokenIds)
    && receipt.generatedTokenIds.length >= 2 && receipt.generatedTokenIds.length <= settings.maxTokens
    && receipt.generatedTokenIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Invalid profiled generated IDs');
  const stats = receipt.generationEvidence?.stats;
  assert(stats && Number.isFinite(stats.gpuTimeDecodeMs) && stats.gpuTimeDecodeMs >= 0
    && Array.isArray(stats.decodeProfileSteps) && stats.decodeProfileSteps.length > 0,
  'Complete GPU decode timestamp capture is required');
  assert.equal(stats.decodeProfileSteps.length, receipt.generatedTokenIds.length - 1, 'GPU decode timing steps are partial');
  const decodeProfileSteps = stats.decodeProfileSteps.map((entry, index) => {
    const coverage = entry.recorderStats?.profile;
    assert(entry.step === index + 1 && entry.timings && typeof entry.timings === 'object' && !Array.isArray(entry.timings)
      && Object.keys(entry.timings).length > 0 && Object.values(entry.timings).every(ms => Number.isFinite(ms) && ms >= 0)
      && Number.isFinite(entry.totalMs) && entry.totalMs >= 0, 'Invalid or partial GPU decode step timings');
    assert(coverage?.status === 'complete' && Number.isSafeInteger(coverage.computePasses) && coverage.computePasses > 0
      && coverage.measuredPasses === coverage.computePasses && coverage.unmeasuredPasses === 0,
    'GPU decode compute-pass coverage is incomplete');
    assert.equal(Object.values(entry.timings).reduce((sum, ms) => sum + ms, 0), entry.totalMs,
      'GPU decode step total differs from captured timings');
    return { step: entry.step, totalMs: entry.totalMs, timings: { ...entry.timings },
      coverage: { status: 'complete', computePasses: coverage.computePasses,
        measuredPasses: coverage.measuredPasses, unmeasuredPasses: coverage.unmeasuredPasses } };
  });
  assert.equal(decodeProfileSteps.reduce((sum, entry) => sum + entry.totalMs, 0), stats.gpuTimeDecodeMs,
    'GPU decode total differs from complete step capture');
  const generationStats = {};
  for (const key of ['gpuTimePrefillMs', 'gpuTimeDecodeMs', 'singleTokenSubmitWaitMs', 'singleTokenReadbackWaitMs',
    'singleTokenReadbackMapWaitMs', 'singleTokenReadbackCleanupMs', 'singleTokenReadbackCopyMs', 'singleTokenOrchestrationMs']) {
    if (stats[key] === undefined || stats[key] === null) continue;
    assert(Number.isFinite(stats[key]) && stats[key] >= 0, 'Invalid selected diagnostic timing');
    generationStats[key] = stats[key];
  }
  assert(Number.isFinite(wallMs) && wallMs >= 0, 'Invalid diagnostic wall time');
  active.throwIfAborted();
  return { inputIds: [...receipt.inputTokenIds], sampledIds: [...receipt.generatedTokenIds], text: receipt.outputText,
    policy: { id: receipt.policy.id, modifiesExecution: true, performanceRepresentative: false, gpuTimestampQueries: true },
    performanceRepresentative: false, timingScope: NATIVE_PROFILE_TIMING_SCOPE, wallMs, generationStats, decodeProfileSteps };
}
