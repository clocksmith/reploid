// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { runNativeCompleteRequest } from '../fixtures/native-complete-request.js';

function fixture() {
  const settings = { maxTokens: 2, temperature: 0, topK: 1, repetitionPenalty: 1 };
  const model = { resetGenerationState: vi.fn(), inspect: { generate: vi.fn(async (prompt, options) => {
    expect(options.policyId).toBe('demo/always-on');
    expect(options.generation).toMatchObject(settings);
    expect(options.generation).not.toHaveProperty('onLogits');
    for (const tokenId of [5, 6]) options.onEvent({ type: 'token', tokenId });
    return { inputTokenIds: options.inputTokenIds, generatedTokenIds: [5, 6], outputText: 'result',
      policy: { id: 'demo/always-on', modifiesExecution: false }, performanceRepresentative: true, wallTimingMs: 1,
      generationEvidence: { fixture: true } };
  }) } };
  return { model, prompt: 'prompt', promptIds: [1, 2], generation: settings, timeoutMs: 1000 };
}

it('runs the complete exact-input request without logits exports and records all sampled emissions', async () => {
  const f = fixture(), result = await runNativeCompleteRequest(f);
  expect(f.model.resetGenerationState).toHaveBeenCalledOnce();
  expect(result.inputIds).toEqual([1, 2]); expect(result.sampledIds).toEqual([5, 6]);
  expect(result.emissions.map(row => row.token)).toEqual([5, 6]);
  expect(result.requestWallMs).toBeGreaterThanOrEqual(result.generationWallMs);
  expect(result.decodeTailMs).toBeGreaterThanOrEqual(0);
});

it('rejects changed input/sample observations and execution-modifying policies', async () => {
  for (const mutation of [receipt => { receipt.inputTokenIds = [9]; }, receipt => { receipt.generatedTokenIds = [9]; },
    receipt => { receipt.policy.modifiesExecution = true; }]) {
    const f = fixture(), original = f.model.inspect.generate;
    f.model.inspect.generate = async (...args) => { const receipt = await original(...args); mutation(receipt); return receipt; };
    await expect(runNativeCompleteRequest(f)).rejects.toThrow();
  }
});

it('snapshots input/settings and prevents publication after request cancellation', async () => {
  const f = fixture(), abort = new AbortController();
  f.model.resetGenerationState = async () => { f.promptIds[0] = 9; f.generation.maxTokens = 99; };
  f.model.inspect.generate = async (prompt, options) => {
    expect(options.inputTokenIds).toEqual([1, 2]); expect(options.generation.maxTokens).toBe(2);
    abort.abort(new Error('cancel request')); options.generation.signal.throwIfAborted();
  };
  await expect(runNativeCompleteRequest({ ...f, signal: abort.signal })).rejects.toThrow('cancel request');
});

it('applies a request deadline and permits subsequent independent recovery', async () => {
  const f = fixture();
  f.model.inspect.generate = async (prompt, options) => new Promise((resolve, reject) => {
    options.generation.signal.addEventListener('abort', () => reject(options.generation.signal.reason), { once: true });
  });
  await expect(runNativeCompleteRequest({ ...f, timeoutMs: 5 })).rejects.toThrow(/timed out|timeout/iu);
  const recovered = await runNativeCompleteRequest(fixture());
  expect(recovered.sampledIds).toEqual([5, 6]);
});
