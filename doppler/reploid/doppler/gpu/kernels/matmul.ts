/**
 * Matrix Multiplication Kernels
 *
 * Provides optimized matmul operations with support for:
 * - F16/F32 inputs and outputs
 * - Mixed precision (F16 weights, F32 activations)
 * - Tiled and naive variants
 * - Command recording for batched execution
 */

import { getDevice, getKernelCapabilities } from '../device.js';
import { getBufferDtype, setBufferDtype, getBufferLayout, isColumnMajorBuffer, type BufferDType } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { getKernelConfig, createPipeline } from './utils.js';

/** Matmul-supported buffer types (includes q4k for fused W4A16) */
type MatmulDtype = 'f16' | 'f32' | 'q4k';

/** Helper to narrow BufferDType to matmul-supported types */
function toMatmulDtype(dtype: BufferDType | null): MatmulDtype {
  if (dtype === 'f16') return 'f16';
  if (dtype === 'q4k') return 'q4k';
  return 'f32';
}

/** Matmul kernel options */
export interface MatmulOptions {
  alpha?: number;
  outputBuffer?: GPUBuffer | null;
  /**
   * Whether B matrix is stored transposed.
   * - true: B is [N,K] (SafeTensors/row-major), needs transpose
   * - false: B is [K,N] (column-major/pre-transposed), direct access
   * - 'auto': Auto-detect from buffer layout metadata (default)
   */
  transposeB?: boolean | 'auto';
  aOffset?: number;
  bOffset?: number;
  cOffset?: number;
  outputDtype?: 'f16' | 'f32';
  aDtype?: 'f16' | 'f32' | null;
  bDtype?: 'f16' | 'f32' | 'q4k' | null;
  preferF16?: boolean;
  useVec4?: boolean;
}

/**
 * Select the best matmul kernel variant
 */
export function selectMatmulKernel(options: MatmulOptions = {}): string {
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
 * Create bind group layout for matmul operation
 */
export function createMatmulBindGroupLayout(): GPUBindGroupLayout {
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
 * Run matrix multiplication
 */
export async function runMatmul(
  A: GPUBuffer,
  B: GPUBuffer,
  M: number,
  N: number,
  K: number,
  options: MatmulOptions = {}
): Promise<GPUBuffer> {
  const device = getDevice();
  const {
    alpha = 1.0,
    outputBuffer = null,
    transposeB: transposeBOption = true,  // Default: assume row-major (SafeTensors)
    aOffset = 0,
    bOffset = 0,
    cOffset = 0,
  } = options;

  // Resolve transposeB: 'auto' checks buffer layout metadata
  // Column-major (pre-transposed) buffers don't need transpose
  // Row-major (default SafeTensors) buffers need transpose
  let transposeB: boolean;
  if (transposeBOption === 'auto') {
    transposeB = !isColumnMajorBuffer(B);  // Column-major = no transpose needed
  } else {
    transposeB = transposeBOption;
  }

  // Validate dimensions
  if (!Number.isFinite(M) || !Number.isFinite(N) || !Number.isFinite(K)) {
    throw new Error(`[runMatmul] Invalid dimensions: M=${M}, N=${N}, K=${K}`);
  }
  if (M <= 0 || N <= 0 || K <= 0) {
    throw new Error(`[runMatmul] Dimensions must be positive: M=${M}, N=${N}, K=${K}`);
  }

  // Infer dtypes for safe kernel selection.
  const rawADtype = getBufferDtype(A);
  const rawBDtype = getBufferDtype(B);
  const requestedOutputDtype = options.outputDtype || 'f32';

  // Warn if B buffer dtype is unknown - this can cause wrong kernel selection
  if (!rawBDtype && M <= 2) {
    console.warn(`[runMatmul] B buffer dtype unknown! size=${B.size}, M=${M}, N=${N}, K=${K}. Assuming f32.`);
  }
  // Narrow to matmul-supported dtypes
  const aDtype = toMatmulDtype(rawADtype);
  const bDtype = toMatmulDtype(rawBDtype);

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

  // Validate B buffer size - Q4_K uses 144 bytes per 256-element block
  let bBindingSize: number;
  let bRequired: number;
  const QK_K = 256;  // Elements per Q4_K super-block
  const Q4_K_BLOCK_SIZE = 144;  // Bytes per Q4_K block

  if (bDtype === 'q4k') {
    // Q4_K: N rows * ceil(K/256) blocks per row * 144 bytes per block
    const numBlocksPerRow = Math.ceil(K / QK_K);
    bBindingSize = Math.ceil((N * numBlocksPerRow * Q4_K_BLOCK_SIZE) / 4) * 4;
    bRequired = bOffset + bBindingSize;
  } else {
    const bBytesPerElem = bDtype === 'f16' ? 2 : 4;
    const bElements = transposeB ? N * K : K * N;
    bBindingSize = Math.ceil((bElements * bBytesPerElem) / 4) * 4;
    bRequired = bOffset + bBindingSize;
  }
  if (B.size < bRequired) {
    throw new Error(`[runMatmul] B buffer too small: ${B.size} < ${bRequired} (N=${N}, K=${K}, bDtype=${bDtype}, transposeB=${transposeB})`);
  }

  // Select kernel - detect q4k for fused W4A16, or use optimized GEMV for f16 weights
  const capabilities = getKernelCapabilities();
  let variant: string;
  let useQ4KFused = false;
  let useGemv = false;

  if (bDtype === 'q4k') {
    // Fused Q4_K matmul: dequant + multiply in one pass (2-3x speedup)
    useQ4KFused = true;
    variant = M === 1 ? 'q4_fused' : 'q4_fused_batched';
  } else {
    // Select kernel for dequantized weights (bDtype is f16/f32 here, not q4k)
    variant = selectMatmulKernel({
      ...options,
      aDtype: aDtype === 'q4k' ? 'f32' : aDtype,  // activations are never q4k in practice
      bDtype: bDtype as 'f16' | 'f32',  // q4k case handled above
      outputDtype: requestedOutputDtype,
    });

    // Use optimized GEMV kernel for M=1 decode with f16 weights (transposeB required)
    // GEMV uses shared memory for A vector, avoiding 256x redundant global reads
    // Fixed: shared memory sizing for small subgroup sizes (sg_size >= 4)
    useGemv = M === 1 && bDtype === 'f16' && aDtype === 'f32' && transposeB;
    if (useGemv) {
      // Prefer subgroup-optimized GEMV when available (1.5x faster)
      if (capabilities.hasSubgroups) {
        variant = 'gemv_subgroup';
      } else {
        variant = 'gemv';
      }
    } else if (M === 1 && bDtype === 'f16' && aDtype === 'f32') {
      // Fallback to naive for non-transposed (rare case)
      variant = 'f16w_f32a_naive';
    }
  }

  // Debug: Log kernel selection for large matmuls (lm_head projection)
  if (N > 100000) {
    console.log(`[Pipeline] MATMUL_LARGE: N=${N}, variant=${variant}, aDtype=${aDtype}, bDtype=${bDtype}, transposeB=${transposeB}`);
  }

  const config = getKernelConfig('matmul', variant);
  const pipeline = await createPipeline('matmul', variant);

  // Determine element size based on kernel (q4_fused outputs f32)
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

  // Calculate workgroup dispatch dimensions
  // WebGPU limit: 65535 workgroups per dimension
  const MAX_WORKGROUPS = 65535;
  let workgroupsX: number, workgroupsY: number;

  // Pre-calculate workgroups for GEMV variants to check for 2D dispatch need
  let gemvWorkgroupsX = 0;
  if (useGemv) {
    if (variant === 'gemv_subgroup') {
      gemvWorkgroupsX = Math.ceil(N / 4);  // 4 columns per workgroup
    } else {
      gemvWorkgroupsX = N;  // 1 column per workgroup
    }
  }

  // Create uniform buffer
  // Standard kernels: (M, N, K, alpha, transposeB) - 20 bytes
  // GEMV subgroup: (M, N, K, alpha, transposeB, workgroups_x) - 24 bytes
  // Q4_K fused: (M, N, K, alpha, num_blocks_per_row) - 20 bytes
  const needsWorkgroupsX = variant === 'gemv_subgroup';
  const uniformSize = needsWorkgroupsX ? 24 : 20;
  const uniformData = new ArrayBuffer(uniformSize);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, M, true);
  uniformView.setUint32(4, N, true);
  uniformView.setUint32(8, K, true);
  uniformView.setFloat32(12, alpha, true);
  if (useQ4KFused) {
    const numBlocksPerRow = Math.ceil(K / QK_K);
    uniformView.setUint32(16, numBlocksPerRow, true);
  } else {
    uniformView.setUint32(16, transposeB ? 1 : 0, true);
  }

  // For gemv_subgroup, add workgroups_x for 2D dispatch support
  if (needsWorkgroupsX) {
    // Use 2D dispatch if exceeds limit
    if (gemvWorkgroupsX > MAX_WORKGROUPS) {
      workgroupsX = MAX_WORKGROUPS;
      workgroupsY = Math.ceil(gemvWorkgroupsX / MAX_WORKGROUPS);
    } else {
      workgroupsX = gemvWorkgroupsX;
      workgroupsY = 1;
    }
    uniformView.setUint32(20, workgroupsX, true);
  }

  const uniformBuffer = device.createBuffer({
    label: 'matmul_uniforms',
    size: uniformSize,
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

  // Dispatch based on kernel variant
  // Note: workgroupsX/Y for gemv_subgroup already calculated above (supports 2D dispatch)
  if (useQ4KFused) {
    if (variant === 'q4_fused') {
      // Q4_K fused GEMV: one workgroup per output column
      workgroupsX = N;
      workgroupsY = 1;
    } else {
      // Q4_K fused batched: 2D dispatch with TILE_M=4, TILE_N=4
      const TILE_M = 4, TILE_N = 4;
      workgroupsX = Math.ceil(N / TILE_N);
      workgroupsY = Math.ceil(M / TILE_M);
    }
  } else if (useGemv) {
    if (variant === 'gemv_subgroup') {
      // workgroupsX/Y already computed above with 2D dispatch support
    } else {
      // Original GEMV: one workgroup per output column
      workgroupsX = N;
      workgroupsY = 1;
    }
  } else if (variant === 'f16w_f32a_naive') {
    // Naive kernel: one thread per output
    workgroupsX = Math.ceil(N / wgX);
    workgroupsY = 1;
  } else {
    // Tiled kernel uses 2D dispatch (gid.x = row, gid.y = column)
    workgroupsX = Math.ceil(M / wgX);
    workgroupsY = Math.ceil(N / wgY);
  }
  pass.dispatchWorkgroups(workgroupsX!, workgroupsY!);
  pass.end();

  device.queue.submit([encoder.finish()]);

  // Clean up temporary buffers
  uniformBuffer.destroy();

  setBufferDtype(C, actualOutputDtype);
  return C;
}

/**
 * Record matrix multiplication (batched, no submit)
 */
export async function recordMatmul(
  recorder: CommandRecorder,
  A: GPUBuffer,
  B: GPUBuffer,
  M: number,
  N: number,
  K: number,
  options: MatmulOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    alpha = 1.0,
    outputBuffer = null,
    transposeB: transposeBOption = true,  // Default: assume row-major (SafeTensors)
    aOffset = 0,
    bOffset = 0,
    cOffset = 0,
  } = options;

  // Resolve transposeB: 'auto' checks buffer layout metadata
  let transposeB: boolean;
  if (transposeBOption === 'auto') {
    transposeB = !isColumnMajorBuffer(B);  // Column-major = no transpose needed
  } else {
    transposeB = transposeBOption;
  }

  // Validate dimensions
  if (!Number.isFinite(M) || !Number.isFinite(N) || !Number.isFinite(K)) {
    throw new Error(`[recordMatmul] Invalid dimensions: M=${M}, N=${N}, K=${K}`);
  }
  if (M <= 0 || N <= 0 || K <= 0) {
    throw new Error(`[recordMatmul] Dimensions must be positive: M=${M}, N=${N}, K=${K}`);
  }

  // Infer dtypes (narrowed to matmul-supported types)
  const aDtype = toMatmulDtype(getBufferDtype(A));
  const bDtype = toMatmulDtype(getBufferDtype(B));
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

  // Validate B buffer size - Q4_K uses 144 bytes per 256-element block
  const QK_K = 256;  // Elements per Q4_K super-block
  const Q4_K_BLOCK_SIZE = 144;  // Bytes per Q4_K block
  let bBindingSize: number;

  if (bDtype === 'q4k') {
    // Q4_K: N rows * ceil(K/256) blocks per row * 144 bytes per block
    const numBlocksPerRow = Math.ceil(K / QK_K);
    bBindingSize = Math.ceil((N * numBlocksPerRow * Q4_K_BLOCK_SIZE) / 4) * 4;
  } else {
    const bBytesPerElem = bDtype === 'f16' ? 2 : 4;
    const bElements = transposeB ? N * K : K * N;
    bBindingSize = Math.ceil((bElements * bBytesPerElem) / 4) * 4;
  }
  if (B.size < bOffset + bBindingSize) {
    throw new Error(`[recordMatmul] B buffer too small: ${B.size} < ${bOffset + bBindingSize} (N=${N}, K=${K}, bDtype=${bDtype})`);
  }

  // Select kernel - detect q4k for fused W4A16, or use optimized GEMV for f16 weights
  const capabilities = getKernelCapabilities();
  let variant: string;
  let useQ4KFused = false;
  let useGemv = false;

  if (bDtype === 'q4k') {
    // Fused Q4_K matmul: dequant + multiply in one pass
    useQ4KFused = true;
    variant = M === 1 ? 'q4_fused' : 'q4_fused_batched';
  } else {
    // Select kernel for dequantized weights
    const effectiveBDtype = bDtype as 'f16' | 'f32';
    variant = selectMatmulKernel({
      ...options,
      aDtype: aDtype === 'q4k' ? 'f32' : aDtype,
      bDtype: effectiveBDtype,
      outputDtype: requestedOutputDtype,
    });
    useGemv = M === 1 && effectiveBDtype === 'f16' && aDtype === 'f32' && transposeB;
    if (useGemv) {
      // Prefer subgroup-optimized GEMV when available (1.5x faster)
      variant = capabilities.hasSubgroups ? 'gemv_subgroup' : 'gemv';
    } else if (M === 1 && bDtype === 'f16' && aDtype === 'f32') {
      variant = 'f16w_f32a_naive';
    }
  }

  const config = getKernelConfig('matmul', variant);
  const pipeline = await createPipeline('matmul', variant);

  // Output buffer (q4_fused outputs f32)
  const outputsF16 = variant === 'f16' || variant === 'f16_vec4';
  const elementSize = outputsF16 ? 2 : 4;
  const actualOutputDtype = outputsF16 ? 'f16' : 'f32';
  const outputSize = M * N * elementSize;
  const cBindingSize = Math.ceil(outputSize / 4) * 4;

  const C = outputBuffer || acquireBuffer(outputSize, undefined, 'matmul_output');

  // Calculate workgroup dispatch dimensions for GEMV
  // WebGPU limit: 65535 workgroups per dimension
  const MAX_WORKGROUPS = 65535;
  let workgroupsX: number, workgroupsY: number;

  // Pre-calculate workgroups for GEMV variants to check for 2D dispatch need
  let gemvWorkgroupsX = 0;
  if (useGemv) {
    if (variant === 'gemv_subgroup') {
      gemvWorkgroupsX = Math.ceil(N / 4);  // 4 columns per workgroup
    } else {
      gemvWorkgroupsX = N;  // 1 column per workgroup
    }
  }

  // Create uniform buffer (tracked by recorder for cleanup)
  // Standard kernels: (M, N, K, alpha, transposeB) - 20 bytes
  // GEMV subgroup: (M, N, K, alpha, transposeB, workgroups_x) - 24 bytes
  // Q4_K fused: (M, N, K, alpha, num_blocks_per_row) - 20 bytes
  const needsWorkgroupsX = variant === 'gemv_subgroup';
  const uniformSize = needsWorkgroupsX ? 24 : 20;
  const uniformData = new ArrayBuffer(uniformSize);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, M, true);
  uniformView.setUint32(4, N, true);
  uniformView.setUint32(8, K, true);
  uniformView.setFloat32(12, alpha, true);
  if (useQ4KFused) {
    const numBlocksPerRow = Math.ceil(K / QK_K);
    uniformView.setUint32(16, numBlocksPerRow, true);
  } else {
    uniformView.setUint32(16, transposeB ? 1 : 0, true);
  }

  // For gemv_subgroup, add workgroups_x for 2D dispatch support
  if (needsWorkgroupsX) {
    // Use 2D dispatch if exceeds limit
    if (gemvWorkgroupsX > MAX_WORKGROUPS) {
      workgroupsX = MAX_WORKGROUPS;
      workgroupsY = Math.ceil(gemvWorkgroupsX / MAX_WORKGROUPS);
    } else {
      workgroupsX = gemvWorkgroupsX;
      workgroupsY = 1;
    }
    uniformView.setUint32(20, workgroupsX, true);
  }

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

  // Dispatch based on kernel variant
  // Note: workgroupsX/Y for gemv_subgroup already calculated above (supports 2D dispatch)
  if (useQ4KFused) {
    if (variant === 'q4_fused') {
      // Q4_K fused GEMV: one workgroup per output column
      workgroupsX = N;
      workgroupsY = 1;
    } else {
      // Q4_K fused batched: 2D dispatch with TILE_M=4, TILE_N=4
      const TILE_M = 4, TILE_N = 4;
      workgroupsX = Math.ceil(N / TILE_N);
      workgroupsY = Math.ceil(M / TILE_M);
    }
  } else if (useGemv) {
    if (variant === 'gemv_subgroup') {
      // workgroupsX/Y already computed above with 2D dispatch support
    } else {
      // Original GEMV: one workgroup per output column
      workgroupsX = N;
      workgroupsY = 1;
    }
  } else if (variant === 'f16w_f32a_naive') {
    workgroupsX = Math.ceil(N / wgX);
    workgroupsY = 1;
  } else {
    workgroupsX = Math.ceil(M / wgX);
    workgroupsY = Math.ceil(N / wgY);
  }
  pass.dispatchWorkgroups(workgroupsX, workgroupsY);
  pass.end();

  setBufferDtype(C, actualOutputDtype);
  return C;
}
