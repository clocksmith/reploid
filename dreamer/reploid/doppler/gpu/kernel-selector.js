/**
 * Kernel Selector - Runtime Kernel Selection Based on Device Capabilities
 *
 * Selects optimal kernel variants based on detected GPU features.
 * Manages shader compilation and caching.
 *
 * Phase 2: Added attention, rmsnorm, softmax, rope, silu kernels.
 */

import { getDevice, getKernelCapabilities, getDeviceLimits, FEATURES } from './device.js';
import { getKernelTuner } from './kernel-tuner.js';
import { getBufferDtype, setBufferDtype } from './buffer-dtypes.js';
import { acquireBuffer } from './buffer-pool.js';
import { CommandRecorder, createCommandRecorder } from './command-recorder.js';

/**
 * Validate that attention parameters are within device limits
 * @param {number} seqLen - Sequence length
 * @param {number} numHeads - Number of attention heads
 * @param {number} headDim - Dimension per head
 * @throws {Error} If parameters exceed device limits
 */
function validateAttentionLimits(seqLen, numHeads, headDim) {
  const limits = getDeviceLimits();
  if (!limits) return; // No device, validation will fail later

  // Check workgroup invocations limit
  const workgroupInvocations = seqLen * numHeads;
  if (workgroupInvocations > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error(
      `Attention parameters exceed device limits: ${workgroupInvocations} workgroups ` +
      `> ${limits.maxComputeWorkgroupsPerDimension} max per dimension. ` +
      `Try reducing seqLen (${seqLen}) or numHeads (${numHeads}).`
    );
  }

  // Check buffer size limits for KV cache
  const kvCacheSize = seqLen * numHeads * headDim * 4; // float32
  if (kvCacheSize > limits.maxStorageBufferBindingSize) {
    throw new Error(
      `KV cache size ${(kvCacheSize / 1e9).toFixed(2)}GB exceeds device limit ` +
      `${(limits.maxStorageBufferBindingSize / 1e9).toFixed(2)}GB. ` +
      `Reduce sequence length or use paged attention.`
    );
  }

  // Check shared memory requirements for attention tile
  const tileSize = 64; // TILE_SIZE in attention.wgsl
  const sharedMemRequired = tileSize * headDim * 4 * 2; // K and V tiles
  if (sharedMemRequired > limits.maxComputeWorkgroupStorageSize) {
    console.warn(
      `[KernelSelector] Attention may be slow: tile requires ${sharedMemRequired} bytes ` +
      `but device has ${limits.maxComputeWorkgroupStorageSize} bytes shared memory.`
    );
  }
}

// Shader source cache (loaded via fetch)
const shaderSourceCache = new Map();

// Base path for kernel files
const KERNEL_BASE_PATH = '/gpu/kernels';

/**
 * Load a WGSL shader file via fetch
 * @param {string} filename - Shader filename (e.g., 'matmul_f32.wgsl')
 * @returns {Promise<string>} Shader source code
 */
async function loadShaderSource(filename) {
  if (shaderSourceCache.has(filename)) {
    return shaderSourceCache.get(filename);
  }

  const url = `${KERNEL_BASE_PATH}/${filename}`;
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load shader ${filename}: ${response.status}`);
    }
    const source = await response.text();
    shaderSourceCache.set(filename, source);
    return source;
  } catch (error) {
    console.error(`[KernelSelector] Failed to load shader ${filename}:`, error);
    throw error;
  }
}

// Compiled pipeline cache
const pipelineCache = new Map();

/**
 * Kernel configuration for different operations
 * Uses shader filenames instead of pre-imported sources
 */
const KERNEL_CONFIGS = {
  matmul: {
    f16: {
      shaderFile: 'matmul_f16.wgsl',
      entryPoint: 'main',
      workgroupSize: [16, 16, 1],
      requires: ['shader-f16'],
    },
    f16_vec4: {
      shaderFile: 'matmul_f16.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [16, 16, 1],
      requires: ['shader-f16'],
    },
    f16w_f32a: {
      shaderFile: 'matmul_f16w_f32a.wgsl',
      entryPoint: 'main',
      workgroupSize: [16, 16, 1],
      requires: ['shader-f16'],
    },
    f16w_f32a_naive: {
      shaderFile: 'matmul_f16w_f32a_naive.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: ['shader-f16'],
    },
    f32: {
      shaderFile: 'matmul_f32.wgsl',
      entryPoint: 'main',
      workgroupSize: [16, 16, 1],
      requires: [],
    },
  },
  dequant: {
    subgroup: {
      shaderFile: 'dequant_subgroup.wgsl',
      entryPoint: 'main',
      workgroupSize: [64, 1, 1],
      requires: ['subgroups'],
    },
    subgroup_vec4: {
      shaderFile: 'dequant_subgroup.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: ['subgroups'],
    },
    subgroup_f16out: {
      shaderFile: 'dequant_f16_out.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: ['subgroups', 'shader-f16'],
    },
    subgroup_vec4_f16out: {
      shaderFile: 'dequant_f16_out.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: ['subgroups', 'shader-f16'],
    },
    shared: {
      shaderFile: 'dequant_shared.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    shared_vec4: {
      shaderFile: 'dequant_shared.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
    shared_f16out: {
      shaderFile: 'dequant_f16_out.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: ['shader-f16'],
    },
    shared_vec4_f16out: {
      shaderFile: 'dequant_f16_out.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: ['shader-f16'],
    },
    // MXFP4 dequantization (GPT-OSS)
    mxfp4: {
      shaderFile: 'dequant_mxfp4.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    mxfp4_vec4: {
      shaderFile: 'dequant_mxfp4.wgsl',
      entryPoint: 'main_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
    mxfp4_expert: {
      shaderFile: 'dequant_mxfp4.wgsl',
      entryPoint: 'main_expert',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  attention: {
    prefill: {
      shaderFile: 'attention.wgsl',
      entryPoint: 'main',
      workgroupSize: [64, 1, 1],
      requires: [],
      validate: validateAttentionLimits, // Device limits validation
    },
    decode: {
      shaderFile: 'attention.wgsl',
      entryPoint: 'attention_decode',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    prefill_small: {
      shaderFile: 'attention_small.wgsl',
      entryPoint: 'main',
      workgroupSize: [32, 1, 1],
      requires: [],
      validate: validateAttentionLimits,
    },
    decode_small: {
      shaderFile: 'attention_small.wgsl',
      entryPoint: 'main',
      workgroupSize: [32, 1, 1],
      requires: [],
    },
    prefill_streaming: {
      shaderFile: 'attention_streaming.wgsl',
      entryPoint: 'main',
      workgroupSize: [1, 1, 1],
      requires: [],
      validate: validateAttentionLimits,
    },
    decode_streaming: {
      shaderFile: 'attention_streaming.wgsl',
      entryPoint: 'main',
      workgroupSize: [1, 1, 1],
      requires: [],
    },
    prefill_f16kv: {
      shaderFile: 'attention_f16kv.wgsl',
      entryPoint: 'main',
      workgroupSize: [64, 1, 1],
      requires: ['shader-f16'],
      validate: validateAttentionLimits,
    },
    decode_f16kv: {
      shaderFile: 'attention_f16kv.wgsl',
      entryPoint: 'attention_decode',
      workgroupSize: [256, 1, 1],
      requires: ['shader-f16'],
    },
    prefill_small_f16kv: {
      shaderFile: 'attention_small_f16kv.wgsl',
      entryPoint: 'main',
      workgroupSize: [32, 1, 1],
      requires: ['shader-f16'],
      validate: validateAttentionLimits,
    },
    decode_small_f16kv: {
      shaderFile: 'attention_small_f16kv.wgsl',
      entryPoint: 'main',
      workgroupSize: [32, 1, 1],
      requires: ['shader-f16'],
    },
    prefill_streaming_f16kv: {
      shaderFile: 'attention_streaming_f16kv.wgsl',
      entryPoint: 'main',
      workgroupSize: [1, 1, 1],
      requires: ['shader-f16'],
      validate: validateAttentionLimits,
    },
    decode_streaming_f16kv: {
      shaderFile: 'attention_streaming_f16kv.wgsl',
      entryPoint: 'main',
      workgroupSize: [1, 1, 1],
      requires: ['shader-f16'],
    },
  },
  rmsnorm: {
    default: {
      shaderFile: 'rmsnorm.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    small: {
      shaderFile: 'rmsnorm.wgsl',
      entryPoint: 'rmsnorm_small',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    residual: {
      shaderFile: 'rmsnorm.wgsl',
      entryPoint: 'rmsnorm_inplace_residual',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  softmax: {
    default: {
      shaderFile: 'softmax.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    small: {
      shaderFile: 'softmax.wgsl',
      entryPoint: 'softmax_small',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    online: {
      shaderFile: 'softmax.wgsl',
      entryPoint: 'softmax_online',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  rope: {
    default: {
      shaderFile: 'rope.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    compute_freqs: {
      shaderFile: 'rope.wgsl',
      entryPoint: 'rope_compute_freqs',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    qk: {
      shaderFile: 'rope.wgsl',
      entryPoint: 'rope_qk',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    ntk: {
      shaderFile: 'rope.wgsl',
      entryPoint: 'rope_ntk_scaled',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    yarn: {
      shaderFile: 'rope.wgsl',
      entryPoint: 'rope_yarn',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  silu: {
    default: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gate: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'silu_gate',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gate_split: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'silu_gate_split',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'silu_vec4',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gelu: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'gelu',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    geglu: {
      shaderFile: 'silu.wgsl',
      entryPoint: 'geglu',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  gather: {
    default: {
      shaderFile: 'gather.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      shaderFile: 'gather.wgsl',
      entryPoint: 'gather_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
  },
  residual: {
    default: {
      shaderFile: 'residual.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      shaderFile: 'residual.wgsl',
      entryPoint: 'add_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
  },
  topk: {
    default: {
      shaderFile: 'topk.wgsl',
      entryPoint: 'main',
      workgroupSize: [32, 1, 1],
      requires: [],
    },
    small: {
      shaderFile: 'topk.wgsl',
      entryPoint: 'topk_2_small',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    fused: {
      shaderFile: 'topk.wgsl',
      entryPoint: 'softmax_topk',
      workgroupSize: [32, 1, 1],
      requires: [],
    },
  },
  scatter_add: {
    default: {
      shaderFile: 'scatter_add.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    vec4: {
      shaderFile: 'scatter_add.wgsl',
      entryPoint: 'scatter_add_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
    dynamic: {
      shaderFile: 'scatter_add.wgsl',
      entryPoint: 'scatter_add_dynamic',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    accumulate: {
      shaderFile: 'scatter_add.wgsl',
      entryPoint: 'scatter_add_accumulate',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  moe_gather: {
    count: {
      shaderFile: 'moe_gather.wgsl',
      entryPoint: 'count_and_map',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gather: {
      shaderFile: 'moe_gather.wgsl',
      entryPoint: 'gather_tokens',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
    gather_vec4: {
      shaderFile: 'moe_gather.wgsl',
      entryPoint: 'gather_tokens_vec4',
      workgroupSize: [64, 1, 1],
      requires: [],
    },
    single_pass: {
      shaderFile: 'moe_gather.wgsl',
      entryPoint: 'gather_single_pass',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  swiglu: {
    rowsplit_bias: {
      shaderFile: 'swiglu.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  bias_add: {
    default: {
      shaderFile: 'bias_add.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: [],
    },
  },
  cast: {
    f32_to_f16: {
      shaderFile: 'cast_f32_to_f16.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
      requires: ['shader-f16'],
    },
  },
  bf16_to_f32: {
    default: {
      shaderFile: 'bf16_to_f32.wgsl',
      entryPoint: 'main',
      workgroupSize: [256, 1, 1],
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
  const {
    preferF16 = true,
    useVec4 = false,
    outputDtype = 'f32',
    aDtype = null,
    bDtype = null,
  } = options;

  const inputsAreF16 = aDtype === 'f16' && bDtype === 'f16';
  const weightsAreF16 = bDtype === 'f16' && aDtype !== 'f16';

  // Full f16 matmul only when both inputs are f16 and caller wants f16 output.
  if (outputDtype === 'f16' && preferF16 && inputsAreF16 && capabilities.hasF16) {
    return useVec4 ? 'f16_vec4' : 'f16';
  }

  // Mixed precision: f32 activations, f16 weights, f32 output.
  if (outputDtype === 'f32' && preferF16 && weightsAreF16 && capabilities.hasF16) {
    return 'f16w_f32a';
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
async function compileShader(device, source, label) {
  const module = device.createShaderModule({
    label,
    code: source,
  });

  // Check for compilation errors
  const compilationInfo = await module.getCompilationInfo();
  if (compilationInfo.messages.length > 0) {
    for (const msg of compilationInfo.messages) {
      const type = msg.type === 'error' ? 'ERROR' : msg.type === 'warning' ? 'WARN' : 'INFO';
      console.log(`[DEBUG compileShader ${label}] ${type}: ${msg.message} (line ${msg.lineNum}:${msg.linePos})`);
    }
    if (compilationInfo.messages.some(m => m.type === 'error')) {
      throw new Error(`Shader compilation failed for ${label}`);
    }
  }

  return module;
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
    console.log(`[DEBUG createPipeline] Cache HIT for ${cacheKey}`);
    return pipelineCache.get(cacheKey);
  }
  console.log(`[DEBUG createPipeline] Cache MISS for ${cacheKey}, creating new pipeline`);

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

  // Load shader source via fetch (handles caching internally)
  const shaderSource = await loadShaderSource(config.shaderFile);

  // Compile shader (now async to check for errors)
  const shaderModule = await compileShader(device, shaderSource, `${operation}_${variant}`);

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
  const {
    alpha = 1.0,
    outputBuffer = null,
    transposeB = false,
    aOffset = 0,
    bOffset = 0,
    cOffset = 0,
  } = options;

  // Validate dimensions
  if (!Number.isFinite(M) || !Number.isFinite(N) || !Number.isFinite(K)) {
    throw new Error(`[runMatmul] Invalid dimensions: M=${M}, N=${N}, K=${K}`);
  }
  if (M <= 0 || N <= 0 || K <= 0) {
    throw new Error(`[runMatmul] Dimensions must be positive: M=${M}, N=${N}, K=${K}`);
  }

  // Infer dtypes for safe kernel selection.
  const aDtype = getBufferDtype(A) || 'f32';
  const rawBDtype = getBufferDtype(B);
  const requestedOutputDtype = options.outputDtype || 'f32';

  // Warn if B buffer dtype is unknown - this can cause wrong kernel selection
  if (!rawBDtype && M <= 2) {
    console.warn(`[runMatmul] B buffer dtype unknown! size=${B.size}, M=${M}, N=${N}, K=${K}. Assuming f32.`);
  }
  const bDtype = rawBDtype || 'f32';

  // Validate offsets (WebGPU storage buffer binding offsets must be aligned).
  if (!Number.isFinite(aOffset) || aOffset < 0 ||
      !Number.isFinite(bOffset) || bOffset < 0 ||
      !Number.isFinite(cOffset) || cOffset < 0) {
    throw new Error(`[runMatmul] Invalid buffer offsets: aOffset=${aOffset}, bOffset=${bOffset}, cOffset=${cOffset}`);
  }

  const STORAGE_ALIGNMENT = 256;
  if (aOffset % STORAGE_ALIGNMENT !== 0 ||
      bOffset % STORAGE_ALIGNMENT !== 0 ||
      cOffset % STORAGE_ALIGNMENT !== 0) {
    throw new Error(
      `[runMatmul] Buffer offsets must be ${STORAGE_ALIGNMENT}-byte aligned: ` +
      `aOffset=${aOffset}, bOffset=${bOffset}, cOffset=${cOffset}`
    );
  }

  // Validate buffer sizes (A is activations, B may be quantized)
  const aBytesPerElem = aDtype === 'f16' ? 2 : 4;
  const aBindingSize = Math.ceil((M * K * aBytesPerElem) / 4) * 4;
  const aRequired = aOffset + aBindingSize;
  if (A.size < aRequired) {
    throw new Error(`[runMatmul] A buffer too small: ${A.size} < ${aRequired} (M=${M}, K=${K}, aDtype=${aDtype})`);
  }

  // Validate B buffer size
  const bBytesPerElem = bDtype === 'f16' ? 2 : 4;
  const bElements = transposeB ? N * K : K * N;
  const bBindingSize = Math.ceil((bElements * bBytesPerElem) / 4) * 4;
  const bRequired = bOffset + bBindingSize;
  if (B.size < bRequired) {
    throw new Error(`[runMatmul] B buffer too small: ${B.size} < ${bRequired} (N=${N}, K=${K}, bDtype=${bDtype}, transposeB=${transposeB})`);
  }

  // Select kernel - use naive kernel for M=1 decode with f16 weights
  let variant = selectMatmulKernel({
    ...options,
    aDtype,
    bDtype,
    outputDtype: requestedOutputDtype,
  });

  // Use naive (non-tiled) kernel for M=1 decode with f16 weights
  // The tiled kernel has issues with large K dimensions
  const useNaive = M === 1 && bDtype === 'f16' && aDtype === 'f32';
  if (useNaive) {
    variant = 'f16w_f32a_naive';
  }

  const config = getKernelConfig('matmul', variant);
  const pipeline = await createPipeline('matmul', variant);


  // Determine element size based on kernel
  const outputsF16 = variant === 'f16' || variant === 'f16_vec4';
  const elementSize = outputsF16 ? 2 : 4;
  const actualOutputDtype = outputsF16 ? 'f16' : 'f32';
  const outputSize = M * N * elementSize;
  const cBindingSize = Math.ceil(outputSize / 4) * 4;

  // Validate output size
  if (!Number.isFinite(outputSize) || outputSize <= 0) {
    throw new Error(`[runMatmul] Invalid output size: ${outputSize} (M=${M}, N=${N}, elementSize=${elementSize})`);
  }

  // Create output buffer if not provided
  const C = outputBuffer || acquireBuffer(outputSize, undefined, 'matmul_output');
  if (outputBuffer && C.size < cOffset + cBindingSize) {
    throw new Error(
      `[runMatmul] outputBuffer too small: ${C.size} < ${cOffset + cBindingSize} ` +
      `(M=${M}, N=${N}, cOffset=${cOffset}, outputDtype=${actualOutputDtype})`
    );
  }

  // Create uniform buffer (M, N, K, alpha, transposeB)
  const uniformData = new ArrayBuffer(20);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, M, true);
  uniformView.setUint32(4, N, true);
  uniformView.setUint32(8, K, true);
  uniformView.setFloat32(12, alpha, true);
  uniformView.setUint32(16, transposeB ? 1 : 0, true);

  const uniformBuffer = device.createBuffer({
    label: 'matmul_uniforms',
    size: 20,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'matmul_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: A, offset: aOffset, size: aBindingSize } },
      { binding: 2, resource: { buffer: B, offset: bOffset, size: bBindingSize } },
      { binding: 3, resource: { buffer: C, offset: cOffset, size: cBindingSize } },
    ],
  });

  // Dispatch compute
  const encoder = device.createCommandEncoder({ label: 'matmul_encoder' });
  const pass = encoder.beginComputePass({ label: 'matmul_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const [wgX, wgY] = config.workgroupSize;
  let workgroupsX, workgroupsY;

  // Naive kernel uses 1D dispatch (gid.x = output column)
  if (useNaive) {
    workgroupsX = Math.ceil(N / wgX);
    workgroupsY = 1;
  } else {
    // Tiled kernel uses 2D dispatch (gid.x = row, gid.y = column)
    workgroupsX = Math.ceil(M / wgX);
    workgroupsY = Math.ceil(N / wgY);
  }
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();

  device.queue.submit([encoder.finish()]);

  // Clean up temporary buffers
  uniformBuffer.destroy();

  setBufferDtype(C, actualOutputDtype);
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
 * @param {GPUBuffer} blocks - U8 blocks buffer with packed nibbles
 * @param {GPUBuffer} scales - U8 scales buffer
 * @param {number} totalElements - Total output elements
 * @param {number} numGroups - Number of groups per row
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Dequantized output buffer
 */
export async function dequantizeMXFP4(blocks, scales, totalElements, numGroups, options = {}) {
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
 * @param {GPUBuffer} blocks - U8 blocks buffer [num_experts, out_dim, num_groups, 16]
 * @param {GPUBuffer} scales - U8 scales buffer [num_experts, out_dim, num_groups]
 * @param {number} expertIdx - Expert index to extract
 * @param {number} numExperts - Total number of experts (32)
 * @param {number} outDim - Output dimension
 * @param {number} numGroups - Number of groups per row (90)
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Dequantized output buffer for single expert
 */
export async function dequantizeMXFP4Expert(blocks, scales, expertIdx, numExperts, outDim, numGroups, options = {}) {
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
 * Cast a f32 buffer to f16 on GPU.
 * @param {GPUBuffer} input - f32 input buffer
 * @param {number} numElements - number of f32 elements
 * @param {object} options
 * @returns {Promise<GPUBuffer>} f16 output buffer
 */
export async function castF32ToF16(input, numElements, options = {}) {
  const device = getDevice();
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('cast', 'f32_to_f16');

  const output = outputBuffer || acquireBuffer(numElements * 2, undefined, 'cast_f32_to_f16_output');

  const uniformData = new ArrayBuffer(16);
  new DataView(uniformData).setUint32(0, numElements, true);

  const uniformBuffer = device.createBuffer({
    label: 'cast_f32_to_f16_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const bindGroup = device.createBindGroup({
    label: 'cast_f32_to_f16_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // WebGPU limit: max 65535 workgroups per dimension
  const workgroups = Math.ceil(numElements / 256);
  const MAX_WORKGROUPS = 65535;

  if (workgroups <= MAX_WORKGROUPS) {
    const encoder = device.createCommandEncoder({ label: 'cast_f32_to_f16_encoder' });
    const pass = encoder.beginComputePass({ label: 'cast_f32_to_f16_pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    device.queue.submit([encoder.finish()]);
  } else {
    // Large tensor: use 2D dispatch (Y dimension for batches)
    const wgY = Math.ceil(workgroups / MAX_WORKGROUPS);
    const wgX = Math.min(workgroups, MAX_WORKGROUPS);
    const encoder = device.createCommandEncoder({ label: 'cast_f32_to_f16_encoder' });
    const pass = encoder.beginComputePass({ label: 'cast_f32_to_f16_pass' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  uniformBuffer.destroy();
  setBufferDtype(output, 'f16');

  return output;
}

/**
 * Convert BF16 buffer to F32 on GPU
 * BF16 is the upper 16 bits of F32, so conversion is just a shift.
 * Handles large tensors by chunking to stay within buffer limits.
 * @param {GPUBuffer} input - BF16 input buffer (stored as u16/bytes)
 * @param {number} numElements - Number of BF16 elements
 * @param {string} name - Name for the output buffer
 * @returns {Promise<GPUBuffer>} F32 output buffer
 */
export async function runBF16ToF32(input, numElements, name = 'bf16_to_f32_output') {
  const device = getDevice();
  const capabilities = getKernelCapabilities();

  // Check if output would exceed max buffer size (leave 256 bytes margin)
  const outputBytes = numElements * 4;
  const maxBufferSize = capabilities.maxBufferSize - 256;

  if (outputBytes > maxBufferSize) {
    // Chunked conversion for very large tensors
    return runBF16ToF32Chunked(input, numElements, name, maxBufferSize);
  }

  const pipeline = await createPipeline('bf16_to_f32', 'default');

  // Output is f32 (4 bytes per element)
  const output = acquireBuffer(outputBytes, undefined, name);

  // Each thread processes 2 BF16 elements (packed in u32)
  const totalWorkgroups = Math.ceil(numElements / 2 / 256);
  const MAX_WORKGROUPS = 65535;

  // Determine dispatch dimensions
  let workgroupsX, workgroupsY;
  if (totalWorkgroups <= MAX_WORKGROUPS) {
    workgroupsX = totalWorkgroups;
    workgroupsY = 1;
  } else {
    // Use 2D dispatch for large tensors
    workgroupsX = MAX_WORKGROUPS;
    workgroupsY = Math.ceil(totalWorkgroups / MAX_WORKGROUPS);
  }

  // Create uniform buffer with workgroupsX for 2D linearization
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numElements, true);
  uniformView.setUint32(4, workgroupsX, true);  // workgroupsX for kernel linearization

  const uniformBuffer = device.createBuffer({
    label: 'bf16_to_f32_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const bindGroup = device.createBindGroup({
    label: 'bf16_to_f32_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  const encoder = device.createCommandEncoder({ label: 'bf16_to_f32_encoder' });
  const pass = encoder.beginComputePass({ label: 'bf16_to_f32_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();
  setBufferDtype(output, 'f32');

  return output;
}

/**
 * Chunked BF16→F32 conversion for tensors that exceed max buffer size.
 * Falls back to CPU conversion in chunks streamed to GPU.
 * @private
 */
async function runBF16ToF32Chunked(input, numElements, name, maxBufferSize) {
  const device = getDevice();

  // Allocate output buffer (may need to be slightly under max)
  const outputBytes = numElements * 4;

  // For very large tensors exceeding single buffer, we need a different approach:
  // Read BF16 from GPU, convert on CPU in chunks, write F32 back
  // This is slower but handles arbitrary sizes

  // Read back BF16 data
  const readBuffer = device.createBuffer({
    label: 'bf16_readback',
    size: numElements * 2,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(input, 0, readBuffer, 0, numElements * 2);
  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const bf16Data = new Uint16Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();
  readBuffer.destroy();

  // Allocate output - if it fits in one buffer, use GPU buffer
  // Otherwise fall back to keeping as CPU array (gather will handle it)
  if (outputBytes <= maxBufferSize) {
    const output = acquireBuffer(outputBytes, undefined, name);

    // Convert in chunks and stream to GPU
    const CHUNK_ELEMENTS = 64 * 1024 * 1024; // 64M elements = 256MB F32
    const chunkF32 = new Float32Array(Math.min(CHUNK_ELEMENTS, numElements));

    for (let offset = 0; offset < numElements; offset += CHUNK_ELEMENTS) {
      const chunkEnd = Math.min(offset + CHUNK_ELEMENTS, numElements);
      const chunkLen = chunkEnd - offset;

      for (let i = 0; i < chunkLen; i++) {
        // BF16 to F32: shift left 16 bits
        const bf16 = bf16Data[offset + i];
        const f32Bits = bf16 << 16;
        // Use DataView to interpret as float
        const tmp = new ArrayBuffer(4);
        new Uint32Array(tmp)[0] = f32Bits;
        chunkF32[i] = new Float32Array(tmp)[0];
      }

      device.queue.writeBuffer(output, offset * 4, chunkF32, 0, chunkLen);
    }

    setBufferDtype(output, 'f32');
    return output;
  }

  // Output too large for single buffer - return CPU array
  // (This case shouldn't normally happen with 4GB max buffer)
  console.warn(`[BF16→F32] Output ${(outputBytes / 1e9).toFixed(2)}GB exceeds max buffer, using CPU array`);
  const f32 = new Float32Array(numElements);
  for (let i = 0; i < numElements; i++) {
    const bf16 = bf16Data[i];
    const tmp = new ArrayBuffer(4);
    new Uint32Array(tmp)[0] = bf16 << 16;
    f32[i] = new Float32Array(tmp)[0];
  }
  return f32;
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
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gather_output');

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
  const output = outputBuffer || acquireBuffer(size * 4, undefined, 'residual_output');

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
 * Add per-channel bias to a 2D buffer in-place.
 * data layout: [numTokens, dim], bias layout: [dim]
 * @param {GPUBuffer} data - Data buffer (read_write)
 * @param {GPUBuffer} bias - Bias buffer (read)
 * @param {number} numTokens
 * @param {number} dim
 * @param {object} options
 * @returns {Promise<GPUBuffer>} The same data buffer
 */
export async function runBiasAdd(data, bias, numTokens, dim, options = {}) {
  const device = getDevice();
  const { dataOffset = 0, biasOffset = 0 } = options;

  if (!Number.isFinite(numTokens) || numTokens <= 0 ||
      !Number.isFinite(dim) || dim <= 0) {
    throw new Error(`[runBiasAdd] Invalid shape: numTokens=${numTokens}, dim=${dim}`);
  }

  const STORAGE_ALIGNMENT = 256;
  if (dataOffset % STORAGE_ALIGNMENT !== 0 || biasOffset % STORAGE_ALIGNMENT !== 0) {
    throw new Error(
      `[runBiasAdd] Buffer offsets must be ${STORAGE_ALIGNMENT}-byte aligned: ` +
      `dataOffset=${dataOffset}, biasOffset=${biasOffset}`
    );
  }

  const totalElements = numTokens * dim;
  const pipeline = await createPipeline('bias_add', 'default');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, totalElements, true);
  uniformView.setUint32(4, dim, true);

  const uniformBuffer = device.createBuffer({
    label: 'bias_add_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const bindGroup = device.createBindGroup({
    label: 'bias_add_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: data, offset: dataOffset } },
      { binding: 2, resource: { buffer: bias, offset: biasOffset } },
    ],
  });

  const encoder = device.createCommandEncoder({ label: 'bias_add_encoder' });
  const pass = encoder.beginComputePass({ label: 'bias_add_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(totalElements / 256);
  pass.dispatchWorkgroups(Math.min(workgroups, 65535), Math.ceil(workgroups / 65535) || 1);
  pass.end();

  device.queue.submit([encoder.finish()]);
  uniformBuffer.destroy();

  return data;
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
 * Prewarm all supported kernel pipelines.
 * Compiles WGSL variants up front to reduce first-token latency.
 */
export async function prewarmKernels() {
  const caps = getKernelCapabilities();
  const jobs = [];

  for (const [operation, variants] of Object.entries(KERNEL_CONFIGS)) {
    for (const [variant, cfg] of Object.entries(variants)) {
      if (cfg.requires && !hasRequiredFeatures(cfg.requires, caps)) {
        continue;
      }
      jobs.push(
        createPipeline(operation, variant).catch((e) => {
          console.warn(`[KernelSelector] Prewarm failed for ${operation}/${variant}:`, e.message);
          return null;
        })
      );
    }
  }

  await Promise.all(jobs);
}

/**
 * Clear the pipeline and shader source caches
 */
export function clearPipelineCache() {
  pipelineCache.clear();
  shaderSourceCache.clear();
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
    startPos = 0,  // Offset for causal masking (absolute position of first query token)
    attentionKernel = null,
    outputBuffer = null,
  } = options;

  const limits = getDeviceLimits();
  const sharedLimit = limits?.maxComputeWorkgroupStorageSize ?? Infinity;

  // Select tier based on device shared memory and headDim (or user override).
  const kvDtype = getBufferDtype(K) || 'f32';
  const useF16KV = kvDtype === 'f16';

  const LARGE_MAX_HEAD_DIM = 64;
  const SMALL_MAX_HEAD_DIM = 256;
  const LARGE_REQUIRED_SHARED = 49152; // bytes (K/V/scores tiles in large kernel)
  const SMALL_BLOCK_SIZE = 32;
  const SMALL_HEAD_TILE = 32;
  const SMALL_REQUIRED_SHARED_F32 = 2 * SMALL_BLOCK_SIZE * SMALL_HEAD_TILE * 4; // 8192
  const SMALL_REQUIRED_SHARED_F16 = 2 * SMALL_BLOCK_SIZE * SMALL_HEAD_TILE * 2; // 4096

  let tier = attentionKernel;
  if (!tier) {
    const isDecode = seqLen === 1;
    const canLarge =
      headDim <= LARGE_MAX_HEAD_DIM &&
      sharedLimit >= LARGE_REQUIRED_SHARED;
    const smallRequired = useF16KV ? SMALL_REQUIRED_SHARED_F16 : SMALL_REQUIRED_SHARED_F32;
    const canSmall =
      headDim <= SMALL_MAX_HEAD_DIM &&
      sharedLimit >= smallRequired;
    if (canLarge) {
      tier = 'tiled_large';
    } else if (canSmall) {
      tier = 'tiled_small';
    } else if (isDecode) {
      tier = 'streaming';
    } else {
      console.warn(
        `[KernelSelector] No tiled attention fits prefill (headDim=${headDim}, shared=${sharedLimit}). ` +
        `Falling back to streaming. Expect slow prefill.`
      );
      tier = 'streaming';
    }
  }

  // Select variant based on tier and KV dtype.
  const base = 'prefill'; // Use prefill kernels for both prefill and decode.
  let variant;
  if (tier === 'tiled_large') {
    variant = base + (useF16KV ? '_f16kv' : '');
  } else if (tier === 'tiled_small') {
    variant = `${base}_small${useF16KV ? '_f16kv' : ''}`;
  } else {
    variant = `${base}_streaming${useF16KV ? '_f16kv' : ''}`;
  }
  const pipeline = await createPipeline('attention', variant);

  // Create output buffer if not provided
  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'attention_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  // Must match AttentionUniforms layout in WGSL.
  uniformView.setUint32(0, numHeads, true);
  uniformView.setUint32(4, numKVHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, kvLen, true);
  uniformView.setUint32(16, seqLen, true);
  uniformView.setFloat32(20, scale, true);
  uniformView.setUint32(24, causal ? 1 : 0, true);
  uniformView.setUint32(28, startPos, true); // Absolute position offset for causal masking

  const uniformBuffer = device.createBuffer({
    label: 'attention_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group (no mask buffer - shaders use isCausal for masking)
  const bindGroup = device.createBindGroup({
    label: 'attention_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: Q } },
      { binding: 2, resource: { buffer: K } },
      { binding: 3, resource: { buffer: V } },
      { binding: 4, resource: { buffer: output } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'attention_encoder' });
  const pass = encoder.beginComputePass({ label: 'attention_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  let workgroups;
  if (tier === 'streaming') {
    workgroups = seqLen * numHeads;
  } else if (tier === 'tiled_large') {
    const blockSize = 64;
    workgroups = Math.ceil(seqLen / blockSize) * numHeads;
  } else {
    const blockSize = 32;
    workgroups = Math.ceil(seqLen / blockSize) * numHeads;
  }

  if (limits && workgroups > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error(
      `Attention dispatch requires ${workgroups} workgroups but device limit is ` +
      `${limits.maxComputeWorkgroupsPerDimension}. Reduce prompt length or use streaming attention.`
    );
  }
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

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
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'rmsnorm_output');

  // Create uniform buffer
  // WGSL struct: size (offset 0), numTokens (offset 4), eps (offset 8), hasResidual (offset 12)
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, hiddenSize, true);   // size = hiddenSize
  uniformView.setUint32(4, batchSize, true);    // numTokens = batchSize
  uniformView.setFloat32(8, eps, true);
  uniformView.setUint32(12, 0, true); // hasResidual = 0

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
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'softmax_output');

  // Create uniform buffer
  // WGSL struct: innerSize (offset 0), outerSize (offset 4), temperature, padding
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, size, true);       // innerSize = size (elements per row)
  uniformView.setUint32(4, batchSize, true);  // outerSize = batchSize (number of rows)
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
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'silu_output');

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

  // Build bind group entries - only include bindings that the entry point uses
  // gate variant (silu_gate) uses bindings 0-3
  // default variant (main) uses bindings 0-2 only
  const entries = [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: input } },
    { binding: 2, resource: { buffer: output } },
  ];

  // Only add gate binding for gate variant
  if (gate) {
    entries.push({ binding: 3, resource: { buffer: gate } });
  }

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'silu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries,
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

  return output;
}

/**
 * Run GELU activation (tanh approximation)
 * Used by Gemma 3 and some other models.
 * GELU(x) ≈ 0.5 * x * (1 + tanh(sqrt(2/π) * (x + 0.044715 * x^3)))
 * @param {GPUBuffer} input - Input tensor
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Activated output
 */
export async function runGeLU(input, options = {}) {
  const device = getDevice();
  const { size, gate = null, outputBuffer = null } = options;

  // Select variant: gelu or geglu (gated)
  const variant = gate ? 'geglu' : 'gelu';

  const pipeline = await createPipeline('silu', variant);

  const outputSize = size * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'gelu_output');

  // Create uniform buffer (same struct as SiLU)
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, size, true);
  uniformView.setUint32(4, 0, true); // hasBias
  uniformView.setUint32(8, gate ? 1 : 0, true); // hasGate
  uniformView.setUint32(12, 0, true); // padding

  const uniformBuffer = device.createBuffer({
    label: 'gelu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // WebGPU derives bind group layout from the ENTRY POINT, not module level.
  // geglu entry point uses: 0=uniform, 1=input, 2=output, 3=gate (4 bindings)
  // gelu entry point uses: 0=uniform, 1=input, 2=output (3 bindings)
  const entries = gate
    ? [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: output } },
        { binding: 3, resource: { buffer: gate } },
      ]
    : [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: output } },
      ];

  const bindGroup = device.createBindGroup({
    label: 'gelu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'gelu_encoder' });
  const pass = encoder.beginComputePass({ label: 'gelu_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(size / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run SwiGLU from a fused gate_up projection with per-row split and bias.
 * input layout: [numTokens, 2 * dim] where each row is [gate..., up...]
 * bias layout: [2 * dim] where first half is gate bias and second half is up bias
 * output layout: [numTokens, dim]
 * @param {GPUBuffer} input
 * @param {GPUBuffer} bias
 * @param {number} numTokens
 * @param {number} dim
 * @param {object} options
 * @returns {Promise<GPUBuffer>}
 */
export async function runSwiGLURowsplitBias(input, bias, numTokens, dim, options = {}) {
  const device = getDevice();
  const { outputBuffer = null, biasOffset = 0 } = options;

  if (!Number.isFinite(numTokens) || numTokens <= 0 ||
      !Number.isFinite(dim) || dim <= 0) {
    throw new Error(`[runSwiGLURowsplitBias] Invalid shape: numTokens=${numTokens}, dim=${dim}`);
  }

  const STORAGE_ALIGNMENT = 256;
  if (biasOffset % STORAGE_ALIGNMENT !== 0) {
    throw new Error(
      `[runSwiGLURowsplitBias] biasOffset must be ${STORAGE_ALIGNMENT}-byte aligned: biasOffset=${biasOffset}`
    );
  }

  const pipeline = await createPipeline('swiglu', 'rowsplit_bias');

  const outputSize = numTokens * dim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'swiglu_output');

  // Uniforms: numTokens, dim
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, dim, true);

  const uniformBuffer = device.createBuffer({
    label: 'swiglu_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const biasBytes = dim * 2 * 4;
  const bindGroup = device.createBindGroup({
    label: 'swiglu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
      { binding: 3, resource: { buffer: bias, offset: biasOffset, size: biasBytes } },
    ],
  });

  const encoder = device.createCommandEncoder({ label: 'swiglu_encoder' });
  const pass = encoder.beginComputePass({ label: 'swiglu_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const totalElements = numTokens * dim;
  const workgroups = Math.ceil(totalElements / 256);
  pass.dispatchWorkgroups(Math.min(workgroups, 65535), Math.ceil(workgroups / 65535) || 1);
  pass.end();

  device.queue.submit([encoder.finish()]);
  uniformBuffer.destroy();

  return output;
}

/**
 * Run Top-K selection for MoE routing
 * @param {GPUBuffer} probs - Softmax probabilities [numTokens, numExperts]
 * @param {number} numTokens - Number of tokens
 * @param {number} numExperts - Number of experts
 * @param {number} topK - Number of experts to select per token
 * @param {object} options - Additional options
 * @returns {Promise<{indices: GPUBuffer, weights: GPUBuffer}>} Selected indices and weights
 */
export async function runTopK(probs, numTokens, numExperts, topK, options = {}) {
  const device = getDevice();
  const { normalize = true } = options;

  // Select variant based on topK and numExperts
  const variant = (topK === 2 && numExperts <= 8) ? 'small' : 'default';
  const pipeline = await createPipeline('topk', variant);

  // Create output buffers
  const indicesBuffer = acquireBuffer(numTokens * topK * 4, undefined, 'topk_indices');
  const weightsBuffer = acquireBuffer(numTokens * topK * 4, undefined, 'topk_weights');

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
      { binding: 2, resource: { buffer: indicesBuffer } },
      { binding: 3, resource: { buffer: weightsBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'topk_encoder' });
  const pass = encoder.beginComputePass({ label: 'topk_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = variant === 'small'
    ? Math.ceil(numTokens / 256)
    : numTokens; // One workgroup per token for default

  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return { indices: indicesBuffer, weights: weightsBuffer };
}

/**
 * Run fused softmax + top-k for MoE routing
 * @param {GPUBuffer} logits - Router logits [numTokens, numExperts]
 * @param {number} numTokens - Number of tokens
 * @param {number} numExperts - Number of experts
 * @param {number} topK - Number of experts to select per token
 * @param {object} options - Additional options
 * @returns {Promise<{indices: GPUBuffer, weights: GPUBuffer}>} Selected indices and weights
 */
export async function runSoftmaxTopK(logits, numTokens, numExperts, topK, options = {}) {
  const device = getDevice();
  const { normalize = true } = options;

  const pipeline = await createPipeline('topk', 'fused');

  // Create output buffers
  const indicesBuffer = acquireBuffer(numTokens * topK * 4, undefined, 'softmax_topk_indices');
  const weightsBuffer = acquireBuffer(numTokens * topK * 4, undefined, 'softmax_topk_weights');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, numExperts, true);
  uniformView.setUint32(8, topK, true);
  uniformView.setUint32(12, normalize ? 1 : 0, true);

  const uniformBuffer = device.createBuffer({
    label: 'softmax_topk_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'softmax_topk_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: indicesBuffer } },
      { binding: 3, resource: { buffer: weightsBuffer } },
    ],
  });

  // Dispatch - one workgroup per token
  const encoder = device.createCommandEncoder({ label: 'softmax_topk_encoder' });
  const pass = encoder.beginComputePass({ label: 'softmax_topk_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(numTokens);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return { indices: indicesBuffer, weights: weightsBuffer };
}

/**
 * Run MoE gather - group tokens by expert for batched execution
 * @param {GPUBuffer} hiddenStates - Input hidden states [numTokens, hiddenSize]
 * @param {GPUBuffer} expertIndices - Expert selections [numTokens, topK]
 * @param {number} numTokens - Number of tokens
 * @param {number} hiddenSize - Hidden dimension
 * @param {number} numExperts - Number of experts
 * @param {number} topK - Experts per token
 * @param {object} options - Additional options
 * @returns {Promise<{gathered: GPUBuffer, tokenCounts: GPUBuffer, tokenMap: GPUBuffer}>}
 */
export async function runMoEGather(hiddenStates, expertIndices, numTokens, hiddenSize, numExperts, topK, options = {}) {
  const device = getDevice();
  const { maxTokensPerExpert = numTokens * topK } = options;

  // DEBUG: Test minimal kernel to verify WebGPU compute works
  const testShaderCode = `
    @group(0) @binding(0) var<storage, read_write> output: array<u32>;

    @compute @workgroup_size(1)
    fn main() {
      output[0] = 0xCAFEBABEu;
    }
  `;
  const testModule = device.createShaderModule({ label: 'test_kernel', code: testShaderCode });
  const testCompilation = await testModule.getCompilationInfo();
  console.log(`[DEBUG runMoEGather] Test kernel compilation messages: ${testCompilation.messages.length}`);

  const testPipeline = device.createComputePipeline({
    label: 'test_pipeline',
    layout: 'auto',
    compute: { module: testModule, entryPoint: 'main' },
  });

  const testBuffer = device.createBuffer({
    label: 'test_buffer',
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  new Uint32Array(testBuffer.getMappedRange()).fill(0);
  testBuffer.unmap();

  const testBindGroup = device.createBindGroup({
    layout: testPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: testBuffer } }],
  });

  const testEncoder = device.createCommandEncoder();
  const testPass = testEncoder.beginComputePass();
  testPass.setPipeline(testPipeline);
  testPass.setBindGroup(0, testBindGroup);
  testPass.dispatchWorkgroups(1);
  testPass.end();
  device.queue.submit([testEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const testReadBuf = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const testCopyEncoder = device.createCommandEncoder();
  testCopyEncoder.copyBufferToBuffer(testBuffer, 0, testReadBuf, 0, 4);
  device.queue.submit([testCopyEncoder.finish()]);
  await testReadBuf.mapAsync(GPUMapMode.READ);
  const testResult = new Uint32Array(testReadBuf.getMappedRange().slice(0));
  testReadBuf.unmap();
  testReadBuf.destroy();
  testBuffer.destroy();
  console.log(`[DEBUG runMoEGather] Test kernel result: 0x${testResult[0].toString(16).toUpperCase()} (expected 0xCAFEBABE)`);

  // DEBUG: Test moe_gather-like kernel with same bindings but simpler logic
  const testMoECode = `
    struct MoEGatherUniforms {
      numTokens: u32,
      hiddenSize: u32,
      numExperts: u32,
      topK: u32,
      maxTokensPerExpert: u32,
      _pad1: u32,
      _pad2: u32,
      _pad3: u32,
    }

    @group(0) @binding(0) var<uniform> uniforms: MoEGatherUniforms;
    @group(0) @binding(1) var<storage, read> hiddenStates: array<f32>;
    @group(0) @binding(2) var<storage, read> expertIndices: array<u32>;
    @group(0) @binding(3) var<storage, read_write> gathered: array<f32>;
    @group(0) @binding(4) var<storage, read_write> tokenCounts: array<atomic<u32>>;
    @group(0) @binding(5) var<storage, read_write> tokenMap: array<u32>;

    @compute @workgroup_size(256, 1, 1)
    fn test_count(@builtin(global_invocation_id) gid: vec3<u32>) {
      // Touch all bindings to ensure they're included in auto layout
      let _ = uniforms.numTokens;
      let __ = hiddenStates[0];
      let ___ = expertIndices[0];
      gathered[0] = 0.0;
      tokenMap[0] = 0u;

      // Write 1 to tokenCounts[0] for all threads
      atomicAdd(&tokenCounts[0], 1u);
    }
  `;
  const testMoEModule = device.createShaderModule({ label: 'test_moe_kernel', code: testMoECode });
  const testMoECompilation = await testMoEModule.getCompilationInfo();
  console.log(`[DEBUG runMoEGather] Test MoE kernel compilation messages: ${testMoECompilation.messages.length}`);
  for (const msg of testMoECompilation.messages) {
    console.log(`[DEBUG TEST_MOE_COMPILE] ${JSON.stringify(msg)}`);
  }

  // Create test MoE pipeline and run it
  const testMoEPipeline = device.createComputePipeline({
    label: 'test_moe_pipeline',
    layout: 'auto',
    compute: { module: testMoEModule, entryPoint: 'test_count' },
  });

  // Create test buffers matching moe_gather bindings
  const testUniformBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const testHiddenBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE });
  const testIndicesBuf = device.createBuffer({ size: 512, usage: GPUBufferUsage.STORAGE });
  const testGatheredBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE });
  const testCountsBuf = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  new Uint32Array(testCountsBuf.getMappedRange()).fill(0);
  testCountsBuf.unmap();
  const testMapBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE });

  const testMoEBindGroup = device.createBindGroup({
    layout: testMoEPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: testUniformBuf } },
      { binding: 1, resource: { buffer: testHiddenBuf } },
      { binding: 2, resource: { buffer: testIndicesBuf } },
      { binding: 3, resource: { buffer: testGatheredBuf } },
      { binding: 4, resource: { buffer: testCountsBuf } },
      { binding: 5, resource: { buffer: testMapBuf } },
    ],
  });

  const testMoEEncoder = device.createCommandEncoder();
  const testMoEPass = testMoEEncoder.beginComputePass();
  testMoEPass.setPipeline(testMoEPipeline);
  testMoEPass.setBindGroup(0, testMoEBindGroup);
  testMoEPass.dispatchWorkgroups(1);
  testMoEPass.end();
  device.queue.submit([testMoEEncoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  const testMoEReadBuf = device.createBuffer({
    size: 128,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const testMoECopyEncoder = device.createCommandEncoder();
  testMoECopyEncoder.copyBufferToBuffer(testCountsBuf, 0, testMoEReadBuf, 0, 128);
  device.queue.submit([testMoECopyEncoder.finish()]);
  await testMoEReadBuf.mapAsync(GPUMapMode.READ);
  const testMoEResult = new Uint32Array(testMoEReadBuf.getMappedRange().slice(0));
  testMoEReadBuf.unmap();
  testMoEReadBuf.destroy();
  console.log(`[DEBUG runMoEGather] Test MoE kernel result - tokenCounts[0]: ${testMoEResult[0]} (expected 256)`);

  testUniformBuf.destroy();
  testHiddenBuf.destroy();
  testIndicesBuf.destroy();
  testGatheredBuf.destroy();
  testCountsBuf.destroy();
  testMapBuf.destroy();

  // Phase 1: Count tokens and build map
  // Load and check shader source for debugging
  const shaderSource = await loadShaderSource('moe_gather.wgsl');
  console.log(`[DEBUG runMoEGather] Shader source length: ${shaderSource.length}`);
  console.log(`[DEBUG runMoEGather] Shader contains DEBUG_V2: ${shaderSource.includes('DEBUG_V2')}`);
  console.log(`[DEBUG runMoEGather] Shader contains atomicStore: ${shaderSource.includes('atomicStore')}`);

  // Clear pipeline cache to force recompilation (for debugging)
  pipelineCache.delete('moe_gather:count');
  pipelineCache.delete('moe_gather:gather');
  pipelineCache.delete('moe_gather:gather_vec4');

  const countPipeline = await createPipeline('moe_gather', 'count');
  console.log(`[DEBUG runMoEGather] Count pipeline created: ${countPipeline ? 'yes' : 'no'}, label=${countPipeline?.label}`);

  // Phase 2: Gather tokens
  const useVec4 = hiddenSize % 4 === 0;
  const gatherVariant = useVec4 ? 'gather_vec4' : 'gather';
  const gatherPipeline = await createPipeline('moe_gather', gatherVariant);
  console.log(`[DEBUG runMoEGather] Gather pipeline created (${gatherVariant}): ${gatherPipeline ? 'yes' : 'no'}`);

  // Create output buffers
  const gatheredBuffer = acquireBuffer(
    numExperts * maxTokensPerExpert * hiddenSize * 4,
    undefined,
    'moe_gathered'
  );

  const tokenCountsBuffer = device.createBuffer({
    label: 'moe_token_counts',
    size: numExperts * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  // Zero-initialize token counts
  new Uint32Array(tokenCountsBuffer.getMappedRange()).fill(0);
  tokenCountsBuffer.unmap();

  const tokenMapBuffer = acquireBuffer(
    numExperts * maxTokensPerExpert * 2 * 4,
    undefined,
    'moe_token_map'
  );

  // Create uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, numExperts, true);
  uniformView.setUint32(12, topK, true);
  uniformView.setUint32(16, maxTokensPerExpert, true);

  const uniformBuffer = device.createBuffer({
    label: 'moe_gather_uniforms',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // DEBUG: Verify expertIndices buffer before kernel
  console.log(`[DEBUG runMoEGather] numTokens=${numTokens}, hiddenSize=${hiddenSize}, numExperts=${numExperts}, topK=${topK}, maxTokensPerExpert=${maxTokensPerExpert}`);
  console.log(`[DEBUG runMoEGather] expertIndices buffer size=${expertIndices.size}, hiddenStates buffer size=${hiddenStates.size}`);

  // Create separate bind groups for each pipeline to avoid layout mismatch with 'auto' layout
  const bindGroupEntries = [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: hiddenStates } },
    { binding: 2, resource: { buffer: expertIndices } },
    { binding: 3, resource: { buffer: gatheredBuffer } },
    { binding: 4, resource: { buffer: tokenCountsBuffer } },
    { binding: 5, resource: { buffer: tokenMapBuffer } },
  ];

  const countBindGroup = device.createBindGroup({
    label: 'moe_gather_count_bind_group',
    layout: countPipeline.getBindGroupLayout(0),
    entries: bindGroupEntries,
  });

  const gatherBindGroup = device.createBindGroup({
    label: 'moe_gather_gather_bind_group',
    layout: gatherPipeline.getBindGroupLayout(0),
    entries: bindGroupEntries,
  });

  // DEBUG: Read expert indices to verify buffer content
  const debugIndicesSize = numTokens * topK * 4;
  const debugReadBuf = device.createBuffer({
    label: 'debug_indices_read',
    size: debugIndicesSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const debugEncoder = device.createCommandEncoder({ label: 'debug_copy' });
  debugEncoder.copyBufferToBuffer(expertIndices, 0, debugReadBuf, 0, debugIndicesSize);
  device.queue.submit([debugEncoder.finish()]);
  await debugReadBuf.mapAsync(GPUMapMode.READ);
  const debugIndicesData = new Uint32Array(debugReadBuf.getMappedRange().slice(0));
  debugReadBuf.unmap();
  debugReadBuf.destroy();
  console.log(`[DEBUG runMoEGather] Expert indices buffer first 20 values:`, Array.from(debugIndicesData.slice(0, 20)));
  console.log(`[DEBUG runMoEGather] Expert indices unique values:`, [...new Set(debugIndicesData)]);

  const encoder = device.createCommandEncoder({ label: 'moe_gather_encoder' });

  // Phase 1: Count and map
  const countWorkgroups = Math.ceil((numTokens * topK) / 256);
  console.log(`[DEBUG runMoEGather] Dispatching count_and_map with ${countWorkgroups} workgroups for ${numTokens * topK} slots`);

  const countPass = encoder.beginComputePass({ label: 'moe_count_pass' });
  countPass.setPipeline(countPipeline);
  countPass.setBindGroup(0, countBindGroup);
  console.log(`[DEBUG runMoEGather] About to dispatch count_and_map`);
  countPass.dispatchWorkgroups(countWorkgroups);
  countPass.end();
  console.log(`[DEBUG runMoEGather] Count pass ended`);

  // Phase 2: Gather
  const gatherPass = encoder.beginComputePass({ label: 'moe_gather_pass' });
  gatherPass.setPipeline(gatherPipeline);
  gatherPass.setBindGroup(0, gatherBindGroup);

  const totalElements = numExperts * maxTokensPerExpert * hiddenSize;
  const workgroups = useVec4
    ? Math.ceil(totalElements / 4 / 64)
    : Math.ceil(totalElements / 256);

  gatherPass.dispatchWorkgroups(workgroups);
  gatherPass.end();

  const commandBuffer = encoder.finish();
  console.log(`[DEBUG runMoEGather] Command buffer created`);
  device.queue.submit([commandBuffer]);
  console.log(`[DEBUG runMoEGather] Commands submitted, waiting for GPU...`);
  await device.queue.onSubmittedWorkDone();
  console.log(`[DEBUG runMoEGather] GPU work completed`);

  // DEBUG: Read back token counts to verify kernel ran
  const debugCountsBuf = device.createBuffer({
    label: 'debug_counts_read',
    size: numExperts * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const debugCountsEncoder = device.createCommandEncoder({ label: 'debug_counts_copy' });
  debugCountsEncoder.copyBufferToBuffer(tokenCountsBuffer, 0, debugCountsBuf, 0, numExperts * 4);
  device.queue.submit([debugCountsEncoder.finish()]);
  await debugCountsBuf.mapAsync(GPUMapMode.READ);
  const debugCountsData = new Uint32Array(debugCountsBuf.getMappedRange().slice(0));
  debugCountsBuf.unmap();
  debugCountsBuf.destroy();
  const nonZeroCounts = [];
  for (let i = 0; i < numExperts; i++) {
    if (debugCountsData[i] > 0) nonZeroCounts.push(`e${i}:${debugCountsData[i]}`);
  }
  console.log(`[DEBUG runMoEGather] Token counts after kernel:`, nonZeroCounts.length > 0 ? nonZeroCounts.join(', ') : 'ALL ZERO');
  console.log(`[DEBUG runMoEGather] Total mapped:`, Array.from(debugCountsData).reduce((a, b) => a + b, 0));
  console.log(`[DEBUG runMoEGather] tokenCounts[0] raw hex:`, '0x' + debugCountsData[0].toString(16).toUpperCase());
  console.log(`[DEBUG runMoEGather] tokenCounts[31] raw hex:`, '0x' + debugCountsData[31].toString(16).toUpperCase());
  console.log(`[DEBUG runMoEGather] All tokenCounts values:`, Array.from(debugCountsData));

  uniformBuffer.destroy();

  return {
    gathered: gatheredBuffer,
    tokenCounts: tokenCountsBuffer,
    tokenMap: tokenMapBuffer,
    maxTokensPerExpert,
  };
}

/**
 * Run scatter-add for MoE output combination
 * @param {GPUBuffer} expertOutputs - Expert outputs [numExperts, numTokens, hiddenSize]
 * @param {GPUBuffer} indices - Expert indices [numTokens, topK]
 * @param {GPUBuffer} weights - Expert weights [numTokens, topK]
 * @param {number} numTokens - Number of tokens
 * @param {number} hiddenSize - Hidden dimension
 * @param {number} numExperts - Number of experts
 * @param {number} topK - Experts per token
 * @param {object} options - Additional options
 * @returns {Promise<GPUBuffer>} Combined output [numTokens, hiddenSize]
 */
export async function runScatterAdd(expertOutputs, indices, weights, numTokens, hiddenSize, numExperts, topK, options = {}) {
  const device = getDevice();
  const { outputBuffer = null, accumulate = false } = options;

  // Select variant
  const useVec4 = hiddenSize % 4 === 0;
  let variant = 'default';
  if (accumulate) {
    variant = 'accumulate';
  } else if (useVec4) {
    variant = 'vec4';
  }

  const pipeline = await createPipeline('scatter_add', variant);

  // Create output buffer if not provided
  const output = outputBuffer || acquireBuffer(
    numTokens * hiddenSize * 4,
    undefined,
    'scatter_add_output'
  );

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, hiddenSize, true);
  uniformView.setUint32(8, topK, true);
  uniformView.setUint32(12, numExperts, true);

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

  const totalElements = numTokens * hiddenSize;
  const workgroups = useVec4 && !accumulate
    ? Math.ceil(totalElements / 4 / 64)
    : Math.ceil(totalElements / 256);

  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  return output;
}

/**
 * Run dynamic scatter-add for MoE output combination.
 *
 * expertOutputs layout: [numExperts * maxTokensPerExpert, hiddenSize]
 * tokenOffsets layout: [numTokens, topK] where each entry is an offset into expertOutputs rows
 *
 * @param {GPUBuffer} expertOutputs - Expert outputs in gathered-slot order
 * @param {GPUBuffer} indices - Expert indices [numTokens, topK]
 * @param {GPUBuffer} weights - Expert weights [numTokens, topK]
 * @param {GPUBuffer} tokenOffsets - Offsets into expertOutputs [numTokens, topK]
 * @param {number} numTokens
 * @param {number} hiddenSize
 * @param {number} topK
 * @param {object} options
 * @returns {Promise<GPUBuffer>} Combined output [numTokens, hiddenSize]
 */
export async function runScatterAddDynamic(expertOutputs, indices, weights, tokenOffsets, numTokens, hiddenSize, topK, options = {}) {
  const device = getDevice();
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('scatter_add', 'dynamic');

  const output = outputBuffer || acquireBuffer(
    numTokens * hiddenSize * 4,
    undefined,
    'scatter_add_dynamic_output'
  );

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

  const encoder = device.createCommandEncoder({ label: 'scatter_add_dynamic_encoder' });
  const pass = encoder.beginComputePass({ label: 'scatter_add_dynamic_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const totalElements = numTokens * hiddenSize;
  const workgroups = Math.ceil(totalElements / 256);
  pass.dispatchWorkgroups(Math.min(workgroups, 65535), Math.ceil(workgroups / 65535) || 1);
  pass.end();

  device.queue.submit([encoder.finish()]);
  uniformBuffer.destroy();

  return output;
}

// ============================================================================
// BATCHED COMMAND RECORDING API
// ============================================================================
//
// These record* functions accept a CommandRecorder and add operations to it
// without submitting. This enables batching many operations into a single
// GPU submission, reducing JS<->GPU overhead by 20-40%.
//
// Usage:
//   const recorder = createCommandRecorder('forward_pass');
//   const hidden = recordGather(recorder, tokenIds, embeddings, ...);
//   const normed = recordRMSNorm(recorder, hidden, weight, eps, ...);
//   const qkv = recordMatmul(recorder, normed, qkvWeight, ...);
//   // ... more operations ...
//   recorder.submit();  // Single GPU submission
//
// ============================================================================

// Re-export CommandRecorder for external use
export { CommandRecorder, createCommandRecorder };

/**
 * Record a matrix multiplication operation (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} A - Input matrix A [M, K]
 * @param {GPUBuffer} B - Weight matrix B [K, N] or [N, K] if transposed
 * @param {number} M - Rows of A
 * @param {number} N - Cols of B (output cols)
 * @param {number} K - Cols of A / Rows of B
 * @param {object} options - Same options as runMatmul
 * @returns {GPUBuffer} Output buffer C [M, N]
 */
export async function recordMatmul(recorder, A, B, M, N, K, options = {}) {
  const device = recorder.device;
  const {
    alpha = 1.0,
    outputBuffer = null,
    transposeB = false,
    aOffset = 0,
    bOffset = 0,
    cOffset = 0,
  } = options;

  // Validate dimensions
  if (!Number.isFinite(M) || !Number.isFinite(N) || !Number.isFinite(K)) {
    throw new Error(`[recordMatmul] Invalid dimensions: M=${M}, N=${N}, K=${K}`);
  }
  if (M <= 0 || N <= 0 || K <= 0) {
    throw new Error(`[recordMatmul] Dimensions must be positive: M=${M}, N=${N}, K=${K}`);
  }

  // Infer dtypes
  const aDtype = getBufferDtype(A) || 'f32';
  const bDtype = getBufferDtype(B) || 'f32';
  const requestedOutputDtype = options.outputDtype || 'f32';

  // Validate offsets
  const STORAGE_ALIGNMENT = 256;
  if (aOffset % STORAGE_ALIGNMENT !== 0 ||
      bOffset % STORAGE_ALIGNMENT !== 0 ||
      cOffset % STORAGE_ALIGNMENT !== 0) {
    throw new Error(`[recordMatmul] Buffer offsets must be ${STORAGE_ALIGNMENT}-byte aligned`);
  }

  // Validate buffer sizes
  const aBytesPerElem = aDtype === 'f16' ? 2 : 4;
  const aBindingSize = Math.ceil((M * K * aBytesPerElem) / 4) * 4;
  if (A.size < aOffset + aBindingSize) {
    throw new Error(`[recordMatmul] A buffer too small: ${A.size} < ${aOffset + aBindingSize}`);
  }

  const bBytesPerElem = bDtype === 'f16' ? 2 : 4;
  const bElements = transposeB ? N * K : K * N;
  const bBindingSize = Math.ceil((bElements * bBytesPerElem) / 4) * 4;
  if (B.size < bOffset + bBindingSize) {
    throw new Error(`[recordMatmul] B buffer too small: ${B.size} < ${bOffset + bBindingSize}`);
  }

  // Select kernel
  let variant = selectMatmulKernel({ ...options, aDtype, bDtype, outputDtype: requestedOutputDtype });
  const useNaive = M === 1 && bDtype === 'f16' && aDtype === 'f32';
  if (useNaive) variant = 'f16w_f32a_naive';

  const config = getKernelConfig('matmul', variant);
  const pipeline = await createPipeline('matmul', variant);

  // Output buffer
  const outputsF16 = variant === 'f16' || variant === 'f16_vec4';
  const elementSize = outputsF16 ? 2 : 4;
  const actualOutputDtype = outputsF16 ? 'f16' : 'f32';
  const outputSize = M * N * elementSize;
  const cBindingSize = Math.ceil(outputSize / 4) * 4;

  const C = outputBuffer || acquireBuffer(outputSize, undefined, 'matmul_output');

  // Create uniform buffer (tracked by recorder for cleanup)
  const uniformData = new ArrayBuffer(20);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, M, true);
  uniformView.setUint32(4, N, true);
  uniformView.setUint32(8, K, true);
  uniformView.setFloat32(12, alpha, true);
  uniformView.setUint32(16, transposeB ? 1 : 0, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'matmul_uniforms');

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'matmul_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: A, offset: aOffset, size: aBindingSize } },
      { binding: 2, resource: { buffer: B, offset: bOffset, size: bBindingSize } },
      { binding: 3, resource: { buffer: C, offset: cOffset, size: cBindingSize } },
    ],
  });

  // Record compute pass (no submit!)
  const pass = recorder.beginComputePass('matmul');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const [wgX, wgY] = config.workgroupSize;
  if (useNaive) {
    pass.dispatchWorkgroups(Math.ceil(N / wgX), 1);
  } else {
    pass.dispatchWorkgroups(Math.ceil(M / wgX), Math.ceil(N / wgY));
  }
  pass.end();

  setBufferDtype(C, actualOutputDtype);
  return C;
}

/**
 * Record RMS normalization (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} input - Input tensor [numTokens, hiddenSize]
 * @param {GPUBuffer} weight - Norm weights [hiddenSize]
 * @param {number} eps - Epsilon for numerical stability
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Normalized output
 */
export async function recordRMSNorm(recorder, input, weight, eps = 1e-5, options = {}) {
  const device = recorder.device;
  const {
    batchSize = 1,
    hiddenSize = null,
    outputBuffer = null,
  } = options;

  // Infer hidden size from weight buffer
  const inferredHiddenSize = hiddenSize || (weight.size / 4);
  const inputSize = batchSize * inferredHiddenSize * 4;

  // Select kernel variant
  const variant = selectRMSNormKernel(options);
  const pipeline = await createPipeline('rmsnorm', variant);

  // Output buffer
  const output = outputBuffer || acquireBuffer(inputSize, undefined, 'rmsnorm_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, batchSize, true);
  uniformView.setUint32(4, inferredHiddenSize, true);
  uniformView.setFloat32(8, eps, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'rmsnorm_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'rmsnorm_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: weight } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('rmsnorm');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(batchSize);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record gather/embedding lookup (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} indices - Token indices [numTokens]
 * @param {GPUBuffer} embeddings - Embedding table [vocabSize, hiddenSize]
 * @param {number} numTokens - Number of tokens
 * @param {number} hiddenSize - Hidden dimension
 * @param {number} vocabSize - Vocabulary size
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Gathered embeddings [numTokens, hiddenSize]
 */
export async function recordGather(recorder, indices, embeddings, numTokens, hiddenSize, vocabSize, options = {}) {
  const device = recorder.device;
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('gather', 'default');

  // Output buffer
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
  pass.dispatchWorkgroups(numTokens, Math.ceil(hiddenSize / 256));
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record residual add (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} a - First input
 * @param {GPUBuffer} b - Second input
 * @param {number} size - Number of elements
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Sum output
 */
export async function recordResidualAdd(recorder, a, b, size, options = {}) {
  const device = recorder.device;
  const { outputBuffer = null } = options;

  const pipeline = await createPipeline('residual', 'default');

  // Output buffer
  const output = outputBuffer || acquireBuffer(size * 4, undefined, 'residual_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(8);
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
  pass.dispatchWorkgroups(Math.ceil(size / 256));
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record RoPE application (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} input - Input tensor [seqLen, numHeads, headDim]
 * @param {GPUBuffer} freqsCos - Cosine frequencies [maxSeqLen, headDim/2]
 * @param {GPUBuffer} freqsSin - Sine frequencies [maxSeqLen, headDim/2]
 * @param {number} seqLen - Sequence length
 * @param {object} options - Additional options
 * @returns {GPUBuffer} RoPE-applied output
 */
export async function recordRoPE(recorder, input, freqsCos, freqsSin, seqLen, options = {}) {
  const device = recorder.device;
  const {
    numHeads = 1,
    headDim = 64,
    startPos = 0,
    outputBuffer = null,
  } = options;

  const pipeline = await createPipeline('rope', 'default');

  // Output buffer
  const outputSize = seqLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'rope_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(24);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, seqLen, true);
  uniformView.setUint32(4, numHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, startPos, true);

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
  pass.dispatchWorkgroups(seqLen, numHeads);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record SiLU activation (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} input - Input tensor
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Activated output
 */
export async function recordSiLU(recorder, input, options = {}) {
  const device = recorder.device;
  const { outputBuffer = null, size = null } = options;

  // Infer size from input buffer
  const numElements = size || (input.size / 4);
  const pipeline = await createPipeline('silu', 'default');

  // Output buffer
  const output = outputBuffer || acquireBuffer(numElements * 4, undefined, 'silu_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(8);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numElements, true);

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
  pass.dispatchWorkgroups(Math.ceil(numElements / 256));
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record GeLU activation (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} input - Input tensor
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Activated output
 */
export async function recordGeLU(recorder, input, options = {}) {
  const device = recorder.device;
  const { outputBuffer = null, size = null } = options;

  const numElements = size || (input.size / 4);
  const pipeline = await createPipeline('gelu', 'default');

  // Output buffer
  const output = outputBuffer || acquireBuffer(numElements * 4, undefined, 'gelu_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(8);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numElements, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'gelu_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'gelu_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('gelu');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(numElements / 256));
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record attention operation (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} Q - Query tensor [queryLen, numHeads, headDim]
 * @param {GPUBuffer} K - Key tensor [seqLen, numKVHeads, headDim]
 * @param {GPUBuffer} V - Value tensor [seqLen, numKVHeads, headDim]
 * @param {GPUBuffer|null} mask - Optional attention mask
 * @param {number} numHeads - Number of query heads
 * @param {number} headDim - Head dimension
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Attention output [queryLen, numHeads, headDim]
 */
export async function recordAttention(recorder, Q, K, V, mask, numHeads, headDim, options = {}) {
  const device = recorder.device;
  const {
    numKVHeads = numHeads,
    seqLen = null,
    queryLen = null,
    isCausal = true,
    startPos = 0,
    outputBuffer = null,
    kvDtype = 'f32',
    kernelOverride = null,
  } = options;

  // Infer dimensions
  const qSize = Q.size / 4; // f32
  const inferredQueryLen = queryLen || Math.floor(qSize / (numHeads * headDim));
  const kSize = kvDtype === 'f16' ? K.size / 2 : K.size / 4;
  const inferredSeqLen = seqLen || Math.floor(kSize / (numKVHeads * headDim));

  // Select attention kernel
  const variant = selectAttentionKernel({
    seqLen: inferredSeqLen,
    queryLen: inferredQueryLen,
    numHeads,
    numKVHeads,
    headDim,
    kvDtype,
    override: kernelOverride,
  });

  const config = getKernelConfig('attention', variant);
  const pipeline = await createPipeline('attention', variant);

  // Output buffer
  const outputSize = inferredQueryLen * numHeads * headDim * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'attention_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(32);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numHeads, true);
  uniformView.setUint32(4, numKVHeads, true);
  uniformView.setUint32(8, headDim, true);
  uniformView.setUint32(12, inferredSeqLen, true);
  uniformView.setUint32(16, inferredQueryLen, true);
  uniformView.setFloat32(20, 1.0 / Math.sqrt(headDim), true);
  uniformView.setUint32(24, isCausal ? 1 : 0, true);
  uniformView.setUint32(28, startPos, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'attention_uniforms');

  // Bind group entries
  const entries = [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: { buffer: Q } },
    { binding: 2, resource: { buffer: K } },
    { binding: 3, resource: { buffer: V } },
    { binding: 4, resource: { buffer: output } },
  ];

  const bindGroup = device.createBindGroup({
    label: 'attention_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });

  // Record pass
  const pass = recorder.beginComputePass('attention');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  // Dispatch based on kernel variant
  const numQueryBlocks = Math.ceil(inferredQueryLen / 64);
  pass.dispatchWorkgroups(numQueryBlocks * numHeads);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record bias addition (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} data - Input data [numTokens, dim]
 * @param {GPUBuffer} bias - Bias vector [dim]
 * @param {number} numTokens - Number of tokens
 * @param {number} dim - Dimension
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Output with bias added
 */
export async function recordBiasAdd(recorder, data, bias, numTokens, dim, options = {}) {
  const device = recorder.device;
  const { outputBuffer = null, inPlace = false } = options;

  const pipeline = await createPipeline('bias_add', 'default');

  // Output buffer (can be same as input for in-place)
  const output = inPlace ? data : (outputBuffer || acquireBuffer(numTokens * dim * 4, undefined, 'bias_add_output'));

  // Uniform buffer
  const uniformData = new ArrayBuffer(12);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, numTokens, true);
  uniformView.setUint32(4, dim, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'bias_add_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'bias_add_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: data } },
      { binding: 2, resource: { buffer: bias } },
      { binding: 3, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('bias_add');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil((numTokens * dim) / 256));
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record dequantization (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} quantized - Quantized weight buffer
 * @param {number} numBlocks - Number of Q4_K blocks
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Dequantized output
 */
export async function recordDequantize(recorder, quantized, numBlocks, options = {}) {
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
  let workgroups;
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

/**
 * Record softmax operation (batched, no submit).
 * @param {CommandRecorder} recorder - Command recorder
 * @param {GPUBuffer} input - Input tensor
 * @param {number} axis - Axis to apply softmax (-1 for last)
 * @param {object} options - Additional options
 * @returns {GPUBuffer} Softmax output
 */
export async function recordSoftmax(recorder, input, axis, options = {}) {
  const device = recorder.device;
  const {
    batchSize = 1,
    seqLen = null,
    outputBuffer = null,
  } = options;

  const inferredSeqLen = seqLen || (input.size / (batchSize * 4));
  const pipeline = await createPipeline('softmax', 'default');

  // Output buffer
  const outputSize = batchSize * inferredSeqLen * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'softmax_output');

  // Uniform buffer
  const uniformData = new ArrayBuffer(12);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, batchSize, true);
  uniformView.setUint32(4, inferredSeqLen, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'softmax_uniforms');

  // Bind group
  const bindGroup = device.createBindGroup({
    label: 'softmax_bind_group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: output } },
    ],
  });

  // Record pass
  const pass = recorder.beginComputePass('softmax');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(batchSize);
  pass.end();

  setBufferDtype(output, 'f32');
  return output;
}
