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
import { getBufferDtype, setBufferDtype, type BufferDType } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { getKernelConfig, createPipeline } from './utils.js';

/** Helper to narrow BufferDType to matmul-supported types */
function toMatmulDtype(dtype: BufferDType | null): 'f16' | 'f32' {
  return dtype === 'f16' ? 'f16' : 'f32';
}

/** Matmul kernel options */
export interface MatmulOptions {
  alpha?: number;
  outputBuffer?: GPUBuffer | null;
  transposeB?: boolean;
  aOffset?: number;
  bOffset?: number;
  cOffset?: number;
  outputDtype?: 'f16' | 'f32';
  aDtype?: 'f16' | 'f32' | null;
  bDtype?: 'f16' | 'f32' | null;
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
  let workgroupsX: number, workgroupsY: number;

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
