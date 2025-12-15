/**
 * Dequantization Kernels
 *
 * Provides dequantization operations for:
 * - Q4_K_M quantization (GGUF format)
 * - MXFP4 quantization (GPT-OSS format)
 * - F16/F32 output support
 * - Subgroup and shared memory variants
 */

import { getDevice, getKernelCapabilities } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { getKernelConfig, createPipeline } from './utils.js';

/** Dequantization kernel options */
export interface DequantOptions {
  outputOffset?: number;
  outputBuffer?: GPUBuffer | null;
  outputDtype?: 'f16' | 'f32';
  useVec4?: boolean;
  groupSize?: number;
}

/**
 * Select the best dequantization kernel variant
 */
export function selectDequantKernel(options: DequantOptions = {}): string {
  const capabilities = getKernelCapabilities();
  const { useVec4 = true, outputDtype = 'f32' } = options;

  const wantsF16Out = outputDtype === 'f16' && capabilities.hasF16;

  if (capabilities.hasSubgroups) {
    if (wantsF16Out) {
      return useVec4 ? 'subgroup_vec4_f16out' : 'subgroup_f16out';
    }
    return useVec4 ? 'subgroup_vec4' : 'subgroup';
  }

  if (wantsF16Out) {
    return useVec4 ? 'shared_vec4_f16out' : 'shared_f16out';
  }

  return useVec4 ? 'shared_vec4' : 'shared';
}

/**
 * Create bind group layout for dequant operation
 */
export function createDequantBindGroupLayout(): GPUBindGroupLayout {
  const device = getDevice();
  return device.createBindGroupLayout({
    label: 'dequant_bind_group_layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
    ],
  });
}

/**
 * Run Q4_K_M dequantization
 */
export async function dequantize(
  quantized: GPUBuffer,
  numBlocks: number,
  options: DequantOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const {
    outputOffset = 0,
    outputBuffer = null,
    outputDtype = 'f32',
  } = options;

  // Select kernel
  const variant = selectDequantKernel({ ...options, outputDtype });
  const config = getKernelConfig('dequant', variant);
  const pipeline = await createPipeline('dequant', variant);

  // Q4_K_M: 256 elements per block
  const QK_K = 256;
  const bytesPerElem = outputDtype === 'f16' ? 2 : 4;
  const outputSize = numBlocks * QK_K * bytesPerElem;

  // Create output buffer if not provided
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'dequant_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numBlocks, true);
  uniformView.setUint32(4, outputOffset, true);
  uniformView.setUint32(8, 0, true); // padding
  uniformView.setUint32(12, 0, true); // padding

  const uniformBuffer = device.createBuffer({
    label: 'dequant_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'dequant_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: quantized } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'dequant_encoder' });
  const pass = encoder.beginComputePass({ label: 'dequant_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  // Calculate workgroups based on kernel variant
  let workgroups: number;
  if (variant.includes('vec4')) {
    // vec4 variants: 64 threads per block
    workgroups = numBlocks;
  } else if (variant.includes('shared')) {
    // shared main: 256 threads per block (1 block per workgroup)
    workgroups = numBlocks;
  } else {
    // subgroup main: 64 threads processing QK_K elements
    workgroups = Math.ceil((numBlocks * QK_K) / 64);
  }

  // WebGPU limit: max 65535 workgroups per dimension
  // Use 2D dispatch for large tensors (shader supports via num_workgroups builtin)
  const MAX_WORKGROUPS = 65535;
  if (workgroups <= MAX_WORKGROUPS) {
    pass.dispatchWorkgroups(workgroups);
  } else {
    // Split into 2D dispatch
    const wgY = Math.ceil(workgroups / MAX_WORKGROUPS);
    const wgX = Math.min(workgroups, MAX_WORKGROUPS);
    pass.dispatchWorkgroups(wgX, wgY);
  }
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  setBufferDtype(output, outputDtype === 'f16' ? 'f16' : 'f32');

  return output;
}

/**
 * Dequantize MXFP4 weights (GPT-OSS format)
 */
export async function dequantizeMXFP4(
  blocks: GPUBuffer,
  scales: GPUBuffer,
  totalElements: number,
  numGroups: number,
  options: DequantOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const {
    outputBuffer = null,
    groupSize = 32,  // 32 elements per group (16 bytes * 2 nibbles)
  } = options;

  const pipeline = await createPipeline('dequant', 'mxfp4');

  const outputSize = totalElements * 4; // F32 output
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'mxfp4_dequant_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, totalElements, true);
  uniformView.setUint32(4, numGroups, true);
  uniformView.setUint32(8, groupSize, true);
  uniformView.setUint32(12, numGroups * groupSize, true); // row_stride

  const uniformBuffer = device.createBuffer({
    label: 'mxfp4_dequant_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'mxfp4_dequant_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: blocks } },
      { binding: 2, resource: { buffer: scales } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'mxfp4_dequant_encoder' });
  const pass = encoder.beginComputePass({ label: 'mxfp4_dequant_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(totalElements / 256);
  pass.dispatchWorkgroups(Math.min(workgroups, 65535), Math.ceil(workgroups / 65535) || 1);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  setBufferDtype(output, 'f32');

  return output;
}

/**
 * Dequantize MXFP4 expert weights (extracts single expert from packed tensor)
 */
export async function dequantizeMXFP4Expert(
  blocks: GPUBuffer,
  scales: GPUBuffer,
  expertIdx: number,
  numExperts: number,
  outDim: number,
  numGroups: number,
  options: DequantOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('dequant', 'mxfp4_expert');

  // Output is [out_dim, num_groups * 32] as F32
  const totalOutput = outDim * numGroups * 32;
  const outputSize = totalOutput * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'mxfp4_expert_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, expertIdx, true);
  uniformView.setUint32(4, numExperts, true);
  uniformView.setUint32(8, outDim, true);
  uniformView.setUint32(12, numGroups, true);
  uniformView.setUint32(16, totalOutput, true);

  const uniformBuffer = device.createBuffer({
    label: 'mxfp4_expert_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'mxfp4_expert_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: blocks } },
      { binding: 2, resource: { buffer: scales } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'mxfp4_expert_encoder' });
  const pass = encoder.beginComputePass({ label: 'mxfp4_expert_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(totalOutput / 256);
  pass.dispatchWorkgroups(Math.min(workgroups, 65535), Math.ceil(workgroups / 65535) || 1);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  setBufferDtype(output, 'f32');

  return output;
}

/**
 * Record Q4_K_M dequantization (batched, no submit)
 */
export async function recordDequantize(
  recorder: CommandRecorder,
  quantized: GPUBuffer,
  numBlocks: number,
  options: DequantOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    outputOffset = 0,
    outputBuffer = null,
    outputDtype = 'f32',
  } = options;

  // Select kernel
  const variant = selectDequantKernel({ ...options, outputDtype });
  const config = getKernelConfig('dequant', variant);
  const pipeline = await createPipeline('dequant', variant);

  // Q4_K: 256 elements per block
  const QK_K = 256;
  const bytesPerElem = outputDtype === 'f16' ? 2 : 4;
  const outputSize = numBlocks * QK_K * bytesPerElem;

  // Output buffer
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'dequant_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numBlocks, true);
  uniformView.setUint32(4, outputOffset, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'dequant_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'dequant_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: quantized } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('dequant');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  // Calculate workgroups
  let workgroups: number;
  if (variant.includes('vec4')) {
    workgroups = numBlocks;
  } else if (variant.includes('shared')) {
    workgroups = numBlocks;
  } else {
    workgroups = Math.ceil((numBlocks * QK_K) / 64);
  }

  const MAX_WORKGROUPS = 65535;
  if (workgroups <= MAX_WORKGROUPS) {
    pass.dispatchWorkgroups(workgroups);
  } else {
    const wgY = Math.ceil(workgroups / MAX_WORKGROUPS);
    const wgX = Math.min(workgroups, MAX_WORKGROUPS);
    pass.dispatchWorkgroups(wgX, wgY);
  }
  pass.end();

  setBufferDtype(output, outputDtype === 'f16' ? 'f16' : 'f32');
  return output;
}
