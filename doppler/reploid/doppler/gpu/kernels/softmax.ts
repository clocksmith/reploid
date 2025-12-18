/**
 * Softmax Kernels
 *
 * Provides softmax operations with support for:
 * - Temperature scaling
 * - Top-K fused softmax (for MoE routing)
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** Softmax kernel options */
export interface SoftmaxOptions {
  batchSize?: number;
  size?: number | null;
  seqLen?: number | null;
  temperature?: number;
  outputBuffer?: GPUBuffer | null;
  normalize?: boolean;
}

/**
 * Run softmax operation
 */
export async function runSoftmax(
  input: GPUBuffer,
  axis: number,
  options: SoftmaxOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { batchSize = 1, size, temperature = 1.0, outputBuffer = null } = options;

  const inferredSize = size || (input.size / (batchSize * 4));
  const pipeline = await createPipeline('softmax', 'default');

  const outputSize = batchSize * inferredSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'softmax_output');

  // Create uniform buffer
  // WGSL struct: { innerSize: u32, outerSize: u32, temperature: f32, _pad: u32 }
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSize, true);  // innerSize at offset 0
  uniformView.setUint32(4, batchSize, true);     // outerSize at offset 4
  uniformView.setFloat32(8, temperature, true);

  const uniformBuffer = device.createBuffer({
    label: 'softmax_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'softmax_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'softmax_encoder' });
  const pass = encoder.beginComputePass({ label: 'softmax_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  pass.dispatchWorkgroups(batchSize);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run fused softmax + top-K for MoE routing
 */
export async function runSoftmaxTopK(
  logits: GPUBuffer,
  numTokens: number,
  numExperts: number,
  topK: number,
  options: SoftmaxOptions = {}
): Promise<{ indices: GPUBuffer; weights: GPUBuffer }> {
  const device = getDevice();
  const { normalize = true } = options;

  const pipeline = await createPipeline('topk', 'fused');

  // Output buffers: indices [numTokens, topK] as u32, weights [numTokens, topK] as f32
  const indicesSize = numTokens * topK * 4; // u32
  const weightsSize = numTokens * topK * 4; // f32

  const indices = acquireBuffer(indicesSize, undefined, 'softmax_topk_indices');
  const weights = acquireBuffer(weightsSize, undefined, 'softmax_topk_weights');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, numExperts, true);
  uniformView.setUint32(8, topK, true);
  uniformView.setUint32(12, normalize ? 1 : 0, true);

  const uniformBuffer = device.createBuffer({
    label: 'softmax_topk_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'softmax_topk_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: indices } },
      { binding: 3, resource: { buffer: weights } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'softmax_topk_encoder' });
  const pass = encoder.beginComputePass({ label: 'softmax_topk_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  pass.dispatchWorkgroups(numTokens);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  setBufferDtype(indices, 'u32');
  setBufferDtype(weights, 'f32');

  return { indices, weights };
}

/**
 * Record softmax (batched, no submit)
 */
export async function recordSoftmax(
  recorder: CommandRecorder,
  input: GPUBuffer,
  axis: number,
  options: SoftmaxOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    batchSize = 1,
    seqLen = null,
    outputBuffer = null,
  } = options;

  const inferredSeqLen = seqLen || (input.size / (batchSize * 4));
  const pipeline = await createPipeline('softmax', 'default');

  const outputSize = batchSize * inferredSeqLen * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'softmax_output');

  // Uniform buffer
  // WGSL struct: { innerSize: u32, outerSize: u32, temperature: f32, _pad: u32 }
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSeqLen, true);  // innerSize at offset 0
  uniformView.setUint32(4, batchSize, true);       // outerSize at offset 4
  uniformView.setFloat32(8, 1.0, true);            // temperature (default 1.0)

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'softmax_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'softmax_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('softmax');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(batchSize);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
