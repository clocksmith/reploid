/**
 * Kernel Selector - Runtime Kernel Selection Based on Device Capabilities
 * AGENT-C: gpu/kernel-selector.js
 *
 * Selects optimal kernel variants based on detected GPU features.
 * Manages shader compilation and caching.
 */

import { getDevice, getKernelCapabilities, FEATURES } from './device.js';

// Kernel source imports (loaded as strings)
import matmulF32Source from './kernels/matmul_f32.wgsl?raw';
import matmulF16Source from './kernels/matmul_f16.wgsl?raw';
import dequantSubgroupSource from './kernels/dequant_subgroup.wgsl?raw';
import dequantSharedSource from './kernels/dequant_shared.wgsl?raw';

// Compiled pipeline cache
const pipelineCache = new Map();

/**
 * Kernel configuration for different operations
 */
const KERNEL_CONFIGS = {
  matmul: {
    f16: {
      source: matmulF16Source,
      entryPoint: 'main',
      workgroupSize: [16, 16, 1],
      requires: ['shader-f16'],
    },
    f16_vec4: {
      source: matmulF16Source,
      entryPoint: 'main_vec4',
      workgroupSize: [16, 16, 1],
      requires: ['shader-f16'],
    },
    f32: {
      source: matmulF32Source,
      entryPoint: 'main',
      workgroupSize: [16, 16, 1],
      requires: [],
    },
  },
  dequant: {
    subgroup: {
      source: dequantSubgroupSource,
      entryPoint: 'main',
      workgroupSize: [64, 1, 1],
      requires: ['subgroups'],
    },
    subgroup_vec4: {
      source: dequantSubgroupSource,
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: ['subgroups'],
    },
    shared: {
      source: dequantSharedSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    shared_vec4: {
      source: dequantSharedSource,
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
  },
};

/**
 * Check if all required features are available
 * @param {string[]} required - Required feature names
 * @param {object} capabilities - Device capabilities
 * @returns {boolean}
 */
function hasRequiredFeatures(required, capabilities) {
  for (const feature of required) {
    if (feature === 'shader-f16' && !capabilities.hasF16) return false;
    if (feature === 'subgroups' && !capabilities.hasSubgroups) return false;
    if (feature === 'subgroups-f16' && !capabilities.hasSubgroupsF16) return false;
  }
  return true;
}

/**
 * Select the best matmul kernel variant
 * @param {object} options - Selection options
 * @returns {string} Kernel variant name
 */
export function selectMatmulKernel(options = {}) {
  const capabilities = getKernelCapabilities();
  const { preferF16 = true, useVec4 = false } = options;

  // Prefer FP16 if available and requested
  if (preferF16 && capabilities.hasF16) {
    return useVec4 ? 'f16_vec4' : 'f16';
  }

  return 'f32';
}

/**
 * Select the best dequantization kernel variant
 * @param {object} options - Selection options
 * @returns {string} Kernel variant name
 */
export function selectDequantKernel(options = {}) {
  const capabilities = getKernelCapabilities();
  const { useVec4 = true } = options;

  // Prefer subgroup if available (faster broadcast)
  if (capabilities.hasSubgroups) {
    return useVec4 ? 'subgroup_vec4' : 'subgroup';
  }

  // Fallback to shared memory
  return useVec4 ? 'shared_vec4' : 'shared';
}

/**
 * Get kernel configuration
 * @param {string} operation - 'matmul' or 'dequant'
 * @param {string} variant - Kernel variant name
 * @returns {object} Kernel config
 */
export function getKernelConfig(operation, variant) {
  const config = KERNEL_CONFIGS[operation]?.[variant];
  if (!config) {
    throw new Error(`Unknown kernel: ${operation}/${variant}`);
  }
  return config;
}

/**
 * Compile a shader module
 * @param {GPUDevice} device
 * @param {string} source - WGSL source code
 * @param {string} label - Debug label
 * @returns {GPUShaderModule}
 */
function compileShader(device, source, label) {
  return device.createShaderModule({
    label,
    code: source,
  });
}

/**
 * Create a compute pipeline for a kernel
 * @param {string} operation - Operation type
 * @param {string} variant - Kernel variant
 * @param {GPUBindGroupLayout} bindGroupLayout - Optional custom layout
 * @returns {Promise<GPUComputePipeline>}
 */
export async function createPipeline(operation, variant, bindGroupLayout = null) {
  const cacheKey = `${operation}:${variant}`;

  // Return cached pipeline if available
  if (pipelineCache.has(cacheKey)) {
    return pipelineCache.get(cacheKey);
  }

  const device = getDevice();
  if (!device) {
    throw new Error('Device not initialized');
  }

  const config = getKernelConfig(operation, variant);
  const capabilities = getKernelCapabilities();

  // Verify requirements
  if (!hasRequiredFeatures(config.requires, capabilities)) {
    throw new Error(
      `Kernel ${operation}/${variant} requires features: ${config.requires.join(', ')}`
    );
  }

  // Compile shader
  const shaderModule = compileShader(device, config.source, `${operation}_${variant}`);

  // Create pipeline
  const pipelineDescriptor = {
    label: `${operation}_${variant}_pipeline`,
    layout: bindGroupLayout ? device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }) : 'auto',
    compute: {
      module: shaderModule,
      entryPoint: config.entryPoint,
    },
  };

  const pipeline = await device.createComputePipelineAsync(pipelineDescriptor);
  pipelineCache.set(cacheKey, pipeline);

  return pipeline;
}

/**
 * Create bind group layout for matmul operation
 * @returns {GPUBindGroupLayout}
 */
export function createMatmulBindGroupLayout() {
  const device = getDevice();
  return device.createBindGroupLayout({
    label: 'matmul_bind_group_layout',
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
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
    ],
  });
}

/**
 * Create bind group layout for dequant operation
 * @returns {GPUBindGroupLayout}
 */
export function createDequantBindGroupLayout() {
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
 * Run matrix multiplication
 * @param {GPUBuffer} A - Input matrix A [M x K]
 * @param {GPUBuffer} B - Input matrix B [K x N]
 * @param {number} M - Rows in A
 * @param {number} N - Cols in B
 * @param {number} K - Shared dimension
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Result matrix C [M x N]
 */
export async function runMatmul(A, B, M, N, K, options = {}) {
  const device = getDevice();
  const { alpha = 1.0, outputBuffer = null } = options;

  // Select kernel
  const variant = selectMatmulKernel(options);
  const config = getKernelConfig('matmul', variant);
  const pipeline = await createPipeline('matmul', variant);

  // Determine element size based on kernel
  const isF16 = variant.includes('f16');
  const elementSize = isF16 ? 2 : 4;

  // Create output buffer if not provided
  const C = outputBuffer || device.createBuffer({
    label: 'matmul_output',
    size: M * N * elementSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, M, true);
  uniformView.setUint32(4, N, true);
  uniformView.setUint32(8, K, true);
  uniformView.setFloat32(12, alpha, true);

  const uniformBuffer = device.createBuffer({
    label: 'matmul_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'matmul_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: A } },
      { binding: 2, resource: { buffer: B } },
      { binding: 3, resource: { buffer: C } },
    ],
  });

  // Dispatch compute
  const encoder = device.createCommandEncoder({ label: 'matmul_encoder' });
  const pass = encoder.beginComputePass({ label: 'matmul_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const [wgX, wgY] = config.workgroupSize;
  const workgroupsX = Math.ceil(M / wgX);
  const workgroupsY = Math.ceil(N / wgY);
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();

  device.queue.submit([encoder.finish()]);

  // Clean up temporary buffers
  uniformBuffer.destroy();

  return C;
}

/**
 * Run dequantization
 * @param {GPUBuffer} quantized - Quantized weight buffer
 * @param {number} numBlocks - Number of Q4_K_M blocks
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Dequantized output buffer
 */
export async function dequantize(quantized, numBlocks, options = {}) {
  const device = getDevice();
  const { outputOffset = 0, outputBuffer = null } = options;

  // Select kernel
  const variant = selectDequantKernel(options);
  const config = getKernelConfig('dequant', variant);
  const pipeline = await createPipeline('dequant', variant);

  // Q4_K_M: 256 elements per block, f32 output
  const QK_K = 256;
  const outputSize = numBlocks * QK_K * 4;

  // Create output buffer if not provided
  const output = outputBuffer || device.createBuffer({
    label: 'dequant_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

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
  let workgroups;
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

  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Clear the pipeline cache
 */
export function clearPipelineCache() {
  pipelineCache.clear();
}

/**
 * Get cache statistics
 * @returns {object}
 */
export function getCacheStats() {
  return {
    pipelineCount: pipelineCache.size,
    cachedKernels: [...pipelineCache.keys()],
  };
}
