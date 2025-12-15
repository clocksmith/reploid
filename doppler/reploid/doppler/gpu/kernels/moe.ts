/**
 * Mixture of Experts (MoE) Kernels
 *
 * Provides kernels for MoE routing and token distribution:
 * - Top-K expert selection
 * - MoE token gathering (dispatching tokens to experts)
 * - Scatter-add (collecting expert outputs back to tokens)
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import { createPipeline } from './utils.js';

/** MoE kernel options */
export interface MoEOptions {
  normalize?: boolean;
  outputBuffer?: GPUBuffer | null;
  maxTokensPerExpert?: number;
}

/** MoE gather result */
export interface MoEGatherResult {
  gathered: GPUBuffer;
  tokenCounts: GPUBuffer;
  tokenMap: GPUBuffer;
  maxTokensPerExpert: number;
}

/**
 * Run top-K expert selection
 */
export async function runTopK(
  probs: GPUBuffer,
  numTokens: number,
  numExperts: number,
  topK: number,
  options: MoEOptions = {}
): Promise<{ indices: GPUBuffer; weights: GPUBuffer }> {
  const device = getDevice();
  const { normalize = true } = options;

  const pipeline = await createPipeline('topk', 'default');

  // Output buffers
  const indicesSize = numTokens * topK * 4; // u32
  const weightsSize = numTokens * topK * 4; // f32
  const indices = acquireBuffer(indicesSize, undefined, 'topk_indices');
  const weights = acquireBuffer(weightsSize, undefined, 'topk_weights');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, numExperts, true);
  uniformView.setUint32(8, topK, true);
  uniformView.setUint32(12, normalize ? 1 : 0, true);

  const uniformBuffer = device.createBuffer({
    label: 'topk_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'topk_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: probs } },
      { binding: 2, resource: { buffer: indices } },
      { binding: 3, resource: { buffer: weights } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'topk_encoder' });
  const pass = encoder.beginComputePass({ label: 'topk_pass' });
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
 * Run MoE gather (dispatch tokens to experts)
 * Returns gathered hidden states organized by expert, along with token counts and mapping
 */
export async function runMoEGather(
  hiddenStates: GPUBuffer,
  expertIndices: GPUBuffer,
  numTokens: number,
  hiddenSize: number,
  numExperts: number,
  topK: number,
  options: MoEOptions = {}
): Promise<MoEGatherResult> {
  const device = getDevice();
  const { maxTokensPerExpert = numTokens } = options;

  const pipeline = await createPipeline('moe_gather', 'sparse');

  // Output buffers per WGSL shader:
  // - gathered: [numExperts, maxTokensPerExpert, hiddenSize]
  // - tokenCounts: [numExperts]
  // - tokenMap: [numExperts, maxTokensPerExpert, 2] (tokenIdx, kIdx)
  const gatheredSize = numExperts * maxTokensPerExpert * hiddenSize * 4;
  const tokenCountsSize = numExperts * 4;
  const tokenMapSize = numExperts * maxTokensPerExpert * 2 * 4;

  const gathered = acquireBuffer(gatheredSize, undefined, 'moe_gathered');
  const tokenCounts = acquireBuffer(tokenCountsSize, undefined, 'moe_token_counts');
  const tokenMap = acquireBuffer(tokenMapSize, undefined, 'moe_token_map');

  // Zero-initialize tokenCounts (atomics start at 0)
  const zeroEncoder = device.createCommandEncoder({ label: 'zero_token_counts' });
  zeroEncoder.clearBuffer(tokenCounts);
  device.queue.submit([zeroEncoder.finish()]);

  // Create uniform buffer (20 bytes: numTokens, hiddenSize, numExperts, topK, maxTokensPerExpert)
  const uniformData = new ArrayBuffer(20);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, numExperts, true);
  uniformView.setUint32(12, topK, true);
  uniformView.setUint32(16, maxTokensPerExpert, true);

  const uniformBuffer = device.createBuffer({
    label: 'moe_gather_uniforms',
    size: 20,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group matching WGSL bindings
  const bindGroup = device.createBindGroup({
    label: 'moe_gather_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: hiddenStates } },
      { binding: 2, resource: { buffer: expertIndices } },
      { binding: 3, resource: { buffer: gathered } },
      { binding: 4, resource: { buffer: tokenCounts } },
      { binding: 5, resource: { buffer: tokenMap } },
    ],
  });

  // Dispatch: one thread per token * topK assignment
  const encoder = device.createCommandEncoder({ label: 'moe_gather_encoder' });
  const pass = encoder.beginComputePass({ label: 'moe_gather_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * topK) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  setBufferDtype(gathered, 'f32');
  setBufferDtype(tokenCounts, 'u32');
  setBufferDtype(tokenMap, 'u32');

  return { gathered, tokenCounts, tokenMap, maxTokensPerExpert };
}

/**
 * Run scatter-add (collect expert outputs back to tokens)
 */
export async function runScatterAdd(
  expertOutputs: GPUBuffer,
  indices: GPUBuffer,
  weights: GPUBuffer,
  numTokens: number,
  hiddenSize: number,
  numExperts: number,
  topK: number,
  options: MoEOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('scatter_add', 'default');

  // Output: [numTokens, hiddenSize]
  const outputSize = numTokens * hiddenSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'scatter_add_output');

  // Zero initialize output buffer
  const zeroEncoder = device.createCommandEncoder({ label: 'zero_init_encoder' });
  zeroEncoder.clearBuffer(output);
  device.queue.submit([zeroEncoder.finish()]);

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, numExperts, true);
  uniformView.setUint32(12, topK, true);

  const uniformBuffer = device.createBuffer({
    label: 'scatter_add_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'scatter_add_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: expertOutputs } },
      { binding: 2, resource: { buffer: indices } },
      { binding: 3, resource: { buffer: weights } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'scatter_add_encoder' });
  const pass = encoder.beginComputePass({ label: 'scatter_add_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * topK * hiddenSize) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run dynamic scatter-add with token offsets
 */
export async function runScatterAddDynamic(
  expertOutputs: GPUBuffer,
  indices: GPUBuffer,
  weights: GPUBuffer,
  tokenOffsets: GPUBuffer,
  numTokens: number,
  hiddenSize: number,
  topK: number,
  options: MoEOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('scatter_add', 'dynamic');

  // Output: [numTokens, hiddenSize]
  const outputSize = numTokens * hiddenSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'scatter_add_dynamic_output');

  // Zero initialize output buffer
  const zeroEncoder = device.createCommandEncoder({ label: 'zero_init_encoder' });
  zeroEncoder.clearBuffer(output);
  device.queue.submit([zeroEncoder.finish()]);

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, topK, true);

  const uniformBuffer = device.createBuffer({
    label: 'scatter_add_dynamic_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'scatter_add_dynamic_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: expertOutputs } },
      { binding: 2, resource: { buffer: indices } },
      { binding: 3, resource: { buffer: weights } },
      { binding: 4, resource: { buffer: tokenOffsets } },
      { binding: 5, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'scatter_add_dynamic_encoder' });
  const pass = encoder.beginComputePass({ label: 'scatter_add_dynamic_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * topK * hiddenSize) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}
