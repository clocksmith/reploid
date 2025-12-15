/**
 * RoPE (Rotary Position Embedding) Kernels
 *
 * Provides rotary position embedding with multiple variants:
 * - Standard RoPE
 * - NTK-scaled RoPE
 * - YaRN (Yet another RoPE extensioN)
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { createPipeline } from './utils.js';

/** RoPE kernel options */
export interface RoPEOptions {
  numHeads?: number;
  headDim?: number;
  ropeTheta?: number;
  outputBuffer?: GPUBuffer | null;
  startPos?: number;
}

/**
 * Run RoPE operation
 */
export async function runRoPE(
  input: GPUBuffer,
  freqsCos: GPUBuffer,
  freqsSin: GPUBuffer,
  seqLen: number,
  options: RoPEOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const {
    numHeads = 1,
    headDim = 64,
    ropeTheta = 10000.0,
    outputBuffer = null,
  } = options;

  const pipeline = await createPipeline('rope', 'default');

  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'rope_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);
  uniformView.setUint32(4, numHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setFloat32(12, ropeTheta, true);

  const uniformBuffer = device.createBuffer({
    label: 'rope_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'rope_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: freqsCos } },
      { binding: 3, resource: { buffer: freqsSin } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'rope_encoder' });
  const pass = encoder.beginComputePass({ label: 'rope_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((seqLen * numHeads * headDim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Record RoPE (batched, no submit)
 */
export async function recordRoPE(
  recorder: CommandRecorder,
  input: GPUBuffer,
  freqsCos: GPUBuffer,
  freqsSin: GPUBuffer,
  seqLen: number,
  options: RoPEOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    numHeads = 1,
    headDim = 64,
    outputBuffer = null,
  } = options;

  const pipeline = await createPipeline('rope', 'default');

  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'rope_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);
  uniformView.setUint32(4, numHeads, true);
  uniformView.setUint32(8, headDim, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'rope_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'rope_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: freqsCos } },
      { binding: 3, resource: { buffer: freqsSin } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('rope');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil((seqLen * numHeads * headDim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
