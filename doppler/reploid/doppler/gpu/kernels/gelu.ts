/**
 * GeLU Activation Kernels
 *
 * Provides GeLU activation: x * Phi(x) where Phi is the CDF of standard normal distribution.
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** GeLU kernel options */
export interface GeLUOptions {
  size?: number | null;
  gate?: GPUBuffer | null;
  outputBuffer?: GPUBuffer | null;
}

/**
 * Run GeLU activation
 */
export async function runGeLU(
  input: GPUBuffer,
  options: GeLUOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { size, gate = null, outputBuffer = null } = options;

  // Select gated variant when gate buffer is provided
  const variant = gate ? 'geglu' : 'gelu';
  const pipeline = await createPipeline('silu', variant);

  const inferredSize = size || (input.size / 4);
  const outputSize = inferredSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gelu_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSize, true);

  const uniformBuffer = device.createBuffer({
    label: 'gelu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  // WGSL bindings: 0=uniforms, 1=input, 2=output, 3=gate, 4=bias
  const gateBuffer = gate || input;
  const bindGroup = device.createBindGroup({
    label: 'gelu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
      { binding: 3, resource: { buffer: gateBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'gelu_encoder' });
  const pass = encoder.beginComputePass({ label: 'gelu_pass' });
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
 * Record GeLU (batched, no submit)
 * Supports gated variant (GeGLU) when options.gate is provided.
 */
export async function recordGeLU(
  recorder: CommandRecorder,
  input: GPUBuffer,
  options: GeLUOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const { size, gate = null, outputBuffer = null } = options;

  // Select gated variant when gate buffer is provided
  const variant = gate ? 'geglu' : 'gelu';
  const pipeline = await createPipeline('silu', variant);

  const inferredSize = size || (input.size / 4);
  const outputSize = inferredSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gelu_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredSize, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'gelu_uniforms');

  // Bind group entries - gate variant needs binding 3
  const gateBuffer = gate || input; // Use input as dummy if no gate
  const entries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: input } },
    { binding: 2, resource: { buffer: output } },
  ];

  // Add gate binding for gated variant
  if (gate) {
    entries.push({ binding: 3, resource: { buffer: gateBuffer } });
  }

  const bindGroup = device.createBindGroup({
    label: 'gelu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });

  // Record pass
  const pass = recorder.beginComputePass('gelu');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(inferredSize / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
