/**
 * Type Casting Kernels
 *
 * Provides GPU-based type conversions:
 * - F32 to F16
 * - BF16 to F32
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import { createPipeline } from './utils.js';

/** Cast kernel options */
export interface CastOptions {
  outputBuffer?: GPUBuffer | null;
}

/**
 * Cast F32 buffer to F16 on GPU
 */
export async function castF32ToF16(
  input: GPUBuffer,
  numElements: number,
  options: CastOptions = {}
): Promise<GPUBuffer> {
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

  const encoder = device.createCommandEncoder({ label: 'cast_f32_to_f16_encoder' });
  const pass = encoder.beginComputePass({ label: 'cast_f32_to_f16_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(numElements / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  setBufferDtype(output, 'f16');
  return output;
}

/**
 * Convert BF16 buffer to F32 on GPU
 */
export async function runBF16ToF32(
  input: GPUBuffer,
  numElements: number,
  name: string = 'bf16_to_f32_output'
): Promise<GPUBuffer> {
  const device = getDevice();

  // Check for size limits (handle chunking if needed)
  const limits = device.limits;
  const maxBufferSize = limits.maxStorageBufferBindingSize;
  const outputSize = numElements * 4; // F32

  if (outputSize > maxBufferSize) {
    // Need to chunk - call chunked version
    return runBF16ToF32Chunked(input, numElements, name, maxBufferSize);
  }

  const pipeline = await createPipeline('bf16_to_f32', 'default');

  const output = acquireBuffer(outputSize, undefined, name);

  const uniformData = new ArrayBuffer(16);
  new DataView(uniformData).setUint32(0, numElements, true);

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

  const workgroups = Math.ceil(numElements / 256);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);

  uniformBuffer.destroy();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Convert BF16 to F32 in chunks (for large buffers)
 */
async function runBF16ToF32Chunked(
  input: GPUBuffer,
  numElements: number,
  name: string,
  maxBufferSize: number
): Promise<GPUBuffer> {
  const device = getDevice();
  const pipeline = await createPipeline('bf16_to_f32', 'default');

  // Calculate chunk size
  const maxElementsPerChunk = Math.floor(maxBufferSize / 4); // F32 output
  const numChunks = Math.ceil(numElements / maxElementsPerChunk);

  // Create full output buffer
  const outputSize = numElements * 4;
  const output = acquireBuffer(outputSize, undefined, name);

  console.log(`[BF16ToF32] Chunking: ${numElements} elements in ${numChunks} chunks`);

  for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
    const chunkStart = chunkIdx * maxElementsPerChunk;
    const chunkEnd = Math.min((chunkIdx + 1) * maxElementsPerChunk, numElements);
    const chunkSize = chunkEnd - chunkStart;

    const uniformData = new ArrayBuffer(16);
    const uniformView = new DataView(uniformData);
    uniformView.setUint32(0, chunkSize, true);
    uniformView.setUint32(4, chunkStart, true); // input offset
    uniformView.setUint32(8, chunkStart, true); // output offset

    const uniformBuffer = device.createBuffer({
      label: `bf16_to_f32_chunk${chunkIdx}_uniforms`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const bindGroup = device.createBindGroup({
      label: `bf16_to_f32_chunk${chunkIdx}_bind_group`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: output } },
      ],
    });

    const encoder = device.createCommandEncoder({ label: `bf16_to_f32_chunk${chunkIdx}_encoder` });
    const pass = encoder.beginComputePass({ label: `bf16_to_f32_chunk${chunkIdx}_pass` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);

    const workgroups = Math.ceil(chunkSize / 256);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    device.queue.submit([encoder.finish()]);

    uniformBuffer.destroy();
  }

  setBufferDtype(output, 'f32');
  return output;
}
