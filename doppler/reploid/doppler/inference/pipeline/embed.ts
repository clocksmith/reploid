/**
 * Token embedding lookup with optional Gemma scaling.
 */

import { getDevice } from '../../gpu/device.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../../gpu/buffer-pool.js';
import { runGather } from '../../gpu/kernel-selector.js';

export interface EmbedConfig {
  hiddenSize: number;
  vocabSize: number;
  scaleEmbeddings: boolean;
  debug?: boolean;
}

export interface ValidationResult {
  min: number;
  max: number;
  mean: number;
  zeros: number;
  nanCount: number;
  infCount: number;
}

const scaleShaderCode = `
  struct Uniforms { scale: f32, count: u32 }
  @group(0) @binding(0) var<uniform> uniforms: Uniforms;
  @group(0) @binding(1) var<storage, read> input: array<f32>;
  @group(0) @binding(2) var<storage, read_write> output: array<f32>;

  @compute @workgroup_size(256)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= uniforms.count) { return; }
    output[gid.x] = input[gid.x] * uniforms.scale;
  }
`;

let scalePipeline: GPUComputePipeline | null = null;

export async function scaleGPUBuffer(
  inputBuffer: GPUBuffer,
  scale: number,
  count: number
): Promise<GPUBuffer> {
  const device = getDevice();
  if (!device) throw new Error('GPU device not available');

  const outputBuffer = acquireBuffer(count * 4, undefined, 'scaled_embed');

  const uniformData = new ArrayBuffer(8);
  const uniformView = new DataView(uniformData);
  uniformView.setFloat32(0, scale, true);
  uniformView.setUint32(4, count, true);

  const uniformBuffer = device.createBuffer({
    label: 'scale_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Cache pipeline
  if (!scalePipeline) {
    const shaderModule = device.createShaderModule({ code: scaleShaderCode });
    scalePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
  }

  const bindGroup = device.createBindGroup({
    layout: scalePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: inputBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(scalePipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 256));
  pass.end();

  device.queue.submit([encoder.finish()]);
  uniformBuffer.destroy();

  return outputBuffer;
}

export async function embed(
  tokenIds: number[],
  embedBuffer: GPUBuffer,
  config: EmbedConfig
): Promise<GPUBuffer> {
  const { hiddenSize, vocabSize, scaleEmbeddings, debug = false } = config;
  const device = getDevice();
  const numTokens = tokenIds.length;

  if (!device) throw new Error('GPU device not available');

  if (debug) {
    console.log(`[Embed] tokens=${numTokens}, hidden=${hiddenSize}, vocab=${vocabSize}`);
  }

  const tokenIdBuffer = acquireBuffer(Math.max(numTokens * 4, 256), undefined, 'embed_tokens');
  device.queue.writeBuffer(tokenIdBuffer, 0, new Uint32Array(tokenIds));

  const outputBuffer = await runGather(tokenIdBuffer, embedBuffer, numTokens, hiddenSize, vocabSize);
  releaseBuffer(tokenIdBuffer);

  if (!scaleEmbeddings) return outputBuffer;

  // Apply Gemma scaling: sqrt(hiddenSize)
  const scaleFactor = Math.sqrt(hiddenSize);
  const scaledBuffer = await scaleGPUBuffer(outputBuffer, scaleFactor, numTokens * hiddenSize);
  releaseBuffer(outputBuffer);

  if (debug) {
    const sample = await readBuffer(scaledBuffer, Math.min(256, scaledBuffer.size));
    const f32 = new Float32Array(sample);
    if (f32.some(x => !Number.isFinite(x))) {
      throw new Error('[Embed] Scaled embedding contains NaN/Inf');
    }
  }

  return scaledBuffer;
}

export async function validateEmbedding(
  buffer: GPUBuffer,
  label: string,
  numTokens: number,
  hiddenSize: number
): Promise<ValidationResult | null> {
  const device = getDevice();
  if (!device) return null;

  const sampleSize = Math.min(1024 * 4, buffer.size);
  const sample = await readBuffer(buffer, sampleSize);
  const f32 = new Float32Array(sample);

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let zeros = 0;
  let nanCount = 0;
  let infCount = 0;

  for (let i = 0; i < f32.length; i++) {
    const v = f32[i];
    if (Number.isNaN(v)) {
      nanCount++;
    } else if (!Number.isFinite(v)) {
      infCount++;
    } else {
      if (v === 0) zeros++;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
  }

  const mean = sum / f32.length;

  console.log(`[${label}] tokens=${numTokens}, hidden=${hiddenSize}`);
  console.log(`[${label}] min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}`);
  console.log(`[${label}] zeros=${zeros}/${f32.length}, NaN=${nanCount}, Inf=${infCount}`);

  return { min, max, mean, zeros, nanCount, infCount };
}
