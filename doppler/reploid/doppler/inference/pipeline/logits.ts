/**
 * Logits computation - final layer norm and LM head projection.
 *
 * This module handles the final steps of inference:
 * - Apply final RMS norm to hidden states
 * - Project to vocabulary size via LM head
 * - Handle tied embeddings (transposeB for HuggingFace format)
 * - CPU fallback for non-GPU execution
 *
 * @module inference/pipeline/logits
 */

import { getDevice } from '../../gpu/device.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../../gpu/buffer-pool.js';
import { runMatmul, runRMSNorm } from '../../gpu/kernel-selector.js';
import { recordMatmul } from '../../gpu/kernels/matmul.js';
import { recordRMSNorm } from '../../gpu/kernels/rmsnorm.js';
import { getBufferDtype } from '../../gpu/buffer-dtypes.js';
import type { CommandRecorder } from '../../gpu/command-recorder.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for logits computation.
 */
export interface LogitsConfig {
  hiddenSize: number;
  vocabSize: number;
  rmsNormEps: number;
  useTiedEmbeddings: boolean;
  embeddingVocabSize: number | null;
}

/**
 * Weights required for logits computation.
 */
export interface LogitsWeights {
  finalNorm: GPUBuffer | Float32Array;
  lmHead: GPUBuffer | Float32Array;
}

/**
 * Debug flags for logits computation.
 */
export interface LogitsDebugFlags {
  finalNormDebugDone?: boolean;
  afterFinalNormDebugDone?: boolean;
}

// ============================================================================
// CPU Fallback Functions
// ============================================================================

/**
 * CPU RMSNorm implementation.
 *
 * Computes: output[i] = (x[i] / rms) * weight[i]
 * where rms = sqrt(mean(x^2) + eps)
 *
 * @param x - Input tensor
 * @param weight - Norm weights
 * @param eps - Epsilon for numerical stability
 * @returns Normalized tensor
 */
export function rmsNormCPU(
  x: Float32Array,
  weight: Float32Array,
  eps: number = 1e-5
): Float32Array {
  const n = x.length;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += x[i] * x[i];
  }
  const rms = Math.sqrt(sumSq / n + eps);

  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = (x[i] / rms) * weight[i % weight.length];
  }
  return result;
}

/**
 * CPU matmul implementation (fallback for non-GPU).
 *
 * Computes: output = input @ weight^T
 * Input: [M, K], Weight: [N, K] (transposed), Output: [M, N]
 *
 * @param input - Input tensor [M, K]
 * @param weight - Weight tensor [N, K]
 * @param M - Batch size (num tokens)
 * @param N - Output size (vocab size)
 * @param K - Hidden size
 * @returns Output tensor [M, N]
 */
export function matmulCPU(
  input: Float32Array,
  weight: Float32Array,
  M: number,
  N: number,
  K: number
): Float32Array {
  const result = new Float32Array(M * N);

  for (let m = 0; m < M; m++) {
    for (let n = 0; n < N; n++) {
      let sum = 0;
      for (let k = 0; k < K; k++) {
        // Weight is [N, K] (vocab x hidden) - row-major
        sum += input[m * K + k] * weight[n * K + k];
      }
      result[m * N + n] = sum;
    }
  }
  return result;
}

// ============================================================================
// Main Logits Computation
// ============================================================================

/**
 * Compute logits from hidden states.
 *
 * This function:
 * 1. Applies final RMS normalization
 * 2. Projects to vocabulary via LM head matrix multiplication
 * 3. Handles tied embeddings (uses transposeB for HF format)
 * 4. Falls back to CPU if GPU unavailable
 *
 * @param hiddenStates - Hidden states from transformer [numTokens, hiddenSize]
 * @param numTokens - Number of tokens (required for GPU buffer input)
 * @param weights - Final norm and LM head weights
 * @param config - Model configuration for logits
 * @param useGPU - Whether to use GPU
 * @param debugFlags - Debug flags to prevent repeated logging
 * @param getNormWeightBuffer - Helper to get norm weight buffer (from pipeline)
 * @param debugCheckBuffer - Helper for debug buffer checking (from pipeline)
 * @returns Logits tensor [numTokens, vocabSize]
 */
export async function computeLogits(
  hiddenStates: GPUBuffer | Float32Array,
  numTokens: number,
  weights: LogitsWeights,
  config: LogitsConfig,
  useGPU: boolean,
  debugFlags: LogitsDebugFlags = {},
  getNormWeightBuffer?: (weight: any, label: string) => GPUBuffer,
  debugCheckBuffer?: (buffer: GPUBuffer, label: string, numTokens: number, expectedDim?: number) => Promise<void>
): Promise<Float32Array> {
  console.log(`[Pipeline] LOGITS_ENTRY: numTokens=${numTokens}, useGPU=${useGPU}`);
  const { hiddenSize, vocabSize, rmsNormEps, useTiedEmbeddings, embeddingVocabSize } = config;
  const { finalNorm, lmHead } = weights;
  const device = getDevice();

  if (!finalNorm || !lmHead) {
    console.warn('[Pipeline] Final norm or LM head not loaded, returning zeros');
    return new Float32Array(vocabSize);
  }

  // Check if input is GPU buffer
  const inputIsGPU = hiddenStates instanceof GPUBuffer;

  // CPU fallback path
  console.log(`[Pipeline] LOGITS_PATH: device=${!!device}, useGPU=${useGPU}, taking ${(!device || !useGPU) ? 'CPU' : 'GPU'} path`);
  if (!device || !useGPU) {
    let cpuHiddenStates: Float32Array;
    if (inputIsGPU) {
      const data = await readBuffer(hiddenStates, numTokens * hiddenSize * 4);
      cpuHiddenStates = new Float32Array(data);
    } else {
      cpuHiddenStates = hiddenStates as Float32Array;
    }
    const normed = rmsNormCPU(cpuHiddenStates, finalNorm as Float32Array, rmsNormEps);
    return matmulCPU(normed, lmHead as Float32Array, numTokens, vocabSize, hiddenSize);
  }

  // GPU path
  // 1. Get or create input buffer
  let inputBuffer: GPUBuffer;
  let inputBufferOwned = false;
  if (inputIsGPU) {
    inputBuffer = hiddenStates as GPUBuffer;
  } else {
    inputBuffer = acquireBuffer((hiddenStates as Float32Array).byteLength, undefined, 'logits_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates as unknown as BufferSource);
    inputBufferOwned = true;
  }

  // 2. Apply final RMSNorm
  let normWeightBuffer: GPUBuffer;
  if (getNormWeightBuffer) {
    normWeightBuffer = getNormWeightBuffer(finalNorm, 'final_norm_w');
  } else if (finalNorm instanceof GPUBuffer) {
    normWeightBuffer = finalNorm;
  } else {
    normWeightBuffer = acquireBuffer((finalNorm as Float32Array).byteLength, undefined, 'final_norm_w');
    device.queue.writeBuffer(normWeightBuffer, 0, finalNorm as unknown as BufferSource);
  }

  // Debug: Check hidden state before final norm
  if (!debugFlags.finalNormDebugDone && debugCheckBuffer) {
    debugFlags.finalNormDebugDone = true;
    await debugCheckBuffer(inputBuffer, 'Before final norm', numTokens);
    await debugCheckBuffer(normWeightBuffer, 'Final norm weights', 1, 100);
  }

  // Debug: Always log hidden state BEFORE final norm for last token
  {
    const lastTokenOffset = (numTokens - 1) * hiddenSize * 4;
    // Read full last-token vector for accurate maxAbs comparisons vs HF.
    const sampleSize = hiddenSize * 4;
    const staging = device.createBuffer({ size: sampleSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(inputBuffer, lastTokenOffset, staging, 0, sampleSize);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    const maxAbs = Math.max(...Array.from(data).map(x => Math.abs(x)));
    console.log(`[Pipeline] BEFORE_FINAL_NORM[pos=${numTokens - 1}]: maxAbs=${maxAbs.toFixed(4)}, first5=[${Array.from(data).slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);

    // Also read FULL final norm weights
    const wsSize = normWeightBuffer.size;
    const wstaging = device.createBuffer({ size: wsSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const wenc = device.createCommandEncoder();
    wenc.copyBufferToBuffer(normWeightBuffer, 0, wstaging, 0, wsSize);
    device.queue.submit([wenc.finish()]);
    await wstaging.mapAsync(GPUMapMode.READ);
    const wdata = new Float32Array(wstaging.getMappedRange().slice(0));
    wstaging.unmap();
    wstaging.destroy();
    const wmaxAbs = Math.max(...Array.from(wdata).map(x => Math.abs(x)));
    console.log(`[Pipeline] FULL_FINAL_NORM_WEIGHTS: maxAbs=${wmaxAbs.toFixed(4)}, size=${wdata.length}, first5=[${Array.from(wdata).slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);
  }

  const normedBuffer = await runRMSNorm(inputBuffer, normWeightBuffer, rmsNormEps, {
    batchSize: numTokens,
    hiddenSize,
  });

  // Debug: check post-norm values at LAST token position (used for logits)
  {
    // Hidden state for LAST token is at offset (numTokens-1) * hiddenSize
    const lastTokenOffset = (numTokens - 1) * hiddenSize * 4;  // F32
    // Read full last-token vector for accurate maxAbs comparisons vs HF.
    const sampleSize = hiddenSize * 4;
    const staging = device.createBuffer({ size: sampleSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(normedBuffer, lastTokenOffset, staging, 0, sampleSize);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    const maxAbs = Math.max(...Array.from(data).map(x => Math.abs(x)));
    const nonZero = Array.from(data).filter(x => x !== 0).length;
    console.log(`[Pipeline] LAST_TOKEN_HIDDEN[pos=${numTokens - 1}]: maxAbs=${maxAbs.toFixed(4)}, nonZero=${nonZero}/${data.length}, sample=[${Array.from(data).slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);
  }

  // Debug: Check hidden state after final norm
  if (!debugFlags.afterFinalNormDebugDone && debugCheckBuffer) {
    debugFlags.afterFinalNormDebugDone = true;
    await debugCheckBuffer(normedBuffer, 'After final norm', numTokens);
  }

  // 3. Project to vocab via LM head
  let lmHeadBuffer: GPUBuffer;
  let lmHeadBufferOwned = false;
  if (lmHead instanceof GPUBuffer) {
    lmHeadBuffer = lmHead;
  } else {
    lmHeadBuffer = acquireBuffer((lmHead as Float32Array).byteLength, undefined, 'lm_head_w');
    device.queue.writeBuffer(lmHeadBuffer, 0, lmHead as unknown as BufferSource);
    lmHeadBufferOwned = true;
  }

  // For tied embeddings, use actual embedding matrix vocab size
  const matmulVocabSize = useTiedEmbeddings && embeddingVocabSize
    ? embeddingVocabSize
    : vocabSize;

  // Debug: Log buffer info for lm_head matmul
  const lmHeadDtype = getBufferDtype(lmHeadBuffer);
  const normedDtype = getBufferDtype(normedBuffer);
  console.log(`[Pipeline] LM_HEAD_MATMUL: M=${numTokens}, N=${matmulVocabSize}, K=${hiddenSize}, lmHeadDtype=${lmHeadDtype}, normedDtype=${normedDtype}, size=${lmHeadBuffer.size}`);

  // Debug: Sample lm_head weights at different positions
  // Check token 3730 ("blue") vs token 44821 ("Kaw") to understand the logit difference
  {
    const bytesPerElem = lmHeadDtype === 'f16' ? 2 : 4;
    const rowBytes = hiddenSize * bytesPerElem;

    // Sample rows for specific tokens
    const debugRows = [
      { id: 3730, name: 'blue' },
      { id: 44821, name: 'Kaw' },
      { id: 0, name: 'PAD' },
    ];

    for (const { id, name } of debugRows) {
      const rowOffset = id * rowBytes;
      if (rowOffset + 32 > lmHeadBuffer.size) {
        console.log(`[Pipeline] LM_HEAD_ROW[${name}]: offset ${rowOffset} exceeds buffer size ${lmHeadBuffer.size}`);
        continue;
      }
      const sampleSize = Math.min(32, rowBytes);  // Sample first 16 values (as F16)
      const staging = device.createBuffer({ size: sampleSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(lmHeadBuffer, rowOffset, staging, 0, sampleSize);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const rawData = staging.getMappedRange().slice(0);

      // Convert F16 to F32 for display
      let values: number[];
      if (lmHeadDtype === 'f16') {
        const u16 = new Uint16Array(rawData);
        const f32 = new Float32Array(u16.length);
        for (let i = 0; i < u16.length; i++) {
          // F16 to F32 conversion
          const h = u16[i];
          const sign = (h & 0x8000) >> 15;
          const exp = (h & 0x7C00) >> 10;
          const mant = h & 0x03FF;
          let f: number;
          if (exp === 0) {
            f = mant === 0 ? 0 : Math.pow(2, -14) * (mant / 1024);
          } else if (exp === 31) {
            f = mant === 0 ? Infinity : NaN;
          } else {
            f = Math.pow(2, exp - 15) * (1 + mant / 1024);
          }
          f32[i] = sign ? -f : f;
        }
        values = Array.from(f32);
      } else {
        values = Array.from(new Float32Array(rawData));
      }

      staging.unmap();
      staging.destroy();

      const maxAbs = Math.max(...values.map(x => Math.abs(x)));
      const nonZero = values.filter(x => x !== 0).length;
      console.log(`[Pipeline] LM_HEAD_ROW[${name}(${id})]: maxAbs=${maxAbs.toFixed(4)}, nonZero=${nonZero}/${values.length}, sample=[${values.slice(0, 5).map(x => x.toFixed(4)).join(', ')}]`);
    }
  }

  // HuggingFace models store lm_head as [vocabSize, hiddenSize], so transposeB=true
  const logitsBuffer = await runMatmul(normedBuffer, lmHeadBuffer, numTokens, matmulVocabSize, hiddenSize, {
    transposeB: 'auto',
  });

  // 4. Read back logits
  const logitsData = await readBuffer(logitsBuffer, numTokens * matmulVocabSize * 4);

  // Cleanup
  if (inputBufferOwned) releaseBuffer(inputBuffer);
  releaseBuffer(normedBuffer);
  releaseBuffer(logitsBuffer);
  if (!getNormWeightBuffer && !(finalNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuffer);
  if (lmHeadBufferOwned) releaseBuffer(lmHeadBuffer);

  // Pad with -Infinity if matmulVocabSize < vocabSize
  if (matmulVocabSize < vocabSize) {
    const paddedLogits = new Float32Array(numTokens * vocabSize);
    const rawLogits = new Float32Array(logitsData);
    for (let t = 0; t < numTokens; t++) {
      const srcOffset = t * matmulVocabSize;
      const dstOffset = t * vocabSize;
      // Copy actual logits
      for (let i = 0; i < matmulVocabSize; i++) {
        paddedLogits[dstOffset + i] = rawLogits[srcOffset + i];
      }
      // Pad extra slots with -Infinity
      for (let i = matmulVocabSize; i < vocabSize; i++) {
        paddedLogits[dstOffset + i] = -Infinity;
      }
    }
    return paddedLogits;
  }

  return new Float32Array(logitsData);
}

/**
 * Compute logits and return GPU buffer directly (deferred readback).
 *
 * This variant avoids the ~1MB readback per token, enabling GPU-side sampling.
 * Use with runGPUSample or runArgmax to sample directly on GPU.
 *
 * @param hiddenStates - Hidden states from transformer [numTokens, hiddenSize]
 * @param numTokens - Number of tokens
 * @param weights - Final norm and LM head weights
 * @param config - Model configuration for logits
 * @param debugFlags - Debug flags
 * @param getNormWeightBuffer - Helper to get norm weight buffer
 * @returns GPU buffer containing logits [numTokens, vocabSize]
 */
export async function computeLogitsGPU(
  hiddenStates: GPUBuffer | Float32Array,
  numTokens: number,
  weights: LogitsWeights,
  config: LogitsConfig,
  debugFlags: LogitsDebugFlags = {},
  getNormWeightBuffer?: (weight: any, label: string) => GPUBuffer,
): Promise<{ logitsBuffer: GPUBuffer; vocabSize: number } | null> {
  const { hiddenSize, vocabSize, rmsNormEps, useTiedEmbeddings, embeddingVocabSize } = config;
  const { finalNorm, lmHead } = weights;
  const device = getDevice();

  if (!device) {
    return null;
  }

  if (!finalNorm || !lmHead) {
    console.warn('[Pipeline] Final norm or LM head not loaded');
    return null;
  }

  // Get or create input buffer
  let inputBuffer: GPUBuffer;
  let inputBufferOwned = false;
  if (hiddenStates instanceof GPUBuffer) {
    inputBuffer = hiddenStates;
  } else {
    inputBuffer = acquireBuffer((hiddenStates as Float32Array).byteLength, undefined, 'logits_input');
    device.queue.writeBuffer(inputBuffer, 0, hiddenStates as unknown as BufferSource);
    inputBufferOwned = true;
  }

  // Apply final RMSNorm
  let normWeightBuffer: GPUBuffer;
  if (getNormWeightBuffer) {
    normWeightBuffer = getNormWeightBuffer(finalNorm, 'final_norm_w');
  } else if (finalNorm instanceof GPUBuffer) {
    normWeightBuffer = finalNorm;
  } else {
    normWeightBuffer = acquireBuffer((finalNorm as Float32Array).byteLength, undefined, 'final_norm_w');
    device.queue.writeBuffer(normWeightBuffer, 0, finalNorm as unknown as BufferSource);
  }

  const normedBuffer = await runRMSNorm(inputBuffer, normWeightBuffer, rmsNormEps, {
    batchSize: numTokens,
    hiddenSize,
  });

  // Project to vocab via LM head
  let lmHeadBuffer: GPUBuffer;
  let lmHeadBufferOwned = false;
  if (lmHead instanceof GPUBuffer) {
    lmHeadBuffer = lmHead;
  } else {
    lmHeadBuffer = acquireBuffer((lmHead as Float32Array).byteLength, undefined, 'lm_head_w');
    device.queue.writeBuffer(lmHeadBuffer, 0, lmHead as unknown as BufferSource);
    lmHeadBufferOwned = true;
  }

  const matmulVocabSize = useTiedEmbeddings && embeddingVocabSize
    ? embeddingVocabSize
    : vocabSize;

  const logitsBuffer = await runMatmul(normedBuffer, lmHeadBuffer, numTokens, matmulVocabSize, hiddenSize, {
    transposeB: 'auto',
  });

  // Cleanup intermediate buffers (but keep logitsBuffer)
  if (inputBufferOwned) releaseBuffer(inputBuffer);
  releaseBuffer(normedBuffer);
  if (!getNormWeightBuffer && !(finalNorm instanceof GPUBuffer)) releaseBuffer(normWeightBuffer);
  if (lmHeadBufferOwned) releaseBuffer(lmHeadBuffer);

  return { logitsBuffer, vocabSize: matmulVocabSize };
}

/**
 * Record logits computation (batched, no submit).
 *
 * This variant uses the CommandRecorder to batch logits computation with
 * preceding layer operations, avoiding a GPU sync point.
 *
 * @param recorder - CommandRecorder for batched operations
 * @param hiddenStates - Hidden states from transformer [numTokens, hiddenSize]
 * @param numTokens - Number of tokens
 * @param weights - Final norm and LM head weights
 * @param config - Model configuration for logits
 * @returns GPU buffer containing logits [numTokens, vocabSize] and vocab size
 */
export async function recordLogitsGPU(
  recorder: CommandRecorder,
  hiddenStates: GPUBuffer,
  numTokens: number,
  weights: LogitsWeights,
  config: LogitsConfig,
): Promise<{ logitsBuffer: GPUBuffer; vocabSize: number }> {
  const { hiddenSize, vocabSize, rmsNormEps, useTiedEmbeddings, embeddingVocabSize } = config;
  const { finalNorm, lmHead } = weights;
  const matmulVocabSize = useTiedEmbeddings && embeddingVocabSize ? embeddingVocabSize : vocabSize;

  if (!finalNorm || !lmHead) {
    throw new Error('[recordLogitsGPU] Final norm or LM head not loaded');
  }

  // Get norm weight buffer
  let normWeightBuffer: GPUBuffer;
  if (finalNorm instanceof GPUBuffer) {
    normWeightBuffer = finalNorm;
  } else {
    normWeightBuffer = acquireBuffer((finalNorm as Float32Array).byteLength, undefined, 'final_norm_w');
    recorder.device.queue.writeBuffer(normWeightBuffer, 0, finalNorm as unknown as BufferSource);
  }

  // Record RMSNorm (no submit)
  const normedBuffer = await recordRMSNorm(recorder, hiddenStates, normWeightBuffer, rmsNormEps, {
    batchSize: numTokens,
    hiddenSize,
  });

  // Get LM head buffer
  let lmHeadBuffer: GPUBuffer;
  if (lmHead instanceof GPUBuffer) {
    lmHeadBuffer = lmHead;
  } else {
    lmHeadBuffer = acquireBuffer((lmHead as Float32Array).byteLength, undefined, 'lm_head_w');
    recorder.device.queue.writeBuffer(lmHeadBuffer, 0, lmHead as unknown as BufferSource);
  }

  // Record matmul (no submit)
  const logitsBuffer = await recordMatmul(recorder, normedBuffer, lmHeadBuffer, numTokens, matmulVocabSize, hiddenSize, {
    transposeB: 'auto',
  });

  // Track intermediate buffer for cleanup after submit
  recorder.trackTemporaryBuffer(normedBuffer);

  return { logitsBuffer, vocabSize: matmulVocabSize };
}

/**
 * Extract logits for only the last position.
 *
 * Used after prefill to get logits for sampling the first generated token.
 *
 * @param logits - Full logits tensor [numTokens, vocabSize]
 * @param numTokens - Number of tokens
 * @param vocabSize - Vocabulary size
 * @returns Logits for last position [vocabSize]
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
