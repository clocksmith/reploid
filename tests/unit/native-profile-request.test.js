// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { runNativeProfileRequest, NATIVE_PROFILE_TIMING_SCOPE } from '../fixtures/native-profile-request.js';

function fixture() {
  const request = { prompt: 'prompt', promptIds: [1, 2], generation: { maxTokens: 3, temperature: 0,
    topK: 1, topP: 1, repetitionPenalty: 1, seed: 0 }, timeoutMs: 1000 };
  const receipt = { inputTokenIds: [1, 2], generatedTokenIds: [5, 6, 7], outputText: 'result',
    policy: { id: 'demo/deep-xray', modifiesExecution: true, performanceRepresentative: false, gpuTimestampQueries: true },
    performanceRepresentative: false, tokens: ['private'], quality: { private: true }, activationTrace: { private: true },
    generationEvidence: { logits: [99], runtimeConfig: { private: true }, stats: {
      gpuTimeDecodeMs: 3, gpuTimePrefillMs: null, singleTokenReadbackWaitMs: 4,
      unrelated: [9], decodeProfileSteps: [1, 2].map(step => ({ step, totalMs: step, timings: { projection: step },
        recorderStats: { dispatches: [{ private: true }], profile: { status: 'complete', computePasses: 1,
          measuredPasses: 1, unmeasuredPasses: 0, intervals: [{ private: true }] } } })),
    } } };
  const model = { resetGenerationState: vi.fn(), inspect: { generate: vi.fn(async () => receipt) } };
  return { request: { ...request, model }, model, receipt };
}

it('uses the fixed deep-xray policy and returns detached bounded timing evidence only', async () => {
  const f = fixture(), result = await runNativeProfileRequest(f.request);
  expect(f.model.resetGenerationState).toHaveBeenCalledOnce();
  const [prompt, options] = f.model.inspect.generate.mock.calls[0];
  expect(prompt).toBe('prompt'); expect(options.policyId).toBe('demo/deep-xray');
  expect(options.inputTokenIds).toEqual([1, 2]); expect(options.generation).toMatchObject(f.request.generation);
  expect(options.generation.signal).toBeInstanceOf(AbortSignal); expect(options).not.toHaveProperty('onEvent');
  expect(result.timingScope).toBe(NATIVE_PROFILE_TIMING_SCOPE); expect(result.performanceRepresentative).toBe(false);
  expect(result.generationStats).toEqual({ gpuTimeDecodeMs: 3, singleTokenReadbackWaitMs: 4 });
  expect(Object.keys(result).sort()).toEqual(['decodeProfileSteps', 'generationStats', 'inputIds', 'performanceRepresentative',
    'policy', 'sampledIds', 'text', 'timingScope', 'wallMs']);
  expect(result.decodeProfileSteps[0]).not.toHaveProperty('recorderStats');
  f.receipt.generatedTokenIds[0] = 999; f.receipt.generationEvidence.stats.decodeProfileSteps[0].timings.projection = 999;
  expect(result.sampledIds).toEqual([5, 6, 7]); expect(result.decodeProfileSteps[0].timings.projection).toBe(1);
});

it('snapshots IDs/settings before reset and applies the original exact request', async () => {
  const f = fixture(); f.model.resetGenerationState = async () => {
    f.request.promptIds[0] = 9; f.request.generation.maxTokens = 99; f.request.generation.temperature = 1;
  };
  await runNativeProfileRequest(f.request);
  const options = f.model.inspect.generate.mock.calls[0][1];
  expect(options.inputTokenIds).toEqual([1, 2]); expect(options.generation.maxTokens).toBe(3); expect(options.generation.temperature).toBe(0);
});

it('rejects wrong inputs, representative policies, missing timestamps and partial compute coverage', async () => {
  for (const change of [r => { r.inputTokenIds = [9]; }, r => { r.policy.id = 'demo/always-on'; },
    r => { r.performanceRepresentative = true; }, r => { r.policy.gpuTimestampQueries = false; },
    r => { r.generatedTokenIds = [5, -1]; }, r => { r.generatedTokenIds = [1, 2, 3, 4]; },
    r => { r.generationEvidence.stats.gpuTimeDecodeMs = null; }, r => { r.generationEvidence.stats.gpuTimeDecodeMs = NaN; },
    r => { r.generationEvidence.stats.decodeProfileSteps = []; }, r => { r.generationEvidence.stats.decodeProfileSteps.pop(); },
    r => { r.generationEvidence.stats.decodeProfileSteps[0].timings = {}; },
    r => { r.generationEvidence.stats.decodeProfileSteps[0].timings.projection = Infinity; },
    r => { r.generationEvidence.stats.decodeProfileSteps[0].recorderStats.profile.status = 'incomplete'; },
    r => { r.generationEvidence.stats.decodeProfileSteps[0].recorderStats.profile.unmeasuredPasses = 1; },
    r => { r.generationEvidence.stats.gpuTimeDecodeMs = 4; }]) {
    const f = fixture(); change(f.receipt); await expect(runNativeProfileRequest(f.request)).rejects.toThrow();
  }
});

it('honors pre-abort without reset or generation and rejects cancellation after capture before publication', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(new Error('pre-aborted profile'));
  await expect(runNativeProfileRequest({ ...f.request, signal: controller.signal })).rejects.toThrow('pre-aborted profile');
  expect(f.model.resetGenerationState).not.toHaveBeenCalled(); expect(f.model.inspect.generate).not.toHaveBeenCalled();
  const other = fixture(), active = new AbortController();
  other.model.inspect.generate = async () => { active.abort(new Error('cancel profile')); return other.receipt; };
  await expect(runNativeProfileRequest({ ...other.request, signal: active.signal })).rejects.toThrow('cancel profile');
});

it('keeps an independent exact-input witness even if the model mutates its received ID array', async () => {
  const f = fixture();
  f.model.inspect.generate = async (prompt, options) => {
    options.inputTokenIds[0] = 99; f.receipt.inputTokenIds = options.inputTokenIds; return f.receipt;
  };
  await expect(runNativeProfileRequest(f.request)).rejects.toThrow(/input IDs changed/u);
});

it('passes its deadline to generation and permits independent recovery', async () => {
  const f = fixture(); f.model.inspect.generate = async (prompt, options) => new Promise((resolve, reject) => {
    options.generation.signal.addEventListener('abort', () => reject(options.generation.signal.reason), { once: true });
  });
  await expect(runNativeProfileRequest({ ...f.request, timeoutMs: 5 })).rejects.toThrow(/timed out|timeout/iu);
  expect((await runNativeProfileRequest(fixture().request)).sampledIds).toEqual([5, 6, 7]);
});
