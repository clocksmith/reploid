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
  } = options;

  const pipeline = await createPipeline('rope', 'default');

  // Note: RoPE shader modifies input in-place (no output buffer)

  // Create uniform buffer (32 bytes to match WGSL struct)
  // struct RoPEUniforms { seqLen, numHeads, headDim, startPos, ropeBase, ropeScale, _pad0, _pad1 }
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);          // seqLen
  uniformView.setUint32(4, numHeads, true);        // numHeads
  uniformView.setUint32(8, headDim, true);         // headDim
  uniformView.setUint32(12, options.startPos || 0, true);  // startPos
  uniformView.setFloat32(16, ropeTheta, true);     // ropeBase
  uniformView.setFloat32(20, 1.0, true);           // ropeScale (default 1.0)
  // _pad0 and _pad1 at bytes 24-31 are already 0

  const uniformBuffer = device.createBuffer({
    label: 'rope_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group (only 4 bindings - shader modifies input in-place)
  const bindGroup = device.createBindGroup({
    label: 'rope_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: freqsCos } },
      { binding: 3, resource: { buffer: freqsSin } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'rope_encoder' });
  const pass = encoder.beginComputePass({ label: 'rope_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  if (headDim % 2 !== 0) {
    throw new Error(`RoPE headDim must be even, got ${headDim}`);
  }
  const halfDim = headDim / 2;
  const workgroups = Math.ceil((seqLen * numHeads * halfDim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  // Return input buffer (modified in-place by shader)
  return input;
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
  } = options;

  const pipeline = await createPipeline('rope', 'default');

  // Note: RoPE shader modifies input in-place (no output buffer)

  // Uniform buffer (32 bytes to match WGSL struct)
  // struct RoPEUniforms { seqLen, numHeads, headDim, startPos, ropeBase, ropeScale, _pad0, _pad1 }
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);          // seqLen
  uniformView.setUint32(4, numHeads, true);        // numHeads
  uniformView.setUint32(8, headDim, true);         // headDim
  uniformView.setUint32(12, options.startPos || 0, true);  // startPos
  uniformView.setFloat32(16, 10000.0, true);       // ropeBase (default)
  uniformView.setFloat32(20, 1.0, true);           // ropeScale (default 1.0)
  // _pad0 and _pad1 at bytes 24-31 are already 0

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'rope_uniforms');

  // Bind group (only 4 bindings - shader modifies input in-place)
  const bindGroup = device.createBindGroup({
    label: 'rope_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: freqsCos } },
      { binding: 3, resource: { buffer: freqsSin } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('rope');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  if (headDim % 2 !== 0) {
    throw new Error(`RoPE headDim must be even, got ${headDim}`);
  }
  const halfDim = headDim / 2;
  const workgroups = Math.ceil((seqLen * numHeads * halfDim) / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  setBufferDtype(input, 'f32');
  // Return input buffer (modified in-place by shader)
  return input;
}
