/**
 * Prefill phase - process entire prompt at once.
 *
 * Returns logits for the last position to sample the first output token.
 */

import type { ParsedModelConfig } from './config.js';
import type { LayerContext } from './layer.js';

/**
 * Prefill options.
 */
export interface PrefillOptions {
  /** Use batched command recording (single GPU submit) */
  useBatched?: boolean;
  /** Debug mode */
  debug?: boolean;
  /** Decode function for debug logging */
  decode?: (tokens: number[]) => string;
}

/**
 * Prefill result.
 */
export interface PrefillResult {
  /** Logits for the last position (for sampling) */
  lastPosLogits: Float32Array;
  /** Total prefill time in milliseconds */
  timeMs: number;
  /** Number of tokens processed */
  numTokens: number;
}

/**
 * Prefill phase - process entire prompt at once.
 *
 * This function processes all input tokens in parallel and returns
 * the logits for the last position, which are used to sample the
 * first generated token.
 *
 * Flow:
 *   1. Embed all input tokens
 *   2. Process through all transformer layers
 *   3. Apply final layer norm and LM head
 *   4. Return logits for last position only
 *
 * The KV cache is populated for all input positions during this phase.
 *
 * @param inputIds - Input token IDs
 * @param context - Layer processing context
 * @param options - Prefill options
 * @returns Prefill result with logits for last position
 */
export async function prefill(
  inputIds: number[],
  context: LayerContext,
  options: PrefillOptions = {}
): Promise<PrefillResult> {
  const startTime = performance.now();
  const numTokens = inputIds.length;
  const { config } = context;
  const { vocabSize } = config;

  // Use batched forward pass if enabled
  const useBatched = options.useBatched ?? false;

  let lastPosLogits: Float32Array;

  if (useBatched) {
    // Batched forward pass - single GPU submission
    // This is not yet fully implemented in the extraction
    lastPosLogits = await prefillBatched(inputIds, context, options);
  } else {
    // Unbatched path (original implementation)
    lastPosLogits = await prefillUnbatched(inputIds, context, options);
  }

  const timeMs = performance.now() - startTime;

  if (options.debug) {
    console.log(`[Prefill] Processed ${numTokens} tokens in ${timeMs.toFixed(1)}ms`);
  }

  return {
    lastPosLogits,
    timeMs,
    numTokens,
  };
}

/**
 * Unbatched prefill implementation.
 * Each kernel operation submits independently to the GPU.
 */
async function prefillUnbatched(
  inputIds: number[],
  context: LayerContext,
  options: PrefillOptions
): Promise<Float32Array> {
  throw new Error('prefillUnbatched not yet implemented - extract from pipeline.js _prefill');
}

/**
 * Batched prefill implementation.
 * All kernel operations are recorded and submitted in a single GPU command.
 */
async function prefillBatched(
  inputIds: number[],
  context: LayerContext,
  options: PrefillOptions
): Promise<Float32Array> {
  throw new Error('prefillBatched not yet implemented - extract from pipeline.js _forwardBatched');
}

/**
 * Extract logits for the last position from full logits array.
 */
export function extractLastPositionLogits(
  logits: Float32Array,
  numTokens: number,
  vocabSize: number
): Float32Array {
  const lastPosLogits = new Float32Array(vocabSize);
  const lastPosOffset = (numTokens - 1) * vocabSize;

  for (let i = 0; i < vocabSize; i++) {
    lastPosLogits[i] = logits[lastPosOffset + i];
  }

  return lastPosLogits;
}
