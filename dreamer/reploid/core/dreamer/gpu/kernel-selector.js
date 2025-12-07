/**
 * Kernel Selector - Runtime Kernel Selection Based on Device Capabilities
 * AGENT-C: gpu/kernel-selector.js
 *
 * Selects optimal kernel variants based on detected GPU features.
 * Manages shader compilation and caching.
 *
 * Phase 2: Added attention, rmsnorm, softmax, rope, silu kernels.
 */

import { getDevice, getKernelCapabilities, FEATURES } from './device.js';
import { getKernelTuner } from './kernel-tuner.js';

// Kernel source imports (loaded as strings)
// Phase 1 kernels
import matmulF32Source from './kernels/matmul_f32.wgsl?raw';
import matmulF16Source from './kernels/matmul_f16.wgsl?raw';
import dequantSubgroupSource from './kernels/dequant_subgroup.wgsl?raw';
import dequantSharedSource from './kernels/dequant_shared.wgsl?raw';

// Phase 2 kernels
import attentionSource from './kernels/attention.wgsl?raw';
import rmsnormSource from './kernels/rmsnorm.wgsl?raw';
import softmaxSource from './kernels/softmax.wgsl?raw';
import ropeSource from './kernels/rope.wgsl?raw';
import siluSource from './kernels/silu.wgsl?raw';
import gatherSource from './kernels/gather.wgsl?raw';
import residualSource from './kernels/residual.wgsl?raw';

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
  attention: {
    prefill: {
      source: attentionSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
      // TODO: respect device limits for headDim/seqLen
    },
    decode: {
      source: attentionSource,
      entryPoint: 'attention_decode',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  rmsnorm: {
    default: {
      source: rmsnormSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    small: {
      source: rmsnormSource,
      entryPoint: 'rmsnorm_small',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    residual: {
      source: rmsnormSource,
      entryPoint: 'rmsnorm_inplace_residual',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  softmax: {
    default: {
      source: softmaxSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    small: {
      source: softmaxSource,
      entryPoint: 'softmax_small',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    online: {
      source: softmaxSource,
      entryPoint: 'softmax_online',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  rope: {
    default: {
      source: ropeSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    compute_freqs: {
      source: ropeSource,
      entryPoint: 'rope_compute_freqs',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    qk: {
      source: ropeSource,
      entryPoint: 'rope_qk',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    ntk: {
      source: ropeSource,
      entryPoint: 'rope_ntk_scaled',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    yarn: {
      source: ropeSource,
      entryPoint: 'rope_yarn',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  silu: {
    default: {
      source: siluSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gate: {
      source: siluSource,
      entryPoint: 'silu_gate',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gate_split: {
      source: siluSource,
      entryPoint: 'silu_gate_split',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      source: siluSource,
      entryPoint: 'silu_vec4',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gelu: {
      source: siluSource,
      entryPoint: 'gelu',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  gather: {
    default: {
      source: gatherSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      source: gatherSource,
      entryPoint: 'gather_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
  },
  residual: {
    default: {
      source: residualSource,
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      source: residualSource,
      entryPoint: 'add_vec4',
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
 * Run gather (embedding lookup)
 * @param {GPUBuffer} indices - Token indices buffer [numTokens] (u32)
 * @param {GPUBuffer} embeddings - Embedding matrix buffer [vocabSize, hiddenSize]
 * @param {number} numTokens - Number of tokens to gather
 * @param {number} hiddenSize - Embedding dimension
 * @param {number} vocabSize - Vocabulary size
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Gathered embeddings [numTokens, hiddenSize]
 */
export async function runGather(indices, embeddings, numTokens, hiddenSize, vocabSize, options = {}) {
  const device = getDevice();
  const { useVec4 = true, outputBuffer = null } = options;

  // Select variant
  const variant = useVec4 && (hiddenSize % 4 === 0) ? 'vec4' : 'default';
  const config = getKernelConfig('gather', variant);
  const pipeline = await createPipeline('gather', variant);

  // Create output buffer if not provided
  const outputSize = numTokens * hiddenSize * 4;
  const output = outputBuffer || device.createBuffer({
    label: 'gather_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, vocabSize, true);
  uniformView.setUint32(12, 0, true); // padding

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

  let workgroups;
  if (variant === 'vec4') {
    const vec4Count = numTokens * (hiddenSize / 4);
    workgroups = Math.ceil(vec4Count / 64);
  } else {
    const totalElements = numTokens * hiddenSize;
    workgroups = Math.ceil(totalElements / 256);
  }

  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run residual add: output = a + b
 * @param {GPUBuffer} a - First input buffer
 * @param {GPUBuffer} b - Second input buffer
 * @param {number} size - Number of elements
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Output buffer with sum
 */
export async function runResidualAdd(a, b, size, options = {}) {
  const device = getDevice();
  const { useVec4 = true, outputBuffer = null } = options;

  // Select variant
  const variant = useVec4 && (size % 4 === 0) ? 'vec4' : 'default';
  const pipeline = await createPipeline('residual', variant);

  // Create output buffer if not provided
  const output = outputBuffer || device.createBuffer({
    label: 'residual_output',
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

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

  const workgroups = variant === 'vec4'
    ? Math.ceil(size / 4 / 64)
    : Math.ceil(size / 256);

  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Get tuned workgroup size for a kernel
 * @param {string} operation - Operation type (matmul, attention, etc.)
 * @param {Object} inputSizes - Dimensions relevant to the operation
 * @returns {Promise<number[]>} Optimal [x, y, z] workgroup size
 */
export async function getTunedWorkgroupSize(operation, inputSizes = {}) {
  try {
    const tuner = await getKernelTuner();
    const result = tuner.getCachedResult(operation, inputSizes);

    if (result) {
      return result.optimalWorkgroupSize;
    }

    // Run tuning if not cached
    const tuneResult = await tuner.tuneKernel(operation, inputSizes);
    return tuneResult.optimalWorkgroupSize;
  } catch (e) {
    console.warn(`[KernelSelector] Tuning failed for ${operation}, using defaults:`, e.message);
    // Return defaults based on operation
    switch (operation) {
      case 'matmul':
        return [16, 16, 1];
      case 'attention':
      case 'rmsnorm':
      case 'softmax':
        return [256, 1, 1];
      case 'dequant':
        return [64, 1, 1];
      default:
        return [256, 1, 1];
    }
  }
}

/**
 * Run auto-tuning for all kernels with given sizes
 * @param {Object} modelConfig - Model configuration with dimensions
 * @returns {Promise<Object>} Tuning results for all kernels
 */
export async function autoTuneKernels(modelConfig = {}) {
  const {
    hiddenSize = 4096,
    intermediateSize = 14336,
    numHeads = 32,
    headDim = 128,
    maxSeqLen = 4096,
    vocabSize = 32000,
  } = modelConfig;

  const tuner = await getKernelTuner();
  const results = {};

  // Tune matmul for common sizes
  results.matmul_hidden = await tuner.tuneKernel('matmul', {
    M: 1, N: hiddenSize, K: hiddenSize,
  });
  results.matmul_ffn = await tuner.tuneKernel('matmul', {
    M: 1, N: intermediateSize, K: hiddenSize,
  });

  // Tune attention
  results.attention = await tuner.tuneKernel('attention', {
    seqLen: 1, numHeads, headDim,
  });

  // Tune softmax (LM head output)
  results.softmax = await tuner.tuneKernel('softmax', {
    innerSize: vocabSize, outerSize: 1,
  });

  // Tune RMSNorm
  results.rmsnorm = await tuner.tuneKernel('rmsnorm', {
    hiddenSize, numTokens: 1,
  });

  // Tune dequant
  results.dequant = await tuner.tuneKernel('dequant', {
    numBlocks: 1000,
  });

  console.log('[KernelSelector] Auto-tuning complete:', results);
  return results;
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

/**
 * Run multi-head attention
 * @param {GPUBuffer} Q - Query tensor [seqLen, numHeads, headDim]
 * @param {GPUBuffer} K - Key tensor [kvLen, numKVHeads, headDim]
 * @param {GPUBuffer} V - Value tensor [kvLen, numKVHeads, headDim]
 * @param {GPUBuffer|null} mask - Optional attention mask [seqLen, kvLen]
 * @param {number} numHeads - Number of query heads
 * @param {number} headDim - Dimension per head
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Output tensor [seqLen, numHeads, headDim]
 */
export async function runAttention(Q, K, V, mask, numHeads, headDim, options = {}) {
  const device = getDevice();
  const {
    seqLen = 1,
    kvLen = seqLen,
    numKVHeads = numHeads,
    scale = 1.0 / Math.sqrt(headDim),
    causal = true,
    outputBuffer = null,
  } = options;

  // Select variant based on seqLen
  const variant = seqLen === 1 ? 'decode' : 'prefill';
  const config = getKernelConfig('attention', variant);
  const pipeline = await createPipeline('attention', variant);

  // Create output buffer if not provided
  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || device.createBuffer({
    label: 'attention_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);
  uniformView.setUint32(4, kvLen, true);
  uniformView.setUint32(8, numHeads, true);
  uniformView.setUint32(12, numKVHeads, true);
  uniformView.setUint32(16, headDim, true);
  uniformView.setFloat32(20, scale, true);
  uniformView.setUint32(24, causal ? 1 : 0, true);
  uniformView.setUint32(28, mask ? 1 : 0, true);

  const uniformBuffer = device.createBuffer({
    label: 'attention_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create dummy mask if not provided
  const maskBuffer = mask || device.createBuffer({
    label: 'attention_dummy_mask',
    size: 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'attention_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: Q } },
      { binding: 2, resource: { buffer: K } },
      { binding: 3, resource: { buffer: V } },
      { binding: 4, resource: { buffer: output } },
      { binding: 5, resource: { buffer: maskBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'attention_encoder' });
  const pass = encoder.beginComputePass({ label: 'attention_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = seqLen * numHeads;
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  if (!mask) maskBuffer.destroy();

  return output;
}

/**
 * Run RMSNorm
 * @param {GPUBuffer} input - Input tensor [batchSize, hiddenSize]
 * @param {GPUBuffer} weight - Weight tensor [hiddenSize]
 * @param {number} eps - Epsilon for numerical stability
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Normalized output
 */
export async function runRMSNorm(input, weight, eps = 1e-5, options = {}) {
  const device = getDevice();
  const { batchSize = 1, hiddenSize, residual = null, outputBuffer = null } = options;

  // Select variant
  let variant = 'default';
  if (residual) {
    variant = 'residual';
  } else if (hiddenSize <= 256) {
    variant = 'small';
  }

  const config = getKernelConfig('rmsnorm', variant);
  const pipeline = await createPipeline('rmsnorm', variant);

  // Create output buffer if not provided
  const outputSize = batchSize * hiddenSize * 4;
  const output = outputBuffer || device.createBuffer({
    label: 'rmsnorm_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, batchSize, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setFloat32(8, eps, true);
  uniformView.setUint32(12, 0, true); // padding

  const uniformBuffer = device.createBuffer({
    label: 'rmsnorm_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create dummy residual if not provided
  const residualBuffer = residual || device.createBuffer({
    label: 'rmsnorm_dummy_residual',
    size: 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'rmsnorm_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight } },
      { binding: 3, resource: { buffer: output } },
      { binding: 4, resource: { buffer: residualBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'rmsnorm_encoder' });
  const pass = encoder.beginComputePass({ label: 'rmsnorm_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  pass.dispatchWorkgroups(batchSize);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  if (!residual) residualBuffer.destroy();

  return output;
}

/**
 * Run Softmax
 * @param {GPUBuffer} input - Input tensor
 * @param {number} axis - Axis to compute softmax over (typically last dimension)
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Softmax output
 */
export async function runSoftmax(input, axis, options = {}) {
  const device = getDevice();
  const { batchSize = 1, size, temperature = 1.0, outputBuffer = null } = options;

  // Select variant
  let variant = 'default';
  if (size <= 256) {
    variant = 'small';
  } else if (size > 1024) {
    variant = 'online';
  }

  const config = getKernelConfig('softmax', variant);
  const pipeline = await createPipeline('softmax', variant);

  // Create output buffer if not provided
  const outputSize = batchSize * size * 4;
  const output = outputBuffer || device.createBuffer({
    label: 'softmax_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, batchSize, true);
  uniformView.setUint32(4, size, true);
  uniformView.setFloat32(8, temperature, true);
  uniformView.setUint32(12, 0, true); // padding

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
 * Run Rotary Position Embeddings (RoPE)
 * @param {GPUBuffer} input - Input tensor [seqLen, numHeads, headDim]
 * @param {GPUBuffer} freqsCos - Precomputed cos frequencies
 * @param {GPUBuffer} freqsSin - Precomputed sin frequencies
 * @param {number} seqLen - Sequence length
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Input buffer with RoPE applied in-place
 */
export async function runRoPE(input, freqsCos, freqsSin, seqLen, options = {}) {
  const device = getDevice();
  const {
    numHeads,
    headDim,
    startPos = 0,
    ropeBase = 10000.0,
    ropeScale = 1.0,
    variant = 'default',
  } = options;

  const config = getKernelConfig('rope', variant);
  const pipeline = await createPipeline('rope', variant);

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);
  uniformView.setUint32(4, numHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, startPos, true);
  uniformView.setFloat32(16, ropeBase, true);
  uniformView.setFloat32(20, ropeScale, true);
  uniformView.setUint32(24, 0, true); // padding
  uniformView.setUint32(28, 0, true); // padding

  const uniformBuffer = device.createBuffer({
    label: 'rope_uniforms',
    size: 32,
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
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'rope_encoder' });
  const pass = encoder.beginComputePass({ label: 'rope_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const totalElements = seqLen * numHeads * headDim;
  const workgroups = Math.ceil(totalElements / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return input; // RoPE is applied in-place
}

/**
 * Run SiLU activation
 * @param {GPUBuffer} input - Input tensor
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Activated output
 */
export async function runSiLU(input, options = {}) {
  const device = getDevice();
  const { size, gate = null, outputBuffer = null, useVec4 = false } = options;

  // Select variant
  let variant = 'default';
  if (gate) {
    variant = 'gate';
  } else if (useVec4) {
    variant = 'vec4';
  }

  const config = getKernelConfig('silu', variant);
  const pipeline = await createPipeline('silu', variant);

  // Output size depends on variant
  const outputElements = gate ? size : size;
  const outputSize = outputElements * 4;
  const output = outputBuffer || device.createBuffer({
    label: 'silu_output',
    size: outputSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, size, true);
  uniformView.setUint32(4, 0, true); // hasBias
  uniformView.setUint32(8, gate ? 1 : 0, true); // hasGate
  uniformView.setUint32(12, 0, true); // padding

  const uniformBuffer = device.createBuffer({
    label: 'silu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create dummy buffers if not provided
  const gateBuffer = gate || device.createBuffer({
    label: 'silu_dummy_gate',
    size: 4,
    usage: GPUBufferUsage.STORAGE,
  });
  const biasBuffer = device.createBuffer({
    label: 'silu_dummy_bias',
    size: 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'silu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
      { binding: 3, resource: { buffer: gateBuffer } },
      { binding: 4, resource: { buffer: biasBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'silu_encoder' });
  const pass = encoder.beginComputePass({ label: 'silu_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = useVec4 ? Math.ceil(size / (256 * 4)) : Math.ceil(size / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  if (!gate) gateBuffer.destroy();
  biasBuffer.destroy();

  return output;
}
