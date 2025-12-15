/**
 * Residual Connection Kernels
 *
 * Provides element-wise addition operations for:
 * - Residual connections (add two tensors)
 * - Bias addition
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** Residual kernel options */
export interface ResidualOptions {
  useVec4?: boolean;
  outputBuffer?: GPUBuffer | null;
  dataOffset?: number;
  biasOffset?: number;
}

/**
 * Run residual add (element-wise addition)
 */
export async function runResidualAdd(
  a: GPUBuffer,
  b: GPUBuffer,
  size: number,
  options: ResidualOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { useVec4 = true, outputBuffer = null } = options;

  const variant = useVec4 ? 'vec4' : 'default';
  const pipeline = await createPipeline('residual', variant);

  const outputSize = size * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'residual_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, size, true);

  const uniformBuffer = device.createBuffer({
    label: 'residual_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'residual_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: a } },
      { binding: 2, resource: { buffer: b } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'residual_encoder' });
  const pass = encoder.beginComputePass({ label: 'residual_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = useVec4 ? Math.ceil(size / (64 * 4)) : Math.ceil(size / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run bias add
 */
export async function runBiasAdd(
  data: GPUBuffer,
  bias: GPUBuffer,
  numTokens: number,
  dim: number,
  options: ResidualOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { dataOffset = 0, biasOffset = 0 } = options;

  const pipeline = await createPipeline('bias_add', 'default');

  // Bias add is in-place, no output buffer creation needed
  const output = data;

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, dim, true);
  uniformView.setUint32(8, dataOffset, true);
  uniformView.setUint32(12, biasOffset, true);

  const uniformBuffer = device.createBuffer({
    label: 'bias_add_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'bias_add_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: data } },
      { binding: 2, resource: { buffer: bias } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'bias_add_encoder' });
  const pass = encoder.beginComputePass({ label: 'bias_add_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * dim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Record residual add (batched, no submit)
 */
export async function recordResidualAdd(
  recorder: CommandRecorder,
  a: GPUBuffer,
  b: GPUBuffer,
  size: number,
  options: ResidualOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('residual', 'default');

  const outputSize = size * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'residual_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, size, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'residual_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'residual_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: a } },
      { binding: 2, resource: { buffer: b } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('residual');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(size / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record bias add (batched, no submit)
 */
export async function recordBiasAdd(
  recorder: CommandRecorder,
  data: GPUBuffer,
  bias: GPUBuffer,
  numTokens: number,
  dim: number,
  options: ResidualOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const { dataOffset = 0, biasOffset = 0 } = options;

  const pipeline = await createPipeline('bias_add', 'default');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, dim, true);
  uniformView.setUint32(8, dataOffset, true);
  uniformView.setUint32(12, biasOffset, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'bias_add_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'bias_add_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: data } },
      { binding: 2, resource: { buffer: bias } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('bias_add');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * dim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  return data; // In-place operation
}
