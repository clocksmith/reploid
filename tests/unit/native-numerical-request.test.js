// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { runNativeNumericalRequest } from '../fixtures/native-numerical-request.js';

function fixture() {
  const hash = 'a'.repeat(64), frames = [0, 1].map(layer => ({ phase: 'decode', role: 'layer-output', layer,
    shape: [1, 4], dtype: 'f32', precision: null, status: 'captured', reason: null,
    tokenIds: [1], values: [layer + 0.5, -2, 3, 4] }));
  const inspected = { inputTokenIds: [3], generatedTokenIds: [1, 2], outputText: 'result',
    policy: { id: 'demo/activation-grid', modifiesExecution: true, performanceRepresentative: false }, performanceRepresentative: false,
    generationEvidence: { stats: { reusedPrefixTokens: 0 } }, activationTrace: { schema: 'doppler.activation-trace/v1',
      status: 'complete', stoppedReason: null, geometry: { layers: 2, width: 4 },
      identity: { modelId: 'fixture', manifestHash: hash, runtimeVersion: '0.7.4' },
      frames: [{ phase: 'prefill', values: ['NEVER EXPORT PREFILL'] }, ...frames] } };
  const raw = { tokenIds: [1, 2], outputText: 'result', stats: { reusedPrefixTokens: 0 },
    runtimeProfile: { model: { modelId: 'fixture', manifestHash: 'sha256:' + hash } } };
  const vectors = [Float32Array.of(1, 2, 3, 4), Float32Array.of(5, 6, 7, 8)];
  const model = { resetGenerationState: vi.fn(), inspect: { generate: vi.fn(async () => inspected) },
    generateWithEvidence: vi.fn(async (prompt, options) => { vectors.forEach(value => options.onLogits(value)); return raw; }) };
  return { inspected, raw, vectors, frames, model,
    request: { model, prompt: 'prompt', promptIds: [3], generation: { maxTokens: 32, temperature: 0, topK: 1, seed: 0 }, timeoutMs: 1000 } };
}

it('captures only complete decode F32 frames and two full logits under fixed exact-token settings', async () => {
  const f = fixture(), result = await runNativeNumericalRequest(f.request);
  expect(f.model.resetGenerationState).toHaveBeenCalledTimes(2);
  const inspected = f.model.inspect.generate.mock.calls[0][1], raw = f.model.generateWithEvidence.mock.calls[0][1];
  expect(inspected.policyId).toBe('demo/activation-grid'); expect(inspected.inputTokenIds).toEqual([3]);
  expect(inspected.generation.maxTokens).toBe(2); expect(raw.maxTokens).toBe(2); expect(raw.inputIds).toEqual([3]);
  expect(result.performanceRepresentative).toBe(false); expect(result.geometry).toEqual({ layers: 2, width: 4, vocabSize: 4 });
  expect(result.layerOutputs.map(frame => frame.layer)).toEqual([0, 1]); expect(JSON.stringify(result)).not.toContain('PREFILL');
  expect(Buffer.from(result.layerOutputs[0].data, 'base64').readFloatLE(0)).toBe(0.5);
  expect(Buffer.from(result.logits[1].data, 'base64').readFloatLE(0)).toBe(5);
  f.frames[0].values[0] = 99; f.vectors[0][0] = 99;
  expect(Buffer.from(result.layerOutputs[0].data, 'base64').readFloatLE(0)).toBe(0.5);
  expect(Buffer.from(result.logits[0].data, 'base64').readFloatLE(0)).toBe(1);
});

it('snapshots IDs and settings before resets and rejects an inspection that changes exact input', async () => {
  const f = fixture(); f.model.resetGenerationState = async () => { f.request.promptIds[0] = 99; f.request.generation.temperature = 1; };
  await runNativeNumericalRequest(f.request);
  expect(f.model.inspect.generate.mock.calls[0][1].generation.temperature).toBe(0);
  expect(f.model.generateWithEvidence.mock.calls[0][1].temperature).toBe(0);
  const bad = fixture(); bad.inspected.inputTokenIds = [4];
  await expect(runNativeNumericalRequest(bad.request)).rejects.toThrow(/input IDs/u);
});

it('rejects partial traces, wrong dtype or precision, missing layers and invalid policy', async () => {
  for (const change of [f => { f.inspected.policy.id = 'demo/always-on'; }, f => { f.inspected.activationTrace.status = 'stopped'; },
    f => { f.inspected.activationTrace.stoppedReason = 'limit'; },
    f => { f.inspected.activationTrace.frames.pop(); }, f => { f.frames[1].layer = 0; },
    f => { f.frames[0].dtype = 'f16'; }, f => { f.frames[0].precision = 'two-f32'; },
    f => { f.frames[0].status = 'dropped'; }, f => { f.frames[0].shape = [2, 2]; },
    f => { f.frames[0].values[0] = Infinity; }, f => { f.frames[0].values[0] = 1e100; },
    f => { f.frames[0].tokenIds = [9]; }]) {
    const f = fixture(); change(f);
    await expect(runNativeNumericalRequest(f.request)).rejects.toThrow();
    expect(f.model.generateWithEvidence).not.toHaveBeenCalled();
  }
});

it('retains an independent text witness across the second generation pass', async () => {
  const f = fixture(), generate = f.model.generateWithEvidence;
  f.model.generateWithEvidence = async (...args) => {
    f.inspected.outputText = 'mutated'; f.raw.outputText = 'mutated';
    return generate(...args);
  };
  await expect(runNativeNumericalRequest(f.request)).rejects.toThrow(/text differs/u);
});

it('rejects missing/nonfinite/wrong-width logits, changed output, prefix reuse and changed model identity', async () => {
  for (const change of [f => { f.vectors.pop(); }, f => { f.vectors.push(Float32Array.of(1, 2, 3, 4)); },
    f => { f.vectors[0][0] = NaN; }, f => { f.vectors[1] = Float32Array.of(1, 2, 3); },
    f => { f.raw.tokenIds = [1, 3]; }, f => { f.raw.outputText = 'changed'; },
    f => { f.raw.stats.reusedPrefixTokens = 1; }, f => { f.raw.runtimeProfile.model.modelId = 'other'; }]) {
    const f = fixture(); change(f); await expect(runNativeNumericalRequest(f.request)).rejects.toThrow();
  }
});

it('honors pre-abort, cancellation before publication and deadlines without starting later passes', async () => {
  const f = fixture(), before = new AbortController(); before.abort(new Error('pre-abort numerical'));
  await expect(runNativeNumericalRequest({ ...f.request, signal: before.signal })).rejects.toThrow('pre-abort numerical');
  expect(f.model.resetGenerationState).not.toHaveBeenCalled();
  const cancelled = fixture(), active = new AbortController();
  cancelled.model.inspect.generate = async () => { active.abort(new Error('cancel numerical')); return cancelled.inspected; };
  await expect(runNativeNumericalRequest({ ...cancelled.request, signal: active.signal })).rejects.toThrow('cancel numerical');
  expect(cancelled.model.generateWithEvidence).not.toHaveBeenCalled();
  const timeout = fixture(); timeout.model.generateWithEvidence = async (prompt, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await expect(runNativeNumericalRequest({ ...timeout.request, timeoutMs: 5 })).rejects.toThrow(/timeout|timed out/iu);
});
