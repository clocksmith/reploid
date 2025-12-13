/**
 * embed.js - Token Embedding Operations
 *
 * Handles embedding lookup and scaling:
 * - GPU-accelerated gather operation
 * - Gemma embedding scaling (sqrt(hiddenSize))
 * - Debug validation for embedding outputs
 *
 * @module inference/pipeline/embed
 */

import { getDevice } from '../../gpu/device.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../../gpu/buffer-pool.js';
import { runGather } from '../../gpu/kernel-selector.js';

/**
 * Scale GPU buffer elements by a constant factor
 * @param {GPUBuffer} inputBuffer - Input buffer to scale
 * @param {number} scale - Scale factor
 * @param {number} count - Number of elements
 * @returns {Promise<GPUBuffer>} Scaled output buffer
 */
export async function scaleGPUBuffer(inputBuffer, scale, count) {
  const device = getDevice();
  if (!device) {
    throw new Error('GPU device not available for scaling');
  }

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

  // Simple scale shader
  const shaderCode = `
    struct Uniforms {
      scale: f32,
      count: u32,
    }
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    @group(0) @binding(1) var<storage, read> input: array<f32>;
    @group(0) @binding(2) var<storage, read_write> output: array<f32>;

    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
      let idx = global_id.x;
      if (idx >= uniforms.count) { return; }
      output[idx] = input[idx] * uniforms.scale;
    }
  `;

  const shaderModule = device.createShaderModule({ code: shaderCode });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: inputBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 256));
  pass.end();

  device.queue.submit([encoder.finish()]);
  uniformBuffer.destroy();

  return outputBuffer;
}

/**
 * Perform embedding lookup with optional Gemma scaling
 * @param {number[]} tokenIds - Token IDs to embed
 * @param {GPUBuffer} embedBuffer - Embedding matrix buffer [vocabSize, hiddenSize]
 * @param {object} config - Embedding configuration
 * @param {number} config.hiddenSize - Hidden size / embedding dimension
 * @param {number} config.vocabSize - Vocabulary size
 * @param {boolean} config.scaleEmbeddings - Whether to scale by sqrt(hiddenSize)
 * @param {boolean} [config.debug=false] - Enable debug logging
 * @returns {Promise<GPUBuffer>} Embedded tokens buffer [numTokens, hiddenSize]
 */
export async function embed(tokenIds, embedBuffer, config) {
  const { hiddenSize, vocabSize, scaleEmbeddings, debug = false } = config;
  const device = getDevice();
  const numTokens = tokenIds.length;

  if (!device) {
    throw new Error('GPU device not available for embedding');
  }

  if (debug) {
    console.log(`[DEBUG] embed: numTokens=${numTokens}, hiddenSize=${hiddenSize}, vocabSize=${vocabSize}`);
    console.log(`[DEBUG] embed tokenIds: [${tokenIds.join(', ')}]`);
  }

  // Create token ID buffer
  const tokenIdBuffer = acquireBuffer(Math.max(numTokens * 4, 256), undefined, 'embed_tokens');
  device.queue.writeBuffer(tokenIdBuffer, 0, new Uint32Array(tokenIds));

  // Run gather kernel
  const outputBuffer = await runGather(
    tokenIdBuffer,
    embedBuffer,
    numTokens,
    hiddenSize,
    vocabSize
  );

  releaseBuffer(tokenIdBuffer);

  // Debug: validate gather output
  if (debug) {
    const sample = await readBuffer(outputBuffer, Math.min(256, outputBuffer.size));
    const f32 = new Float32Array(sample);
    const min = Math.min(...f32);
    const max = Math.max(...f32);
    const zeros = f32.filter(x => x === 0).length;
    console.log(`[DEBUG] Gather output (before scale): min=${min.toFixed(4)}, max=${max.toFixed(4)}, zeros=${zeros}/${f32.length}`);
  }

  // Apply Gemma embedding scaling: multiply by sqrt(hiddenSize)
  if (scaleEmbeddings) {
    const scaleFactor = Math.sqrt(hiddenSize);
    if (debug) {
      console.log(`[DEBUG] Applying embedding scale factor: ${scaleFactor.toFixed(2)}`);
    }

    const scaledBuffer = await scaleGPUBuffer(outputBuffer, scaleFactor, numTokens * hiddenSize);
    releaseBuffer(outputBuffer);

    // Debug: validate scaled output
    if (debug) {
      const sample = await readBuffer(scaledBuffer, Math.min(256, scaledBuffer.size));
      const f32 = new Float32Array(sample);
      const hasNaN = f32.some(x => !Number.isFinite(x));
      if (hasNaN) {
        console.error('[Embed] NaN in scaled embedding output:', f32.slice(0, 8));
        throw new Error('[Embed] Scaled embedding contains NaN');
      }
      const min = Math.min(...f32);
      const max = Math.max(...f32);
      console.log(`[DEBUG] After embedding scale: min=${min.toFixed(4)}, max=${max.toFixed(4)}, first 4: [${Array.from(f32.slice(0, 4)).map(v => v.toFixed(4)).join(', ')}]`);
    }

    return scaledBuffer;
  }

  return outputBuffer;
}

/**
 * Validate embedding buffer contents (debug utility)
 * @param {GPUBuffer} buffer - Buffer to validate
 * @param {string} label - Label for logging
 * @param {number} numTokens - Number of tokens
 * @param {number} hiddenSize - Hidden size per token
 * @returns {Promise<object>} Validation results
 */
export async function validateEmbedding(buffer, label, numTokens, hiddenSize) {
  const device = getDevice();
  if (!device) return null;

  const sampleSize = Math.min(1024 * 4, buffer.size); // Read up to 1024 floats
  const sample = await readBuffer(buffer, sampleSize);
  const f32 = new Float32Array(sample);

  let min = Infinity, max = -Infinity, mean = 0;
  let zeros = 0, nanCount = 0, infCount = 0;

  for (let i = 0; i < f32.length; i++) {
    const v = f32[i];
    if (Number.isNaN(v)) { nanCount++; continue; }
    if (!Number.isFinite(v)) { infCount++; continue; }
    if (v === 0) zeros++;
    if (v < min) min = v;
    if (v > max) max = v;
    mean += v;
  }
  mean /= f32.length;

  console.log(`[DEBUG] ${label}: size=${buffer.size}, tokens=${numTokens}, hidden=${hiddenSize}`);
  console.log(`[DEBUG] ${label}: min=${min.toFixed(4)}, max=${max.toFixed(4)}, mean=${mean.toFixed(4)}`);
  console.log(`[DEBUG] ${label}: zeros=${zeros}/${f32.length}, NaN=${nanCount}, Inf=${infCount}`);
  console.log(`[DEBUG] ${label}: first 8 values: ${Array.from(f32.slice(0, 8)).map(v => v.toFixed(4)).join(', ')}`);

  return { min, max, mean, zeros, nanCount, infCount };
}
