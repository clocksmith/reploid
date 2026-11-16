// Ordinary pretokenized generation, without diagnostic per-token logits exports.
import assert from 'node:assert/strict';

export async function runNativeCompleteRequest({ model, prompt, promptIds, generation, timeoutMs, signal }) {
  assert(typeof prompt === 'string' && prompt.length > 0 && Array.isArray(promptIds) && promptIds.length > 0
    && promptIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Complete request requires text and exact prompt IDs');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(generation.maxTokens)
    && generation.maxTokens > 0, 'Complete request requires finite request and token limits');
  const ids = [...promptIds], settings = structuredClone(generation);
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  active.throwIfAborted();
  const started = performance.now();
  await model.resetGenerationState();
  active.throwIfAborted();
  const resetMs = performance.now() - started, emissions = [];
  const generating = performance.now();
  const receipt = await model.inspect.generate(prompt, {
    policyId: 'demo/always-on', inputTokenIds: ids, generation: { ...settings, signal: active },
    onEvent(event) {
      if (event.type === 'token') emissions.push({ token: event.tokenId, ms: performance.now() - generating });
    },
  });
  active.throwIfAborted();
  assert.deepEqual(receipt.inputTokenIds, ids, 'Actual prefilled IDs differ from the frozen request');
  assert(receipt.policy.id === 'demo/always-on' && receipt.policy.modifiesExecution === false
    && receipt.performanceRepresentative === true, 'Complete-request policy must preserve ordinary execution');
  assert(receipt.generatedTokenIds.length > 0 && receipt.generatedTokenIds.length <= settings.maxTokens
    && receipt.generatedTokenIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Invalid sampled IDs');
  assert.deepEqual(emissions.map(row => row.token), receipt.generatedTokenIds, 'Token observations differ from sampled output');
  const generationWallMs = performance.now() - generating;
  return { inputIds: [...receipt.inputTokenIds], sampledIds: [...receipt.generatedTokenIds], text: receipt.outputText,
    requestWallMs: performance.now() - started, generationWallMs, resetMs,
    ttftMs: emissions[0].ms, decodeTailMs: emissions.at(-1).ms - emissions[0].ms, emissions,
    pipelineWallMs: receipt.wallTimingMs, generationEvidence: receipt.generationEvidence,
    scope: 'Complete pretokenized public inspection/generation request; reset reported separately; no raw logits capture' };
}
