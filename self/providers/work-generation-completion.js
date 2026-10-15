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

/** Copy measurements while the generation still owns the session, before reset. */
export function readWorkGenerationTiming(stats) {
  if (!stats || !Number.isFinite(stats.totalTimeMs) || stats.totalTimeMs <= 0
    || !Number.isSafeInteger(stats.tokensGenerated) || stats.tokensGenerated < 0) return null;
  const duration = value => Number.isFinite(value) && value >= 0 ? value : null;
  return { totalMs: stats.totalTimeMs, generatedTokenCount: stats.tokensGenerated,
    prefillMs: duration(stats.prefillTimeMs), decodeMs: duration(stats.decodeTimeMs),
    firstTokenMs: duration(stats.ttftMs) };
}
