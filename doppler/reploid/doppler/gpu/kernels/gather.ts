/**
 * Gather (Embedding Lookup) Kernels
 *
 * Provides token embedding lookups from embedding tables.
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** Gather kernel options */
export interface GatherOptions {
  useVec4?: boolean;
  outputBuffer?: GPUBuffer | null;
}

/**
 * Run gather/embedding lookup
 */
export async function runGather(
  indices: GPUBuffer,
  embeddings: GPUBuffer,
  numTokens: number,
  hiddenSize: number,
  vocabSize: number,
  options: GatherOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { useVec4 = true, outputBuffer = null } = options;

  const variant = useVec4 ? 'vec4' : 'default';
  const pipeline = await createPipeline('gather', variant);

  const outputSize = numTokens * hiddenSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gather_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, vocabSize, true);

  const uniformBuffer = device.createBuffer({
    label: 'gather_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'gather_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: indices } },
      { binding: 2, resource: { buffer: embeddings } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'gather_encoder' });
  const pass = encoder.beginComputePass({ label: 'gather_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = useVec4 ? Math.ceil((numTokens * hiddenSize) / (64 * 4)) : Math.ceil((numTokens * hiddenSize) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Record gather (batched, no submit)
 */
export async function recordGather(
  recorder: CommandRecorder,
  indices: GPUBuffer,
  embeddings: GPUBuffer,
  numTokens: number,
  hiddenSize: number,
  vocabSize: number,
  options: GatherOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('gather', 'default');

  const outputSize = numTokens * hiddenSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gather_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, vocabSize, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'gather_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'gather_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: indices } },
      { binding: 2, resource: { buffer: embeddings } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('gather');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((numTokens * hiddenSize) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
