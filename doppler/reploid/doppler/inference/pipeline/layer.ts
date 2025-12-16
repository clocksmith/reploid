/**
 * Transformer layer processing (attention + FFN).
 *
 * This module orchestrates single-layer computation:
 * - Input normalization
 * - Self-attention
 * - Residual connections
 * - Feed-forward network (dense or MoE)
 *
 * Supports both standard (LLaMA-style) and sandwich norm (Gemma 3) architectures.
 *
 * @module inference/pipeline/layer
 */

console.log('[LAYER_MODULE] layer.ts module loaded');

import type { ParsedModelConfig } from './config.js';
import type { LayerWeights, MaybeGPUBuffer } from './types.js';
import { getDevice } from '../../gpu/device.js';
import { acquireBuffer, releaseBuffer } from '../../gpu/buffer-pool.js';
import {
  runRMSNorm, runResidualAdd, runMatmul, runSiLU, runGeLU,
  recordRMSNorm, recordResidualAdd, recordMatmul, recordSiLU, recordGeLU,
  CommandRecorder,
} from '../../gpu/kernel-selector.js';
import { runLayerAttentionGPU, recordLayerAttentionGPU, type AttentionConfig, type AttentionState } from './attention.js';
import { getWeightBuffer, getNormWeightBuffer, type WeightBufferConfig, type WeightDebugFlags } from './weights.js';
import { logLayerEntry, logBufferStats, logFFNOutput, shouldLog } from './debug-utils.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Layer context contains all state needed for layer processing.
 */
export interface LayerContext {
  /** Model configuration */
  config: ParsedModelConfig;
  /** Layer weights map */
  weights: Map<string, LayerWeights | Float32Array | GPUBuffer>;
  /** KV cache instance */
  kvCache: any;
  /** Current sequence length */
  currentSeqLen: number;
  /** Whether to use GPU */
  useGPU: boolean;
  /** Debug mode */
  debug: boolean;
  /** RoPE frequency buffers */
  ropeFreqsCos: GPUBuffer | Float32Array | null;
  ropeFreqsSin: GPUBuffer | Float32Array | null;
  /** Attention kernel override */
  attentionKernelOverride: string | null;
  /** Weight buffer config */
  weightConfig: WeightBufferConfig;
  /** Debug flags (mutable) */
  debugFlags?: WeightDebugFlags;
  /** Expert weights map (for MoE) */
  expertWeights?: Map<string, any>;
  /** Expert loader (for MoE) */
  expertLoader?: any;
  /** MoE router (for MoE) */
  moeRouter?: any;
  /** Layer router weights (for models with per-layer routers) */
  layerRouterWeights?: Map<number, any>;
  /** Command recorder for batched GPU operations (optional) */
  recorder?: CommandRecorder;
}

/**
 * Layer processing result.
 */
export interface LayerResult {
  /** Output hidden states (GPUBuffer or Float32Array) */
  output: GPUBuffer | Float32Array;
  /** Whether output is on GPU */
  isGPU: boolean;
}

/**
 * Sandwich norm detection result.
 */
export interface SandwichNormInfo {
  /** Whether sandwich norms are used */
  useSandwichNorm: boolean;
  /** Has pre-feedforward norm */
  hasPreFeedforwardNorm: boolean;
  /** Has post-feedforward norm */
  hasPostFeedforwardNorm: boolean;
  /** Has post-attention norm */
  hasPostAttentionNorm: boolean;
}

// ============================================================================
// Kernel Wrappers (run or record based on context)
// ============================================================================

/**
 * RMSNorm that uses record variant when recorder is provided.
 */
async function doRMSNorm(
  input: GPUBuffer,
  weight: GPUBuffer,
  eps: number,
  options: { batchSize: number; hiddenSize: number },
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordRMSNorm(recorder, input, weight, eps, options);
  }
  return runRMSNorm(input, weight, eps, options);
}

/**
 * ResidualAdd that uses record variant when recorder is provided.
 */
async function doResidualAdd(
  a: GPUBuffer,
  b: GPUBuffer,
  size: number,
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordResidualAdd(recorder, a, b, size);
  }
  return runResidualAdd(a, b, size);
}

/**
 * Matmul that uses record variant when recorder is provided.
 */
async function doMatmul(
  A: GPUBuffer,
  B: GPUBuffer,
  M: number,
  N: number,
  K: number,
  options: { transposeB?: boolean } = {},
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordMatmul(recorder, A, B, M, N, K, options);
  }
  return runMatmul(A, B, M, N, K, options);
}

/**
 * SiLU that uses record variant when recorder is provided.
 * Supports gated variant (SiLU with gate multiplication).
 */
async function doSiLU(
  input: GPUBuffer,
  options: { size?: number; gate?: GPUBuffer } = {},
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordSiLU(recorder, input, options);
  }
  return runSiLU(input, options);
}

/**
 * GeLU that uses record variant when recorder is provided.
 * Supports gated variant (GeGLU).
 */
async function doGeLU(
  input: GPUBuffer,
  options: { size?: number; gate?: GPUBuffer } = {},
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordGeLU(recorder, input, options);
  }
  return runGeLU(input, options);
}

/**
 * Attention that uses record variant when recorder is provided.
 */
async function doAttention(
  inputBuffer: GPUBuffer,
  layerWeights: LayerWeights | null,
  config: AttentionConfig,
  state: AttentionState,
  debug: boolean,
  debugFlags: {},
  getWeightBufferFn: (weight: any, label: string) => GPUBuffer,
  getNormWeightBufferFn: (weight: any, label: string) => GPUBuffer,
  recorder?: CommandRecorder
): Promise<GPUBuffer> {
  if (recorder) {
    return recordLayerAttentionGPU(
      recorder,
      inputBuffer,
      layerWeights,
      config,
      state,
      debug,
      debugFlags,
      getWeightBufferFn,
      getNormWeightBufferFn
    );
  }
  return runLayerAttentionGPU(
    inputBuffer,
    layerWeights,
    config,
    state,
    debug,
    debugFlags,
    getWeightBufferFn,
    getNormWeightBufferFn
  );
}

// ============================================================================
// Architecture Detection
// ============================================================================

/**
 * Detect sandwich norm architecture (Gemma 3).
 */
export function detectSandwichNorm(layerWeights: any): SandwichNormInfo {
  const hasPreFeedforwardNorm = Boolean(layerWeights?.preFeedforwardNorm);
  const hasPostFeedforwardNorm = Boolean(layerWeights?.postFeedforwardNorm);
  const hasPostAttentionNorm = Boolean(layerWeights?.postAttentionNorm);

  return {
    useSandwichNorm: hasPreFeedforwardNorm || hasPostFeedforwardNorm,
    hasPreFeedforwardNorm,
    hasPostFeedforwardNorm,
    hasPostAttentionNorm,
  };
}

/**
 * Check if a layer is a MoE layer.
 */
export function isMoELayer(
  layerIdx: number,
  config: ParsedModelConfig,
  layerWeights?: any
): boolean {
  if (!config.useMoE) return false;

  // Check if layer has router weights
  if (layerWeights?.routerWeight) return true;

  // Fall back to layer_types array if available
  const layerTypes = (config as any).layerTypes;
  if (Array.isArray(layerTypes) && layerIdx < layerTypes.length) {
    return layerTypes[layerIdx] === 'moe';
  }

  // Default: assume all layers are MoE if model uses MoE
  return true;
}

// ============================================================================
// Main Layer Processing
// ============================================================================

/**
 * Process a single transformer layer.
 *
 * This is the main orchestration function that delegates to:
 * - processLayerGPU() for GPU execution
 * - processLayerCPU() for CPU fallback
 *
 * The layer processing follows either:
 *
 * Standard (LLaMA-style) architecture:
 *   1. x_norm = input_layernorm(x)
 *   2. attn_out = attention(x_norm)
 *   3. x = x + attn_out  // residual
 *   4. x_norm = post_attn_norm(x)
 *   5. ffn_out = ffn(x_norm)
 *   6. x = x + ffn_out  // residual
 *
 * Sandwich norm (Gemma 3) architecture:
 *   1. x_norm = input_layernorm(x)
 *   2. attn_out = attention(x_norm)
 *   3. attn_out = post_attention_layernorm(attn_out)  // BEFORE residual
 *   4. x = x + attn_out  // residual AFTER norm
 *   5. ffn_in = pre_feedforward_layernorm(x)
 *   6. ffn_out = mlp(ffn_in)
 *   7. ffn_out = post_feedforward_layernorm(ffn_out)  // BEFORE residual
 *   8. x = x + ffn_out  // residual AFTER norm
 *
 * @param layerIdx - Layer index
 * @param hiddenStates - Input hidden states (GPUBuffer or Float32Array)
 * @param numTokens - Number of tokens in the batch
 * @param isPrefill - Whether this is prefill (true) or decode (false)
 * @param context - Layer processing context
 * @returns Layer output
 */
export async function processLayer(
  layerIdx: number,
  hiddenStates: GPUBuffer | Float32Array,
  numTokens: number,
  isPrefill: boolean,
  context: LayerContext
): Promise<GPUBuffer | Float32Array> {
  if (layerIdx === 0) {
    throw new Error('[LAYER_TS] TEST ERROR - processLayer was called from layer.ts');
  }
  console.log(`[LAYER_TS] processLayer called, layerIdx=${layerIdx}`);
  const { config, useGPU } = context;
  const { hiddenSize } = config;
  const size = numTokens * hiddenSize;

  // Debug routing (uses debug-utils)
  if (shouldLog(layerIdx, 'attn')) {
    logLayerEntry(layerIdx, isPrefill, numTokens, size);
  }

  // Debug: check path being taken for layer 0
  if (layerIdx === 0) {
    console.log(`[processLayer] L0 routing: useGPU=${useGPU}, isGPUBuffer=${hiddenStates instanceof GPUBuffer}, constructor=${hiddenStates?.constructor?.name}`);
  }

  // GPU-native path
  if (useGPU && hiddenStates instanceof GPUBuffer) {
    return processLayerGPU(layerIdx, hiddenStates, numTokens, isPrefill, size, context);
  }

  // CPU fallback path
  return processLayerCPU(layerIdx, hiddenStates as Float32Array, numTokens, isPrefill, context);
}

// ============================================================================
// GPU Layer Processing
// ============================================================================

/**
 * GPU-native layer processing (no CPU readbacks).
 */
export async function processLayerGPU(
  layerIdx: number,
  inputBuffer: GPUBuffer,
  numTokens: number,
  isPrefill: boolean,
  size: number,
  context: LayerContext
): Promise<GPUBuffer> {
  // Debug entry (uses debug-utils)
  if (shouldLog(layerIdx, 'attn')) {
    logLayerEntry(layerIdx, isPrefill, numTokens, size);
  }

  const device = getDevice();
  if (!device) throw new Error('No GPU device available');

  const { config, weights, weightConfig, debugFlags, kvCache, ropeFreqsCos, ropeFreqsSin, attentionKernelOverride, recorder } = context;
  const { hiddenSize, numHeads, numKVHeads, headDim, rmsNormEps } = config;

  const layerWeights = weights.get(`layer_${layerIdx}`) as LayerWeights | undefined;
  const sandwichNorm = detectSandwichNorm(layerWeights);

  // 1. Self-attention (returns GPU buffer)
  const attnConfig: AttentionConfig = {
    layerIdx,
    numTokens,
    isPrefill,
    numHeads,
    numKVHeads,
    headDim,
    hiddenSize,
    rmsNormEps,
    currentSeqLen: context.currentSeqLen,
    slidingWindow: config.slidingWindow,
    layerType: (config as any).layerTypes?.[layerIdx],
    attentionKernelOverride,
  };

  const attnState: AttentionState = {
    ropeFreqsCos: ropeFreqsCos as GPUBuffer | null,
    ropeFreqsSin: ropeFreqsSin as GPUBuffer | null,
    kvCache,
  };

  const attnOutput = await doAttention(
    inputBuffer,
    layerWeights ?? null,
    attnConfig,
    attnState,
    context.debug,
    {},
    (weight, label) => getWeightBuffer(weight, label),
    (weight, label) => getNormWeightBuffer(weight, label, weightConfig, debugFlags),
    recorder
  );

  // Debug: trace attn output (uses debug-utils)
  await logBufferStats(attnOutput, `attn (${isPrefill ? 'prefill' : 'decode'})`, layerIdx, 'attn');

  // Debug layer 0 attention output specifically
  console.log(`[Layer${layerIdx}] attnOutput type check: isGPU=${attnOutput instanceof GPUBuffer}, type=${typeof attnOutput}, constructor=${attnOutput?.constructor?.name}`);
  if (layerIdx === 0 && attnOutput instanceof GPUBuffer) {
    try {
      const sampleSize = Math.min(128, attnOutput.size);
      const staging = device.createBuffer({ size: sampleSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(attnOutput, 0, staging, 0, sampleSize);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      const maxAbs = Math.max(...Array.from(data).map(x => Math.abs(x)));
      const nonZero = Array.from(data).filter(x => x !== 0).length;
      console.log(`[Layer0] ATTN_OUT: maxAbs=${maxAbs.toFixed(4)}, nonZero=${nonZero}/${data.length}, sample=[${Array.from(data).slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);
    } catch (e) {
      console.log(`[Layer0] ATTN_OUT error: ${e}`);
    }
  }

  // 2. Handle residual connection based on architecture
  // Debug: log architecture path for layer 0
  if (layerIdx === 0) {
    console.log(`[Layer0] ARCH: sandwich=${sandwichNorm.useSandwichNorm}, hasPostAttnNorm=${sandwichNorm.hasPostAttentionNorm}, hasWeights=${!!layerWeights?.postAttentionNorm}`);
  }

  let postAttn: GPUBuffer;
  if (sandwichNorm.useSandwichNorm && sandwichNorm.hasPostAttentionNorm && layerWeights?.postAttentionNorm) {
    // Gemma 3 path: norm attention output BEFORE residual add
    const normWeightBuf = getNormWeightBuffer(layerWeights.postAttentionNorm, 'post_attention_norm', weightConfig, debugFlags);
    const attnOutputNormed = await doRMSNorm(attnOutput, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    }, recorder);
    if (!(layerWeights.postAttentionNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
    releaseBuffer(attnOutput);

    // Now add the normed attention output to the residual stream
    postAttn = await doResidualAdd(attnOutputNormed, inputBuffer, size, recorder);
    releaseBuffer(attnOutputNormed);
  } else {
    // Standard path: residual add first
    postAttn = await doResidualAdd(attnOutput, inputBuffer, size, recorder);
    releaseBuffer(attnOutput);
  }

  // Debug: log postAttn for layer 0
  if (layerIdx === 0 && postAttn instanceof GPUBuffer) {
    try {
      const sampleSize = Math.min(128, postAttn.size);
      const staging = device.createBuffer({ size: sampleSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(postAttn, 0, staging, 0, sampleSize);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      const maxAbs = Math.max(...Array.from(data).map(x => Math.abs(x)));
      console.log(`[Layer0] POST_ATTN: maxAbs=${maxAbs.toFixed(4)}, sample=[${Array.from(data).slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);
    } catch (e) {
      console.log(`[Layer0] POST_ATTN error: ${e}`);
    }
  }

  // 3. Feed-forward network
  if (sandwichNorm.useSandwichNorm) {
    return processFFNWithSandwichNorm(layerIdx, postAttn, numTokens, size, context, layerWeights, sandwichNorm);
  } else {
    return processFFNStandard(layerIdx, postAttn, numTokens, size, context, layerWeights);
  }
}

/**
 * Process FFN with sandwich norm architecture (Gemma 3).
 */
async function processFFNWithSandwichNorm(
  layerIdx: number,
  postAttn: GPUBuffer,
  numTokens: number,
  size: number,
  context: LayerContext,
  layerWeights: LayerWeights | undefined,
  sandwichNorm: SandwichNormInfo
): Promise<GPUBuffer> {
  const { config, weightConfig, debugFlags, recorder } = context;
  const { hiddenSize, rmsNormEps } = config;

  // 1. Pre-FFN norm (applied to residual stream before FFN)
  let ffnInput = postAttn;
  if (sandwichNorm.hasPreFeedforwardNorm && layerWeights?.preFeedforwardNorm) {
    const normWeightBuf = getNormWeightBuffer(layerWeights.preFeedforwardNorm, 'pre_feedforward_norm', weightConfig, debugFlags);
    ffnInput = await doRMSNorm(postAttn, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    }, recorder);
    if (!(layerWeights.preFeedforwardNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
  }

  // 2. FFN (or MoE FFN)
  let ffnOutput: GPUBuffer;
  if (config.useMoE && isMoELayer(layerIdx, config, layerWeights)) {
    ffnOutput = await runMoEFFNGPU(layerIdx, ffnInput, numTokens, context);
  } else {
    ffnOutput = await runDenseFFNGPU(layerIdx, ffnInput, numTokens, context, layerWeights);
  }

  if (ffnInput !== postAttn) releaseBuffer(ffnInput);

  // Debug: trace FFN output (uses debug-utils)
  await logFFNOutput(ffnOutput, layerIdx, numTokens);

  // 3. Post-FFN norm - applied to FFN output BEFORE residual add
  let ffnOutputNormed = ffnOutput;
  if (sandwichNorm.hasPostFeedforwardNorm && layerWeights?.postFeedforwardNorm) {
    const normWeightBuf = getNormWeightBuffer(layerWeights.postFeedforwardNorm, 'post_feedforward_norm', weightConfig, debugFlags);
    ffnOutputNormed = await doRMSNorm(ffnOutput, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    }, recorder);
    if (!(layerWeights.postFeedforwardNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
    releaseBuffer(ffnOutput);
  }

  // 4. Residual add: postAttn + ffnOutputNormed
  const output = await doResidualAdd(ffnOutputNormed, postAttn, size, recorder);
  if (ffnOutputNormed !== ffnOutput) releaseBuffer(ffnOutputNormed);
  releaseBuffer(postAttn);

  return output;
}

/**
 * Process FFN with standard architecture (LLaMA-style).
 */
async function processFFNStandard(
  layerIdx: number,
  postAttn: GPUBuffer,
  numTokens: number,
  size: number,
  context: LayerContext,
  layerWeights: LayerWeights | undefined
): Promise<GPUBuffer> {
  const { config, weightConfig, debugFlags, recorder } = context;
  const { hiddenSize, rmsNormEps } = config;

  // 1. Post-attention norm (LLaMA-style pre-FFN norm)
  let normedBuffer = postAttn;
  if (layerWeights?.postAttnNorm) {
    const normWeightBuf = getNormWeightBuffer(layerWeights.postAttnNorm, 'post_attn_norm', weightConfig, debugFlags);
    normedBuffer = await doRMSNorm(postAttn, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    }, recorder);
    if (!(layerWeights.postAttnNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
  }

  // 2. FFN (or MoE FFN)
  let ffnOutput: GPUBuffer;
  if (config.useMoE && isMoELayer(layerIdx, config, layerWeights)) {
    ffnOutput = await runMoEFFNGPU(layerIdx, normedBuffer, numTokens, context);
  } else {
    ffnOutput = await runDenseFFNGPU(layerIdx, normedBuffer, numTokens, context, layerWeights);
  }

  // 3. Residual add: ffnOutput + postAttn
  const output = await doResidualAdd(ffnOutput, postAttn, size, recorder);

  // Cleanup intermediate buffers
  if (normedBuffer !== postAttn) releaseBuffer(normedBuffer);
  releaseBuffer(postAttn);
  releaseBuffer(ffnOutput);

  return output;
}

// ============================================================================
// FFN Operations
// ============================================================================

/**
 * Run dense FFN on GPU.
 */
async function runDenseFFNGPU(
  layerIdx: number,
  inputBuffer: GPUBuffer,
  numTokens: number,
  context: LayerContext,
  layerWeights: LayerWeights | undefined
): Promise<GPUBuffer> {
  const device = getDevice();
  if (!device) throw new Error('No GPU device');

  const { config, recorder } = context;
  const { hiddenSize, intermediateSize, hiddenActivation } = config;

  if (!layerWeights?.gate || !layerWeights?.up || !layerWeights?.down) {
    // Return copy of input (no FFN weights)
    const output = acquireBuffer(numTokens * hiddenSize * 4, undefined, 'ffn_output');
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(inputBuffer, 0, output, 0, numTokens * hiddenSize * 4);
    device.queue.submit([encoder.finish()]);
    return output;
  }

  // 1. Gate projection
  const gateWeight = getWeightBuffer(layerWeights.gate, 'ffn_gate');
  const gateOutput = await doMatmul(inputBuffer, gateWeight, numTokens, intermediateSize, hiddenSize, { transposeB: true }, recorder);
  if (!(layerWeights.gate instanceof GPUBuffer)) releaseBuffer(gateWeight);

  // 2. Up projection
  const upWeight = getWeightBuffer(layerWeights.up, 'ffn_up');
  const upOutput = await doMatmul(inputBuffer, upWeight, numTokens, intermediateSize, hiddenSize, { transposeB: true }, recorder);
  if (!(layerWeights.up instanceof GPUBuffer)) releaseBuffer(upWeight);

  // 3. Activation: activation(gate) * up
  const activationFn = hiddenActivation === 'gelu' ? doGeLU : doSiLU;
  const activatedOutput = await activationFn(upOutput, {
    size: numTokens * intermediateSize,
    gate: gateOutput,
  }, recorder);

  releaseBuffer(gateOutput);
  releaseBuffer(upOutput);

  // 4. Down projection
  const downWeight = getWeightBuffer(layerWeights.down, 'ffn_down');
  const output = await doMatmul(activatedOutput, downWeight, numTokens, hiddenSize, intermediateSize, { transposeB: true }, recorder);
  if (!(layerWeights.down instanceof GPUBuffer)) releaseBuffer(downWeight);
  releaseBuffer(activatedOutput);

  return output;
}

/**
 * Run MoE FFN on GPU.
 */
async function runMoEFFNGPU(
  layerIdx: number,
  inputBuffer: GPUBuffer,
  numTokens: number,
  context: LayerContext
): Promise<GPUBuffer> {
  const { config, moeRouter, expertWeights, expertLoader, layerRouterWeights } = context;

  if (!moeRouter || !expertWeights || !expertLoader) {
    throw new Error('MoE components not initialized');
  }

  // Import dynamically to avoid circular dependency
  const { moeFeedForwardGPU } = await import('./moe-impl.js');

  return moeFeedForwardGPU(
    inputBuffer,
    numTokens,
    {
      hiddenSize: config.hiddenSize,
      intermediateSize: config.intermediateSize,
      numExperts: config.numExperts || 8,
      moeTopK: config.moeTopK || 2,
      hiddenActivation: config.hiddenActivation,
    },
    moeRouter,
    expertWeights,
    expertLoader,
    layerIdx,
    layerRouterWeights
  );
}

// ============================================================================
// CPU Fallback
// ============================================================================

/**
 * CPU fallback layer processing.
 *
 * This is a simplified version that returns zeros since full CPU inference
 * is not the primary use case. The main purpose is to allow the pipeline
 * to continue even when GPU is unavailable.
 */
export async function processLayerCPU(
  layerIdx: number,
  hiddenStates: Float32Array,
  numTokens: number,
  isPrefill: boolean,
  context: LayerContext
): Promise<Float32Array> {
  const { config } = context;
  const { hiddenSize } = config;

  // CPU fallback - return copy of input (simplified)
  // Full CPU inference would require implementing all operations on CPU
  console.warn(`[Layer ${layerIdx}] CPU fallback - returning input unchanged`);
  return new Float32Array(hiddenStates);
}
