/**
 * Debug utilities for pipeline tracing.
 *
 * Centralizes debug logging to avoid cluttering main code.
 * Enable via DEBUG_PIPELINE=true or context.debug=true.
 *
 * @module inference/pipeline/debug-utils
 */

import { readBuffer } from '../../gpu/buffer-pool.js';

/** Debug configuration */
export interface DebugConfig {
  enabled: boolean;
  logLayers?: number[];  // Only log these layers (empty = all)
  logStages?: ('attn' | 'ffn' | 'embed' | 'logits')[];
  maxAbsThreshold?: number;  // Warn if maxAbs exceeds this
}

/** Default debug config */
const defaultConfig: DebugConfig = {
  enabled: false,
  logLayers: [0],  // Only log layer 0 by default
  logStages: ['attn', 'ffn'],
  maxAbsThreshold: 1000,
};

let globalConfig: DebugConfig = { ...defaultConfig };

/**
 * Set global debug configuration.
 */
export function setDebugConfig(config: Partial<DebugConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Check if debug is enabled for a layer/stage.
 */
export function shouldLog(layerIdx: number, stage: string): boolean {
  if (!globalConfig.enabled) return false;
  if (globalConfig.logLayers?.length && !globalConfig.logLayers.includes(layerIdx)) return false;
  if (globalConfig.logStages?.length && !globalConfig.logStages.includes(stage as any)) return false;
  return true;
}

/**
 * Log buffer statistics (one-liner in calling code).
 */
export async function logBufferStats(
  buffer: GPUBuffer,
  label: string,
  layerIdx: number,
  stage: string = 'attn'
): Promise<void> {
  if (!shouldLog(layerIdx, stage)) return;

  try {
    const data = await readBuffer(buffer);
    const arr = new Float32Array(data);
    const maxAbs = Math.max(...arr.map(Math.abs));
    const min = Math.min(...arr);
    const max = Math.max(...arr);

    console.log(`[DEBUG L${layerIdx}] ${label}: maxAbs=${maxAbs.toFixed(2)}, range=[${min.toFixed(2)}, ${max.toFixed(2)}]`);

    // Warn on explosion
    if (globalConfig.maxAbsThreshold && maxAbs > globalConfig.maxAbsThreshold) {
      console.warn(`[DEBUG L${layerIdx}] WARNING: ${label} maxAbs=${maxAbs.toFixed(2)} exceeds threshold ${globalConfig.maxAbsThreshold}`);
    }
  } catch (e) {
    console.warn(`[DEBUG L${layerIdx}] Failed to read buffer for ${label}:`, (e as Error).message);
  }
}

/**
 * Log attention parameters (one-liner).
 */
export function logAttention(
  layerIdx: number,
  isPrefill: boolean,
  numTokens: number,
  seqLen: number,
  kvLen?: number,
  startPos?: number
): void {
  if (!shouldLog(layerIdx, 'attn')) return;

  const mode = isPrefill ? 'prefill' : 'decode';
  let msg = `[ATT L${layerIdx}] ${mode}: numTokens=${numTokens}, seqLen=${seqLen}`;
  if (kvLen !== undefined) msg += `, kvLen=${kvLen}`;
  if (startPos !== undefined) msg += `, startPos=${startPos}`;
  console.log(msg);
}

/**
 * Log layer entry (one-liner).
 */
export function logLayerEntry(
  layerIdx: number,
  isPrefill: boolean,
  numTokens: number,
  size: number
): void {
  if (!shouldLog(layerIdx, 'attn')) return;
  console.log(`[LAYER L${layerIdx}] ${isPrefill ? 'prefill' : 'decode'}: numTokens=${numTokens}, size=${size}`);
}

/**
 * Log FFN output (one-liner).
 */
export async function logFFNOutput(
  buffer: GPUBuffer,
  layerIdx: number,
  numTokens: number
): Promise<void> {
  if (!shouldLog(layerIdx, 'ffn')) return;
  await logBufferStats(buffer, `FFN output (n=${numTokens})`, layerIdx, 'ffn');
}

/**
 * Log embedding output (one-liner).
 */
export async function logEmbedOutput(
  buffer: GPUBuffer,
  tokenId: number,
  numTokens: number
): Promise<void> {
  if (!globalConfig.enabled) return;

  try {
    const data = await readBuffer(buffer);
    const arr = new Float32Array(data);
    const maxAbs = Math.max(...arr.map(Math.abs));
    const nonZero = arr.filter(v => v !== 0).length;
    const sample = arr.slice(0, 5);

    console.log(`[EMBED] token=${tokenId} (n=${numTokens}): maxAbs=${maxAbs.toFixed(2)}, nonZero=${nonZero}/${arr.length}, sample=[${Array.from(sample).map(v => v.toFixed(3)).join(', ')}]`);
  } catch (e) {
    console.warn(`[EMBED] Failed to read buffer:`, (e as Error).message);
  }
}

/**
 * Log logits summary (one-liner).
 */
export function logLogits(
  label: string,
  min: number,
  max: number,
  topTokens: Array<{ token: number | string; prob: number }>
): void {
  if (!globalConfig.enabled) return;

  const topStr = topTokens
    .slice(0, 5)
    .map(t => `"${t.token}"(${(t.prob * 100).toFixed(1)}%)`)
    .join(', ');

  console.log(`[${label}] min=${min.toFixed(2)}, max=${max.toFixed(2)} | top-5: ${topStr}`);
}
