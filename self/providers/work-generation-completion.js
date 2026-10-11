import { GENERATION_CONTRACT } from '../config/doppler-generation-contract.js';

/** Preserve Doppler's declared termination; missing legacy metadata stays unknown. */
export function readWorkGenerationCompletion(result) {
  const value = Object.hasOwn(result, 'completion') ? result.completion : result.evidence?.output?.completion;
  if (value == null) return null;
  if (value.schema !== GENERATION_CONTRACT.completionSchema
    || !GENERATION_CONTRACT.stoppingReasons.includes(value.stopReason)
    || !Number.isSafeInteger(value.promptTokenCount) || value.promptTokenCount < 0
    || !Number.isSafeInteger(value.generatedTokenCount) || value.generatedTokenCount < 0) {
    throw new Error('Doppler supplied invalid generation completion metadata');
  }
  return { schema: value.schema, stopReason: value.stopReason,
    promptTokenCount: value.promptTokenCount, generatedTokenCount: value.generatedTokenCount };
}
