import { GENERATION_CONTRACT } from '../config/doppler-generation-contract.js';

/** Consume Doppler's public scoped stream: ordered text, then exactly one completion.
 * A transport ending is not completion. Cancellation awaits iterator cleanup.
 */
export async function consumeWorkGenerationStream(events, { signal, onDelta, maxOutcomeCharacters }) {
  let text = '', terminal = null;
  for await (const event of events) {
    signal.throwIfAborted();
    if (terminal) throw new Error('Doppler stream emitted an event after completion');
    if (event?.schema !== 'doppler.generation-event/v1'
      || !['text-delta', 'complete'].includes(event.type)) throw new Error('Doppler stream emitted an unsupported event');
    if (event.type === 'text-delta') {
      if (typeof event.text !== 'string') throw new Error('Doppler stream emitted an invalid text delta');
      text += event.text;
      if (text.length > maxOutcomeCharacters) throw new Error('Model response exceeded the configured size limit');
      await onDelta(event.text);
      signal.throwIfAborted();
    } else {
      if (event.outputText !== text) throw new Error('Doppler completed text differs from its stream');
      terminal = { content: text, completion: readWorkGenerationCompletion(event) };
    }
  }
  signal.throwIfAborted();
  if (!terminal) throw new Error('Doppler stream ended without completion');
  return terminal;
}

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
