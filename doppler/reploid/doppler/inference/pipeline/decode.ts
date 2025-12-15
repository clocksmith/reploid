/**
 * Single-token decode step for autoregressive generation.
 *
 * Processes one token at a time using the KV cache from previous steps.
 */

import type { LayerContext } from './layer.js';
import type { SamplingOptions } from './sampling.js';

/**
 * Decode step options.
 */
export interface DecodeOptions extends SamplingOptions {
  /** Use batched command recording (single GPU submit) */
  useBatched?: boolean;
  /** Repetition penalty */
  repetitionPenalty: number;
  /** Decode function for debug logging */
  decode?: (tokens: number[]) => string;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Decode step result.
 */
export interface DecodeResult {
  /** Next token ID */
  nextToken: number;
  /** Logits for this position */
  logits: Float32Array;
  /** Decode time in milliseconds */
  timeMs: number;
}

/**
 * Single decode step - generate one token.
 *
 * This function processes only the last token (using cached KV for previous tokens)
 * and returns the next token to generate.
 *
 * Flow:
 *   1. Embed the last token
 *   2. Process through all transformer layers (using KV cache)
 *   3. Apply final layer norm and LM head
 *   4. Apply repetition penalty
 *   5. Sample next token
 *
 * The KV cache is updated with the new token's K/V values.
 *
 * @param currentIds - All token IDs generated so far (including prompt)
 * @param context - Layer processing context
 * @param options - Decode options
 * @returns Decode result with next token
 */
export async function decodeStep(
  currentIds: number[],
  context: LayerContext,
  options: DecodeOptions
): Promise<DecodeResult> {
  const startTime = performance.now();
  const lastToken = currentIds[currentIds.length - 1];
  const numTokens = 1;

  // Track decode steps for debugging
  const decodeStepCount = ((context as any)._decodeStepCount || 0) + 1;
  (context as any)._decodeStepCount = decodeStepCount;

  const isDebugStep = decodeStepCount <= 5;
  if (isDebugStep && options.decode) {
    const tokenText = options.decode([lastToken]);
    console.log(
      `[Pipeline] Decode[${decodeStepCount}] token="${tokenText}" pos=${context.currentSeqLen} kvLen=${
        context.currentSeqLen + 1
      }`
    );
  }

  // Use batched forward pass if enabled
  const useBatched = options.useBatched ?? false;

  let logits: Float32Array;

  if (useBatched) {
    // Batched forward pass - single GPU submission for decode step
    logits = await decodeStepBatched(lastToken, context, options);
  } else {
    // Unbatched path (original implementation)
    logits = await decodeStepUnbatched(lastToken, context, options);
  }

  const timeMs = performance.now() - startTime;

  if (options.debug || isDebugStep) {
    console.log(`[Decode] Step ${decodeStepCount} in ${timeMs.toFixed(2)}ms`);
  }

  // Import sampling functions
  const { applyRepetitionPenalty, sample, logitsSanity } = await import('./sampling.js');

  // Log top-5 predictions for first 5 decode steps
  if (isDebugStep && options.decode) {
    logitsSanity(logits, `Decode[${decodeStepCount}]`, options.decode);
  }

  // Apply repetition penalty
  applyRepetitionPenalty(logits, currentIds, options.repetitionPenalty);

  // Sample next token
  const nextToken = sample(logits, options);

  // Update sequence length
  context.currentSeqLen++;

  return {
    nextToken,
    logits,
    timeMs,
  };
}

/**
 * Unbatched decode step implementation.
 * Each kernel operation submits independently to the GPU.
 */
async function decodeStepUnbatched(
  lastToken: number,
  context: LayerContext,
  options: DecodeOptions
): Promise<Float32Array> {
  throw new Error('decodeStepUnbatched not yet implemented - extract from pipeline.js _decodeStep');
}

/**
 * Batched decode step implementation.
 * All kernel operations are recorded and submitted in a single GPU command.
 */
async function decodeStepBatched(
  lastToken: number,
  context: LayerContext,
  options: DecodeOptions
): Promise<Float32Array> {
  throw new Error('decodeStepBatched not yet implemented - extract from pipeline.js _forwardBatched');
}
