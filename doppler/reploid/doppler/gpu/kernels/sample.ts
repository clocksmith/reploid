/**
 * GPU-Side Sampling Kernel
 *
 * Performs sampling entirely on GPU, reducing readback from ~1MB to 4 bytes.
 * Supports:
 * - Temperature scaling
 * - Top-k selection
 * - Softmax
 * - Multinomial sampling
 * - Greedy argmax (for temperature=0)
 */

import { getDevice } from '../device.js';
import { acquireBuffer, releaseBuffer } from '../buffer-pool.js';
import { loadShaderSource } from './utils.js';
import type { CommandRecorder } from '../command-recorder.js';

export interface SampleOptions {
  temperature?: number;
  topK?: number;
  randomSeed?: number;
}

export interface SampleResult {
  tokenId: number;
  gpuBuffer: GPUBuffer;  // Buffer containing the token ID
}

// Cached bind group layout and pipelines for sample kernels
let sampleBindGroupLayout: GPUBindGroupLayout | null = null;
let samplePipelineLayout: GPUPipelineLayout | null = null;
const samplePipelines: Map<string, GPUComputePipeline> = new Map();

/**
 * Get or create explicit bind group layout for sample kernels.
 * Required because different entry points use different binding subsets,
 * so layout: 'auto' fails to include all bindings.
 */
function getSampleBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  if (sampleBindGroupLayout) return sampleBindGroupLayout;

  sampleBindGroupLayout = device.createBindGroupLayout({
    label: 'sample_bind_group_layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  return sampleBindGroupLayout;
}

/**
 * Get or create explicit pipeline layout for sample kernels.
 */
function getSamplePipelineLayout(device: GPUDevice): GPUPipelineLayout {
  if (samplePipelineLayout) return samplePipelineLayout;

  samplePipelineLayout = device.createPipelineLayout({
    label: 'sample_pipeline_layout',
    bindGroupLayouts: [getSampleBindGroupLayout(device)],
  });

  return samplePipelineLayout;
}

/**
 * Create sample pipeline with explicit layout.
 */
async function createSamplePipeline(device: GPUDevice, entryPoint: string): Promise<GPUComputePipeline> {
  const cached = samplePipelines.get(entryPoint);
  if (cached) return cached;

  // Load shader using shared utility (handles path and caching)
  const code = await loadShaderSource('sample.wgsl');

  const shaderModule = device.createShaderModule({
    label: `sample_shader_${entryPoint}`,
    code,
  });

  const pipeline = await device.createComputePipelineAsync({
    label: `sample_pipeline_${entryPoint}`,
    layout: getSamplePipelineLayout(device),
    compute: {
      module: shaderModule,
      entryPoint,
    },
  });

  samplePipelines.set(entryPoint, pipeline);
  return pipeline;
}

/**
 * Run GPU-side argmax (greedy decoding)
 * Returns the token ID with highest logit
 */
export async function runArgmax(
  logits: GPUBuffer,
  vocabSize: number
): Promise<number> {
  const device = getDevice();
  if (!device) throw new Error('GPU device not initialized');

  // Pipelines with explicit layout
  const argmaxPipeline = await createSamplePipeline(device, 'argmax');
  const reducePipeline = await createSamplePipeline(device, 'argmax_reduce');

  // Workgroups for first pass
  const numWorkgroups = Math.min(256, Math.ceil(vocabSize / 256));

  // Intermediate buffers
  const tempLogits = acquireBuffer(256 * 4, undefined, 'argmax_temp_logits');
  const tempIndices = acquireBuffer(256 * 4, undefined, 'argmax_temp_indices');
  const outputBuffer = acquireBuffer(4, undefined, 'argmax_output');

  // Uniforms
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, vocabSize, true);  // vocabSize
  uniformView.setUint32(4, 1, true);           // topK (unused for argmax)
  uniformView.setFloat32(8, 1.0, true);        // temperature (unused)
  uniformView.setFloat32(12, 0.0, true);       // randomValue (unused)

  const uniformBuffer = device.createBuffer({
    label: 'argmax_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Bind groups with explicit layout (auto-layout fails for multi-entry-point shaders)
  const bindGroupLayout = getSampleBindGroupLayout(device);
  const argmaxBindGroup = device.createBindGroup({
    label: 'argmax_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: tempIndices } },
      { binding: 4, resource: { buffer: tempLogits } },
    ],
  });

  const reduceBindGroup = device.createBindGroup({
    label: 'argmax_reduce_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },  // Shader may not use, but layout requires
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: tempIndices } },
      { binding: 4, resource: { buffer: tempLogits } },
    ],
  });

  // Execute
  const encoder = device.createCommandEncoder({ label: 'argmax_encoder' });

  // Pass 1: Find max per workgroup
  const pass1 = encoder.beginComputePass({ label: 'argmax_pass1' });
  pass1.setPipeline(argmaxPipeline);
  pass1.setBindGroup(0, argmaxBindGroup);
  pass1.dispatchWorkgroups(numWorkgroups);
  pass1.end();

  // Pass 2: Reduce workgroup results
  const pass2 = encoder.beginComputePass({ label: 'argmax_pass2' });
  pass2.setPipeline(reducePipeline);
  pass2.setBindGroup(0, reduceBindGroup);
  pass2.dispatchWorkgroups(1);
  pass2.end();

  device.queue.submit([encoder.finish()]);

  // Read result
  const stagingBuffer = device.createBuffer({
    label: 'argmax_staging',
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const copyEncoder = device.createCommandEncoder({ label: 'argmax_copy' });
  copyEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, 4);
  device.queue.submit([copyEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const tokenId = new Uint32Array(stagingBuffer.getMappedRange())[0];
  stagingBuffer.unmap();

  // Cleanup
  stagingBuffer.destroy();
  uniformBuffer.destroy();
  releaseBuffer(tempLogits);
  releaseBuffer(tempIndices);
  releaseBuffer(outputBuffer);

  return tokenId;
}

/**
 * Run GPU-side top-k sampling
 * Applies temperature, selects top-k, applies softmax, samples
 */
export async function runGPUSample(
  logits: GPUBuffer,
  vocabSize: number,
  options: SampleOptions = {}
): Promise<number> {
  const {
    temperature = 1.0,
    topK = 40,
    randomSeed,
  } = options;

  // For temperature=0 or very low, use greedy argmax
  if (temperature < 0.01) {
    return runArgmax(logits, vocabSize);
  }

  const device = getDevice();
  if (!device) throw new Error('GPU device not initialized');

  // Generate random value for sampling
  const randomValue = randomSeed !== undefined
    ? seededRandom(randomSeed)
    : Math.random();

  // Get pipelines with explicit layout
  const phase1Pipeline = await createSamplePipeline(device, 'find_topk_phase1');
  const phase2Pipeline = await createSamplePipeline(device, 'find_topk_phase2');
  const phase3Pipeline = await createSamplePipeline(device, 'softmax_and_sample');

  // Workgroups for phase 1
  const numWorkgroups = Math.min(256, Math.ceil(vocabSize / 256));

  // Buffers
  const topkLogits = acquireBuffer(256 * 4, undefined, 'topk_logits');
  const topkIndices = acquireBuffer(256 * 4, undefined, 'topk_indices');
  const outputBuffer = acquireBuffer(4, undefined, 'sample_output');

  // Uniforms
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, vocabSize, true);
  uniformView.setUint32(4, topK, true);
  uniformView.setFloat32(8, temperature, true);
  uniformView.setFloat32(12, randomValue, true);

  const uniformBuffer = device.createBuffer({
    label: 'sample_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Bind group with explicit layout (auto-layout fails for multi-entry-point shaders)
  const bindGroupLayout = getSampleBindGroupLayout(device);
  const bindGroup = device.createBindGroup({
    label: 'sample_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: topkIndices } },
      { binding: 4, resource: { buffer: topkLogits } },
    ],
  });

  // Execute all phases
  const encoder = device.createCommandEncoder({ label: 'sample_encoder' });

  // Phase 1: Find per-workgroup top values
  const pass1 = encoder.beginComputePass({ label: 'sample_phase1' });
  pass1.setPipeline(phase1Pipeline);
  pass1.setBindGroup(0, bindGroup);
  pass1.dispatchWorkgroups(numWorkgroups);
  pass1.end();

  // Phase 2: Merge and select top-k
  const pass2 = encoder.beginComputePass({ label: 'sample_phase2' });
  pass2.setPipeline(phase2Pipeline);
  pass2.setBindGroup(0, bindGroup);
  pass2.dispatchWorkgroups(1);
  pass2.end();

  // Phase 3: Softmax and sample
  const pass3 = encoder.beginComputePass({ label: 'sample_phase3' });
  pass3.setPipeline(phase3Pipeline);
  pass3.setBindGroup(0, bindGroup);
  pass3.dispatchWorkgroups(1);
  pass3.end();

  device.queue.submit([encoder.finish()]);

  // Read result (just 4 bytes!)
  const stagingBuffer = device.createBuffer({
    label: 'sample_staging',
    size: 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const copyEncoder = device.createCommandEncoder({ label: 'sample_copy' });
  copyEncoder.copyBufferToBuffer(outputBuffer, 0, stagingBuffer, 0, 4);
  device.queue.submit([copyEncoder.finish()]);

  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const tokenId = new Uint32Array(stagingBuffer.getMappedRange())[0];
  stagingBuffer.unmap();

  // Cleanup
  stagingBuffer.destroy();
  uniformBuffer.destroy();
  releaseBuffer(topkLogits);
  releaseBuffer(topkIndices);
  releaseBuffer(outputBuffer);

  return tokenId;
}

/**
 * Record GPU argmax (batched, no submit)
 * Returns buffer containing token ID
 */
export async function recordArgmax(
  recorder: CommandRecorder,
  logits: GPUBuffer,
  vocabSize: number
): Promise<GPUBuffer> {
  const device = recorder.device;

  // Pipelines with explicit layout
  const argmaxPipeline = await createSamplePipeline(device, 'argmax');
  const reducePipeline = await createSamplePipeline(device, 'argmax_reduce');

  const numWorkgroups = Math.min(256, Math.ceil(vocabSize / 256));

  // Buffers
  const tempLogits = acquireBuffer(256 * 4, undefined, 'argmax_temp_logits');
  const tempIndices = acquireBuffer(256 * 4, undefined, 'argmax_temp_indices');
  const outputBuffer = acquireBuffer(4, undefined, 'argmax_output');

  // Uniforms
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, vocabSize, true);
  uniformView.setUint32(4, 1, true);
  uniformView.setFloat32(8, 1.0, true);
  uniformView.setFloat32(12, 0.0, true);

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'argmax_uniforms');

  // Bind groups with explicit layout
  const bindGroupLayout = getSampleBindGroupLayout(device);
  const bindGroup = device.createBindGroup({
    label: 'argmax_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: tempIndices } },
      { binding: 4, resource: { buffer: tempLogits } },
    ],
  });

  // Pass 1
  const pass1 = recorder.beginComputePass('argmax_phase1');
  pass1.setPipeline(argmaxPipeline);
  pass1.setBindGroup(0, bindGroup);
  pass1.dispatchWorkgroups(numWorkgroups);
  pass1.end();

  // Pass 2 (reuse same bind group since layout is the same)
  const reduceBindGroup = device.createBindGroup({
    label: 'argmax_reduce_bind_group',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: logits } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: tempIndices } },
      { binding: 4, resource: { buffer: tempLogits } },
    ],
  });

  const pass2 = recorder.beginComputePass('argmax_phase2');
  pass2.setPipeline(reducePipeline);
  pass2.setBindGroup(0, reduceBindGroup);
  pass2.dispatchWorkgroups(1);
  pass2.end();

  // Schedule cleanup of temp buffers after submit
  // (These will be released by caller after reading output)

  return outputBuffer;
}

/**
 * Simple seeded random number generator
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Check if GPU sampling is available
 */
export function isGPUSamplingAvailable(): boolean {
  return getDevice() !== null;
}
