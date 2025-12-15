/**
 * Attention Kernels
 *
 * Provides optimized attention operations with support for:
 * - Prefill and decode phases
 * - Causal masking
 * - Grouped-query attention (GQA)
 * - Multiple implementation tiers (tiled, streaming)
 * - F16/F32 KV cache support
 */

import { getDevice, getDeviceLimits } from '../device.js';
import { getBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** Attention kernel options */
export interface AttentionOptions {
  seqLen?: number;
  kvLen?: number;
  numKVHeads?: number;
  scale?: number;
  causal?: boolean;
  startPos?: number;
  attentionKernel?: string | null;
  outputBuffer?: GPUBuffer | null;
  slidingWindow?: number;
}

/**
 * Run attention operation
 */
export async function runAttention(
  Q: GPUBuffer,
  K: GPUBuffer,
  V: GPUBuffer,
  mask: GPUBuffer | null,
  numHeads: number,
  headDim: number,
  options: AttentionOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const {
    seqLen = 1,
    kvLen = seqLen,
    numKVHeads = numHeads,
    scale = 1.0 / Math.sqrt(headDim),
    causal = true,
    startPos = 0,
    attentionKernel = null,
    outputBuffer = null,
  } = options;

  const limits = getDeviceLimits();
  const sharedLimit = limits?.maxComputeWorkgroupStorageSize ?? Infinity;

  // Select tier based on device shared memory and headDim (or user override).
  const kvDtype = getBufferDtype(K) || 'f32';
  const useF16KV = kvDtype === 'f16';

  const LARGE_MAX_HEAD_DIM = 64;
  const SMALL_MAX_HEAD_DIM = 256;
  const LARGE_REQUIRED_SHARED = 49152;
  const SMALL_BLOCK_SIZE = 32;
  const SMALL_HEAD_TILE = 32;
  const SMALL_REQUIRED_SHARED_F32 = 2 * SMALL_BLOCK_SIZE * SMALL_HEAD_TILE * 4;
  const SMALL_REQUIRED_SHARED_F16 = 2 * SMALL_BLOCK_SIZE * SMALL_HEAD_TILE * 2;

  let tier = attentionKernel;
  if (!tier) {
    const isDecode = seqLen === 1;
    const canLarge =
      headDim <= LARGE_MAX_HEAD_DIM &&
      sharedLimit >= LARGE_REQUIRED_SHARED;
    const smallRequired = useF16KV ? SMALL_REQUIRED_SHARED_F16 : SMALL_REQUIRED_SHARED_F32;
    const canSmall =
      headDim <= SMALL_MAX_HEAD_DIM &&
      sharedLimit >= smallRequired;
    if (canLarge) {
      tier = 'tiled_large';
    } else if (canSmall) {
      tier = 'tiled_small';
    } else if (isDecode) {
      tier = 'streaming';
    } else {
      console.warn(
        `[KernelSelector] No tiled attention fits prefill (headDim=${headDim}, shared=${sharedLimit}). ` +
        `Falling back to streaming. Expect slow prefill.`
      );
      tier = 'streaming';
    }
  }

  // Select variant based on tier and KV dtype.
  const base = 'prefill';
  let variant: string;
  if (tier === 'tiled_large') {
    variant = base + (useF16KV ? '_f16kv' : '');
  } else if (tier === 'tiled_small') {
    variant = `${base}_small${useF16KV ? '_f16kv' : ''}`;
  } else {
    variant = `${base}_streaming${useF16KV ? '_f16kv' : ''}`;
  }
  const pipeline = await createPipeline('attention', variant);

  // Create output buffer if not provided
  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'attention_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numHeads, true);
  uniformView.setUint32(4, numKVHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, kvLen, true);
  uniformView.setUint32(16, seqLen, true);
  uniformView.setFloat32(20, scale, true);
  uniformView.setUint32(24, causal ? 1 : 0, true);
  uniformView.setUint32(28, startPos, true);

  const uniformBuffer = device.createBuffer({
    label: 'attention_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'attention_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: Q } },
      { binding: 2, resource: { buffer: K } },
      { binding: 3, resource: { buffer: V } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'attention_encoder' });
  const pass = encoder.beginComputePass({ label: 'attention_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  let workgroups: number;
  if (tier === 'streaming') {
    workgroups = seqLen * numHeads;
  } else if (tier === 'tiled_large') {
    const blockSize = 64;
    workgroups = Math.ceil(seqLen / blockSize) * numHeads;
  } else {
    const blockSize = 32;
    workgroups = Math.ceil(seqLen / blockSize) * numHeads;
  }

  if (limits && workgroups > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error(
      `Attention dispatch requires ${workgroups} workgroups but device limit is ` +
      `${limits.maxComputeWorkgroupsPerDimension}. Reduce prompt length or use streaming attention.`
    );
  }
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Record attention operation (batched, no submit)
 */
export async function recordAttention(
  recorder: CommandRecorder,
  Q: GPUBuffer,
  K: GPUBuffer,
  V: GPUBuffer,
  mask: GPUBuffer | null,
  numHeads: number,
  headDim: number,
  options: AttentionOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    seqLen = 1,
    kvLen = seqLen,
    numKVHeads = numHeads,
    scale = 1.0 / Math.sqrt(headDim),
    causal = true,
    startPos = 0,
    outputBuffer = null,
  } = options;

  // Similar logic to runAttention for kernel selection
  const kvDtype = getBufferDtype(K) || 'f32';
  const useF16KV = kvDtype === 'f16';
  const variant = seqLen === 1 ?
    (useF16KV ? 'decode_streaming_f16kv' : 'decode_streaming') :
    (useF16KV ? 'prefill_f16kv' : 'prefill');

  const pipeline = await createPipeline('attention', variant);

  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'attention_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numHeads, true);
  uniformView.setUint32(4, numKVHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, kvLen, true);
  uniformView.setUint32(16, seqLen, true);
  uniformView.setFloat32(20, scale, true);
  uniformView.setUint32(24, causal ? 1 : 0, true);
  uniformView.setUint32(28, startPos, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'attention_uniforms');

  const bindGroup = device.createBindGroup({
    label: 'attention_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: Q } },
      { binding: 2, resource: { buffer: K } },
      { binding: 3, resource: { buffer: V } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  const pass = recorder.beginComputePass('attention');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = seqLen * numHeads;
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  return output;
}
