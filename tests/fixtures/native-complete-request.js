// Ordinary pretokenized generation, without diagnostic per-token logits exports.
import assert from 'node:assert/strict';
import { timeCompleteRequest } from './complete-request-timing.js';

export async function runNativeCompleteRequest({ model, prompt, promptIds, generation, timeoutMs, signal, clock, onToken }) {
  assert(typeof prompt === 'string' && prompt.length > 0 && Array.isArray(promptIds) && promptIds.length > 0
    && promptIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Complete request requires text and exact prompt IDs');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(generation.maxTokens)
    && generation.maxTokens > 0, 'Complete request requires finite request and token limits');
  assert(onToken === undefined || typeof onToken === 'function', 'Token observer must be a function');
  const ids = [...promptIds], settings = structuredClone(generation);
  const measured = await timeCompleteRequest({
    reset: () => model.resetGenerationState(), timeoutMs, signal, clock,
    generate: (observe, active) => model.inspect.generate(prompt, {
      policyId: 'demo/always-on', inputTokenIds: ids, generation: { ...settings, signal: active },
      onEvent(event) {
        if (event.type === 'token') {
          observe(event.tokenId);
          onToken?.(event.tokenId);
        }
      },
    }),
    decode: receipt => receipt.outputText,
  });
  const receipt = measured.result, emissions = measured.timing.emissions;
  assert.deepEqual(receipt.inputTokenIds, ids, 'Actual prefilled IDs differ from the frozen request');
  assert(receipt.policy.id === 'demo/always-on' && receipt.policy.modifiesExecution === false
    && receipt.performanceRepresentative === true, 'Complete-request policy must preserve ordinary execution');
  assert(receipt.generatedTokenIds.length > 0 && receipt.generatedTokenIds.length <= settings.maxTokens
    && receipt.generatedTokenIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Invalid sampled IDs');
  assert.deepEqual(emissions.map(row => row.token), receipt.generatedTokenIds, 'Token observations differ from sampled output');
  return { inputIds: [...receipt.inputTokenIds], sampledIds: [...receipt.generatedTokenIds], text: measured.text,
    ...measured.timing,
    pipelineWallMs: receipt.wallTimingMs, generationEvidence: receipt.generationEvidence,
    scope: 'Reset through public generation and decoded output, including engine-provided evidence; post-request validation/telemetry excluded; no raw logits capture' };
}
