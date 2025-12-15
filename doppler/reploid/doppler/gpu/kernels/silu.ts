/**
 * SiLU (Swish) Activation Kernels
 *
 * Provides SiLU activation with variants:
 * - Standard SiLU: x * sigmoid(x)
 * - SiLU with gating (for GLU layers)
 * - SwiGLU with row-split bias
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** SiLU kernel options */
export interface SiLUOptions {
  size?: number | null;
  gate?: GPUBuffer | null;
  outputBuffer?: GPUBuffer | null;
  useVec4?: boolean;
  biasOffset?: number;
}

/**
 * Run SiLU activation
 */
export async function runSiLU(
  input: GPUBuffer,
  options: SiLUOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { size, gate = null, outputBuffer = null, useVec4 = false } = options;

  const variant = useVec4 ? 'vec4' : 'default';
  const pipeline = await createPipeline('silu', variant);

  const inferredSize = size || (input.size / 4);
  const outputSize = inferredSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'silu_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSize, true);

  const uniformBuffer = device.createBuffer({
    label: 'silu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const gateBuffer = gate || input; // Use input as dummy if no gate
  const bindGroup = device.createBindGroup({
    label: 'silu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: gateBuffer } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'silu_encoder' });
  const pass = encoder.beginComputePass({ label: 'silu_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(inferredSize / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run SwiGLU with row-split bias
 */
export async function runSwiGLURowsplitBias(
  input: GPUBuffer,
  bias: GPUBuffer,
  numTokens: number,
  dim: number,
  options: SiLUOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { outputBuffer = null, biasOffset = 0 } = options;

  const pipeline = await createPipeline('swiglu', 'rowsplit_bias');

  const outputSize = numTokens * dim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'swiglu_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, dim, true);
  uniformView.setUint32(8, biasOffset, true);

  const uniformBuffer = device.createBuffer({
    label: 'swiglu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'swiglu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: bias } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'swiglu_encoder' });
  const pass = encoder.beginComputePass({ label: 'swiglu_pass' });
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
 * Record SiLU (batched, no submit)
 */
export async function recordSiLU(
  recorder: CommandRecorder,
  input: GPUBuffer,
  options: SiLUOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const { size, outputBuffer = null } = options;

  const pipeline = await createPipeline('silu', 'default');

  const inferredSize = size || (input.size / 4);
  const outputSize = inferredSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'silu_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSize, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'silu_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'silu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('silu');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(inferredSize / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
