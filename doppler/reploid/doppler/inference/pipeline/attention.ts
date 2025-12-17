/**
 * Attention operations for transformer layers.
 *
 * This module handles:
 * - Q/K/V projections
 * - RoPE position encoding
 * - KV cache management
 * - Multi-head attention computation
 * - Output projection
 *
 * @module inference/pipeline/attention
 */

import type { ParsedModelConfig } from './config.js';
import type { PipelineContext, LayerWeights, MaybeGPUBuffer } from './types.js';
import { getDevice } from '../../gpu/device.js';
import { acquireBuffer, releaseBuffer } from '../../gpu/buffer-pool.js';
import {
  runMatmul,
  runRMSNorm,
  runRoPE,
  runAttention,
  castF32ToF16,
  recordMatmul,
  recordRMSNorm,
  recordRoPE,
  recordAttention,
  recordCastF32ToF16,
  CommandRecorder,
} from '../../gpu/kernel-selector.js';

/**
 * Attention configuration for a layer.
 */
export interface AttentionConfig {
  layerIdx: number;
  numTokens: number;
  isPrefill: boolean;
  numHeads: number;
  numKVHeads: number;
  headDim: number;
  hiddenSize: number;
  rmsNormEps: number;
  currentSeqLen: number;
  slidingWindow?: number | null;
  layerType?: string;
  attentionKernelOverride?: string | null;
}

/**
 * Attention state passed between operations.
 */
export interface AttentionState {
  ropeFreqsCos: GPUBuffer | null;
  ropeFreqsSin: GPUBuffer | null;
  kvCache: any;
}

/**
 * Debug flags to prevent repeated logging.
 */
export interface AttentionDebugFlags {
  l0NormedDebugDone?: boolean;
  l0QKVDebugDone?: boolean;
  l0RoPEDebugDone?: boolean;
  l0AttnDebugDone?: boolean;
  l0OProjDebugDone?: boolean;
}

/**
 * Run attention for a single layer (GPU path).
 *
 * @param inputBuffer - Input hidden states (GPUBuffer)
 * @param layerWeights - Weights for this layer
 * @param config - Attention configuration
 * @param state - Shared state (RoPE freqs, KV cache)
 * @param debug - Debug mode flag
 * @param debugFlags - Mutable debug flags to prevent repeated logging
 * @returns Output buffer after attention
 */
export async function runLayerAttentionGPU(
  inputBuffer: GPUBuffer,
  layerWeights: LayerWeights | null,
  config: AttentionConfig,
  state: AttentionState,
  debug: boolean = false,
  debugFlags: AttentionDebugFlags = {},
  getWeightBuffer?: (weight: any, label: string) => GPUBuffer,
  getNormWeightBuffer?: (weight: any, label: string) => GPUBuffer,
  debugCheckBuffer?: (buffer: GPUBuffer, label: string, numTokens: number, expectedDim?: number) => Promise<void>
): Promise<GPUBuffer> {
  const {
    layerIdx,
    numTokens,
    isPrefill,
    numHeads,
    numKVHeads,
    headDim,
    hiddenSize,
    rmsNormEps,
    currentSeqLen,
    slidingWindow,
    layerType,
    attentionKernelOverride,
  } = config;

  const device = getDevice();

  // Debug logging moved to debug-utils.ts (enable via setDebugConfig)

  if (!layerWeights) {
    // Return zeros if no weights
    const output = acquireBuffer(numTokens * hiddenSize * 4, undefined, 'attn_output');
    return output;
  }

  const qSize = numTokens * numHeads * headDim;
  const kvSize = numTokens * numKVHeads * headDim;

  // 1. Input norm
  let normedBuffer = inputBuffer;
  if (layerWeights.inputNorm && getNormWeightBuffer) {
    const normWeightBuf = getNormWeightBuffer(layerWeights.inputNorm, 'input_norm');
    normedBuffer = await runRMSNorm(inputBuffer, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    });
    if (!(layerWeights.inputNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
  }

  // Debug: Check normed input for L0 prefill
  if (layerIdx === 0 && isPrefill && !debugFlags.l0NormedDebugDone && debugCheckBuffer) {
    debugFlags.l0NormedDebugDone = true;
    await debugCheckBuffer(normedBuffer, 'L0 normed input (GPU)', numTokens);
  }

  // 2. Q/K/V projections
  let Q: GPUBuffer, K: GPUBuffer, V: GPUBuffer;

  if (layerWeights.qProj && getWeightBuffer) {
    const qProjBuf = getWeightBuffer(layerWeights.qProj, 'q_proj');
    Q = await runMatmul(normedBuffer, qProjBuf, numTokens, numHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.qProj instanceof GPUBuffer)) releaseBuffer(qProjBuf);
  } else {
    Q = acquireBuffer(qSize * 4, undefined, 'Q');
  }

  if (layerWeights.kProj && getWeightBuffer) {
    const kProjBuf = getWeightBuffer(layerWeights.kProj, 'k_proj');
    K = await runMatmul(normedBuffer, kProjBuf, numTokens, numKVHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.kProj instanceof GPUBuffer)) releaseBuffer(kProjBuf);
  } else {
    K = acquireBuffer(kvSize * 4, undefined, 'K');
  }

  if (layerWeights.vProj && getWeightBuffer) {
    const vProjBuf = getWeightBuffer(layerWeights.vProj, 'v_proj');
    V = await runMatmul(normedBuffer, vProjBuf, numTokens, numKVHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.vProj instanceof GPUBuffer)) releaseBuffer(vProjBuf);
  } else {
    V = acquireBuffer(kvSize * 4, undefined, 'V');
  }

  // Debug: Check Q/K/V after projections for L0 prefill
  if (layerIdx === 0 && isPrefill && !debugFlags.l0QKVDebugDone && debugCheckBuffer) {
    debugFlags.l0QKVDebugDone = true;
    await debugCheckBuffer(Q, 'L0 Q after proj (GPU)', numTokens, numHeads * headDim);
    await debugCheckBuffer(K, 'L0 K after proj (GPU)', numTokens, numKVHeads * headDim);
    await debugCheckBuffer(V, 'L0 V after proj (GPU)', numTokens, numKVHeads * headDim);
  }

  // Optional per-head Q/K norm (Gemma-family)
  if ((layerWeights as any).qNorm && getNormWeightBuffer) {
    const qNormBuf = getNormWeightBuffer((layerWeights as any).qNorm, 'q_norm');
    const qElems = qNormBuf.size / 4;
    if (qElems === headDim) {
      const qNormed = await runRMSNorm(Q, qNormBuf, rmsNormEps, {
        batchSize: numTokens * numHeads,
        hiddenSize: headDim,
      });
      releaseBuffer(Q);
      Q = qNormed;
    }
    if (!((layerWeights as any).qNorm instanceof GPUBuffer)) releaseBuffer(qNormBuf);
  }

  if ((layerWeights as any).kNorm && getNormWeightBuffer) {
    const kNormBuf = getNormWeightBuffer((layerWeights as any).kNorm, 'k_norm');
    const kElems = kNormBuf.size / 4;
    if (kElems === headDim) {
      const kNormed = await runRMSNorm(K, kNormBuf, rmsNormEps, {
        batchSize: numTokens * numKVHeads,
        hiddenSize: headDim,
      });
      releaseBuffer(K);
      K = kNormed;
    }
    if (!((layerWeights as any).kNorm instanceof GPUBuffer)) releaseBuffer(kNormBuf);
  }

  if (normedBuffer !== inputBuffer) releaseBuffer(normedBuffer);

  // 3. RoPE
  if (state.ropeFreqsCos && state.ropeFreqsSin) {
    await runRoPE(Q, state.ropeFreqsCos, state.ropeFreqsSin, numTokens, {
      numHeads, headDim, startPos: currentSeqLen,
    });
    await runRoPE(K, state.ropeFreqsCos, state.ropeFreqsSin, numTokens, {
      numHeads: numKVHeads, headDim, startPos: currentSeqLen,
    });
  }

  // Debug: Check Q/K after RoPE for L0 prefill
  if (layerIdx === 0 && isPrefill && !debugFlags.l0RoPEDebugDone && debugCheckBuffer) {
    debugFlags.l0RoPEDebugDone = true;
    await debugCheckBuffer(Q, 'L0 Q after RoPE (GPU)', numTokens, numHeads * headDim);
    await debugCheckBuffer(K, 'L0 K after RoPE (GPU)', numTokens, numKVHeads * headDim);
  }

  // 4. Update KV cache
  let cachedK: GPUBuffer, cachedV: GPUBuffer;
  let kvLenForAttention = currentSeqLen + numTokens;
  let causalForAttention = true;
  let startPosForMask = currentSeqLen;

  const hasCache = state.kvCache?.hasGPUCache?.();

  if (hasCache) {
    if (state.kvCache.kvDtype === 'f16') {
      const kElems = kvSize;
      const kF16 = await castF32ToF16(K, kElems);
      const vF16 = await castF32ToF16(V, kElems);
      state.kvCache.updateFromGPU(layerIdx, kF16, vF16, currentSeqLen, numTokens);
      releaseBuffer(kF16);
      releaseBuffer(vF16);
    } else {
      state.kvCache.updateFromGPU(layerIdx, K, V, currentSeqLen, numTokens);
    }
    const gpuBuffers = state.kvCache.getGPUBuffers(layerIdx);
    cachedK = gpuBuffers.keysGPU;
    cachedV = gpuBuffers.valuesGPU;
    kvLenForAttention = gpuBuffers.seqLen;
  } else {
    cachedK = K;
    cachedV = V;
    kvLenForAttention = numTokens;
    startPosForMask = 0;
  }

  // Sliding window attention for specific layers
  const isLayerSliding = layerType === 'sliding_attention';
  const effectiveSlidingWindow = isLayerSliding ? slidingWindow : null;

  if (!isPrefill && isLayerSliding && slidingWindow) {
    causalForAttention = false;
    startPosForMask = 0;
  }

  if (kvLenForAttention <= 0) {
    throw new Error(`Invalid kvLen ${kvLenForAttention} at layer ${layerIdx}`);
  }

  // 5. Attention
  const attnOutput = await runAttention(Q, cachedK, cachedV, null, numHeads, headDim, {
    seqLen: numTokens,
    kvLen: kvLenForAttention,
    numKVHeads,
    causal: causalForAttention,
    startPos: startPosForMask,
    attentionKernel: attentionKernelOverride || undefined,
    slidingWindow: effectiveSlidingWindow,
  });

  // Debug: Check attention output for L0 prefill
  if (layerIdx === 0 && isPrefill && !debugFlags.l0AttnDebugDone && debugCheckBuffer) {
    debugFlags.l0AttnDebugDone = true;
    await debugCheckBuffer(attnOutput, 'L0 attention output (before o_proj, GPU)', numTokens, numHeads * headDim);
  }

  // 6. Output projection
  let output: GPUBuffer;
  if (layerWeights.oProj && getWeightBuffer) {
    const oProjBuf = getWeightBuffer(layerWeights.oProj, 'o_proj');
    output = await runMatmul(attnOutput, oProjBuf, numTokens, hiddenSize, numHeads * headDim, { transposeB: true });
    if (!(layerWeights.oProj instanceof GPUBuffer)) releaseBuffer(oProjBuf);
  } else {
    output = attnOutput;
  }

  // Debug: Check after o_proj for L0 prefill
  if (layerIdx === 0 && isPrefill && !debugFlags.l0OProjDebugDone && debugCheckBuffer) {
    debugFlags.l0OProjDebugDone = true;
    await debugCheckBuffer(output, 'L0 attention output (after o_proj, GPU)', numTokens, hiddenSize);
  }

  // Cleanup
  releaseBuffer(Q);
  releaseBuffer(K);
  releaseBuffer(V);
  if (output !== attnOutput) releaseBuffer(attnOutput);

  return output;
}

/**
 * Record attention for a single layer (batched, no submit).
 *
 * Uses record* kernel variants to batch all GPU operations into a shared
 * command encoder. No GPU submits happen here - submit once at end of forward pass.
 */
export async function recordLayerAttentionGPU(
  recorder: CommandRecorder,
  inputBuffer: GPUBuffer,
  layerWeights: LayerWeights | null,
  config: AttentionConfig,
  state: AttentionState,
  debug: boolean = false,
  debugFlags: AttentionDebugFlags = {},
  getWeightBuffer?: (weight: any, label: string) => GPUBuffer,
  getNormWeightBuffer?: (weight: any, label: string) => GPUBuffer,
  debugCheckBuffer?: (buffer: GPUBuffer, label: string, numTokens: number, expectedDim?: number) => Promise<void>
): Promise<GPUBuffer> {
  const {
    layerIdx,
    numTokens,
    isPrefill,
    numHeads,
    numKVHeads,
    headDim,
    hiddenSize,
    rmsNormEps,
    currentSeqLen,
    slidingWindow,
    layerType,
    attentionKernelOverride,
  } = config;

  if (!layerWeights) {
    const output = acquireBuffer(numTokens * hiddenSize * 4, undefined, 'attn_output');
    return output;
  }

  const qSize = numTokens * numHeads * headDim;
  const kvSize = numTokens * numKVHeads * headDim;

  // 1. Input norm
  let normedBuffer = inputBuffer;
  if (layerWeights.inputNorm && getNormWeightBuffer) {
    const normWeightBuf = getNormWeightBuffer(layerWeights.inputNorm, 'input_norm');
    normedBuffer = await recordRMSNorm(recorder, inputBuffer, normWeightBuf, rmsNormEps, {
      batchSize: numTokens,
      hiddenSize,
    });
    if (!(layerWeights.inputNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuf);
  }

  // 2. Q/K/V projections
  let Q: GPUBuffer, K: GPUBuffer, V: GPUBuffer;

  if (layerWeights.qProj && getWeightBuffer) {
    const qProjBuf = getWeightBuffer(layerWeights.qProj, 'q_proj');
    Q = await recordMatmul(recorder, normedBuffer, qProjBuf, numTokens, numHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.qProj instanceof GPUBuffer)) releaseBuffer(qProjBuf);
  } else {
    Q = acquireBuffer(qSize * 4, undefined, 'Q');
  }

  if (layerWeights.kProj && getWeightBuffer) {
    const kProjBuf = getWeightBuffer(layerWeights.kProj, 'k_proj');
    K = await recordMatmul(recorder, normedBuffer, kProjBuf, numTokens, numKVHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.kProj instanceof GPUBuffer)) releaseBuffer(kProjBuf);
  } else {
    K = acquireBuffer(kvSize * 4, undefined, 'K');
  }

  if (layerWeights.vProj && getWeightBuffer) {
    const vProjBuf = getWeightBuffer(layerWeights.vProj, 'v_proj');
    V = await recordMatmul(recorder, normedBuffer, vProjBuf, numTokens, numKVHeads * headDim, hiddenSize, { transposeB: true });
    if (!(layerWeights.vProj instanceof GPUBuffer)) releaseBuffer(vProjBuf);
  } else {
    V = acquireBuffer(kvSize * 4, undefined, 'V');
  }

  // Optional per-head Q/K norm (Gemma-family)
  if ((layerWeights as any).qNorm && getNormWeightBuffer) {
    const qNormBuf = getNormWeightBuffer((layerWeights as any).qNorm, 'q_norm');
    const qElems = qNormBuf.size / 4;
    if (qElems === headDim) {
      const qNormed = await recordRMSNorm(recorder, Q, qNormBuf, rmsNormEps, {
        batchSize: numTokens * numHeads,
        hiddenSize: headDim,
      });
      releaseBuffer(Q);
      Q = qNormed;
    }
    if (!((layerWeights as any).qNorm instanceof GPUBuffer)) releaseBuffer(qNormBuf);
  }

  if ((layerWeights as any).kNorm && getNormWeightBuffer) {
    const kNormBuf = getNormWeightBuffer((layerWeights as any).kNorm, 'k_norm');
    const kElems = kNormBuf.size / 4;
    if (kElems === headDim) {
      const kNormed = await recordRMSNorm(recorder, K, kNormBuf, rmsNormEps, {
        batchSize: numTokens * numKVHeads,
        hiddenSize: headDim,
      });
      releaseBuffer(K);
      K = kNormed;
    }
    if (!((layerWeights as any).kNorm instanceof GPUBuffer)) releaseBuffer(kNormBuf);
  }

  if (normedBuffer !== inputBuffer) releaseBuffer(normedBuffer);

  // 3. RoPE
  if (state.ropeFreqsCos && state.ropeFreqsSin) {
    await recordRoPE(recorder, Q, state.ropeFreqsCos, state.ropeFreqsSin, numTokens, {
      numHeads, headDim, startPos: currentSeqLen,
    });
    await recordRoPE(recorder, K, state.ropeFreqsCos, state.ropeFreqsSin, numTokens, {
      numHeads: numKVHeads, headDim, startPos: currentSeqLen,
    });
  }

  // 4. Update KV cache
  let cachedK: GPUBuffer, cachedV: GPUBuffer;
  let kvLenForAttention = currentSeqLen + numTokens;
  let causalForAttention = true;
  let startPosForMask = currentSeqLen;

  const hasCache = state.kvCache?.hasGPUCache?.();

  if (hasCache) {
    // Use recordUpdateFromGPU to record copy operations to the recorder's encoder
    // This ensures K/V buffers are populated before copying (all ops submitted together)
    const enc = recorder.getEncoder();
    if (state.kvCache.kvDtype === 'f16') {
      const kElems = kvSize;
      const kF16 = await recordCastF32ToF16(recorder, K, kElems);
      const vF16 = await recordCastF32ToF16(recorder, V, kElems);
      state.kvCache.recordUpdateFromGPU(enc, layerIdx, kF16, vF16, currentSeqLen, numTokens);
      // Track for cleanup after submit (not release!) - buffers are used by recorded copy ops
      recorder.trackTemporaryBuffer(kF16);
      recorder.trackTemporaryBuffer(vF16);
    } else {
      state.kvCache.recordUpdateFromGPU(enc, layerIdx, K, V, currentSeqLen, numTokens);
    }
    const gpuBuffers = state.kvCache.getGPUBuffers(layerIdx);
    cachedK = gpuBuffers.keysGPU;
    cachedV = gpuBuffers.valuesGPU;
    kvLenForAttention = gpuBuffers.seqLen;
  } else {
    cachedK = K;
    cachedV = V;
    kvLenForAttention = numTokens;
    startPosForMask = 0;
  }

  // Sliding window attention for specific layers
  const isLayerSliding = layerType === 'sliding_attention';
  const effectiveSlidingWindow = isLayerSliding ? slidingWindow : null;

  if (!isPrefill && isLayerSliding && slidingWindow) {
    causalForAttention = false;
    startPosForMask = 0;
  }

  if (kvLenForAttention <= 0) {
    throw new Error(`Invalid kvLen ${kvLenForAttention} at layer ${layerIdx}`);
  }

  // 5. Attention
  const attnOutput = await recordAttention(recorder, Q, cachedK, cachedV, null, numHeads, headDim, {
    seqLen: numTokens,
    kvLen: kvLenForAttention,
    numKVHeads,
    causal: causalForAttention,
    startPos: startPosForMask,
    attentionKernel: attentionKernelOverride || undefined,
    slidingWindow: effectiveSlidingWindow,
  });

  // 6. Output projection
  let output: GPUBuffer;
  if (layerWeights.oProj && getWeightBuffer) {
    const oProjBuf = getWeightBuffer(layerWeights.oProj, 'o_proj');
    output = await recordMatmul(recorder, attnOutput, oProjBuf, numTokens, hiddenSize, numHeads * headDim, { transposeB: true });
    if (!(layerWeights.oProj instanceof GPUBuffer)) releaseBuffer(oProjBuf);
  } else {
    output = attnOutput;
  }

  // Track intermediate buffers for cleanup after submit (not release!)
  // These buffers are used by recorded operations that haven't executed yet.
  // Releasing them back to the pool would allow reuse before the encoder is submitted,
  // causing data corruption (especially for small decode buffers).
  recorder.trackTemporaryBuffer(Q);
  recorder.trackTemporaryBuffer(K);
  recorder.trackTemporaryBuffer(V);
  if (output !== attnOutput) recorder.trackTemporaryBuffer(attnOutput);

  return output;
}
