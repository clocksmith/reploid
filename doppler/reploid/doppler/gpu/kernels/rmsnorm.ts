/**
 * RMSNorm Kernels
 *
 * Provides RMS normalization with optional residual connection.
 */

import { getDevice } from '../device.js';
import { setBufferDtype } from '../buffer-dtypes.js';
import { acquireBuffer } from '../buffer-pool.js';
import type { CommandRecorder } from '../command-recorder.js';
import { getKernelConfig, createPipeline } from './utils.js';

/** RMSNorm kernel options */
export interface RMSNormOptions {
  batchSize?: number;
  hiddenSize?: number | null;
  residual?: GPUBuffer | null;
  outputBuffer?: GPUBuffer | null;
}

/**
 * Select RMSNorm kernel variant
 */
export function selectRMSNormKernel(options: RMSNormOptions = {}): string {
  const { residual = null, hiddenSize = null } = options;
  if (residual) {
    return 'residual';
  } else if (hiddenSize !== null && hiddenSize <= 256) {
    return 'small';
  }
  return 'default';
}

/**
 * Run RMSNorm
 */
// Debug counter to identify RMSNorm calls
let rmsNormCallCount = 0;

export async function runRMSNorm(
  input: GPUBuffer,
  weight: GPUBuffer,
  eps: number = 1e-5,
  options: RMSNormOptions = {}
): Promise<GPUBuffer> {
  const callId = rmsNormCallCount++;
  const device = getDevice();
  const { batchSize = 1, hiddenSize, residual = null, outputBuffer = null } = options;

  // Select variant
  let variant = 'default';
  if (residual) {
    variant = 'residual';
  } else if (hiddenSize && hiddenSize <= 256) {
    variant = 'small';
  }

  const config = getKernelConfig('rmsnorm', variant);
  const pipeline = await createPipeline('rmsnorm', variant);

  // Create output buffer if not provided
  const inferredHiddenSize = hiddenSize || (weight.size / 4);
  const outputSize = batchSize * inferredHiddenSize * 4;
  const output = outputBuffer || acquireBuffer(outputSize, undefined, 'rmsnorm_output');

  // Create uniform buffer
  const uniformData = new ArrayBuffer(16);
  const uniformView = new DataView(uniformData);
  uniformView.setUint32(0, inferredHiddenSize, true);
  uniformView.setUint32(4, batchSize, true);
  uniformView.setFloat32(8, eps, true);
  uniformView.setUint32(12, 0, true); // hasResidual = 0

  const uniformBuffer = device.createBuffer({
    label: 'rmsnorm_uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  // Shader expects 5 bindings - create placeholder when no residual (uniform flags it as unused)
  const residualBuffer = residual || device.createBuffer({
    label: 'rmsnorm_residual_placeholder',
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

  // Debug: log RMSNorm parameters
  console.log(`[RMSNorm#${callId}] variant=${variant}, batchSize=${batchSize}, hiddenSize=${inferredHiddenSize}, weightSize=${weight.size / 4}`);

  // Debug: verify input buffer has data before kernel dispatch
  if (batchSize <= 4) {
    try {
      await device.queue.onSubmittedWorkDone();
      const debugSize = Math.min(64, input.size);
      const debugStaging = device.createBuffer({ size: debugSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const debugEnc = device.createCommandEncoder();
      debugEnc.copyBufferToBuffer(input, 0, debugStaging, 0, debugSize);
      device.queue.submit([debugEnc.finish()]);
      await debugStaging.mapAsync(GPUMapMode.READ);
      const debugData = new Float32Array(debugStaging.getMappedRange().slice(0));
      debugStaging.unmap();
      debugStaging.destroy();
      const maxAbs = Math.max(...Array.from(debugData).map(x => Math.abs(x)));
      const nonZero = Array.from(debugData).filter(x => x !== 0).length;
      console.log(`[RMSNorm#${callId}] BEFORE_DISPATCH: input maxAbs=${maxAbs.toFixed(4)}, nonZero=${nonZero}/${debugData.length}`);
    } catch (e) {
      console.log(`[RMSNorm#${callId}] BEFORE_DISPATCH error: ${e}`);
    }
  }

  // Dispatch
  const encoder = device.createCommandEncoder({ label: 'rmsnorm_encoder' });
  const pass = encoder.beginComputePass({ label: 'rmsnorm_pass' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  pass.dispatchWorkgroups(batchSize);
  pass.end();

  device.queue.submit([encoder.finish()]);

  // Debug: verify output buffer has data AFTER kernel dispatch
  if (batchSize <= 4) {
    try {
      await device.queue.onSubmittedWorkDone();
      const debugSize = Math.min(64, output.size);
      const debugStaging = device.createBuffer({ size: debugSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const debugEnc = device.createCommandEncoder();
      debugEnc.copyBufferToBuffer(output, 0, debugStaging, 0, debugSize);
      device.queue.submit([debugEnc.finish()]);
      await debugStaging.mapAsync(GPUMapMode.READ);
      const debugData = new Float32Array(debugStaging.getMappedRange().slice(0));
      debugStaging.unmap();
      debugStaging.destroy();
      const maxAbs = Math.max(...Array.from(debugData).map(x => Math.abs(x)));
      const nonZero = Array.from(debugData).filter(x => x !== 0).length;
      console.log(`[RMSNorm#${callId}] AFTER_DISPATCH: output maxAbs=${maxAbs.toFixed(4)}, nonZero=${nonZero}/${debugData.length}`);

      // Also log weight values
      const weightDebugSize = Math.min(64, weight.size);
      const weightStaging = device.createBuffer({ size: weightDebugSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const weightEnc = device.createCommandEncoder();
      weightEnc.copyBufferToBuffer(weight, 0, weightStaging, 0, weightDebugSize);
      device.queue.submit([weightEnc.finish()]);
      await weightStaging.mapAsync(GPUMapMode.READ);
      const weightData = new Float32Array(weightStaging.getMappedRange().slice(0));
      weightStaging.unmap();
      weightStaging.destroy();
      const weightMax = Math.max(...Array.from(weightData).map(x => Math.abs(x)));
      const weightNonZero = Array.from(weightData).filter(x => x !== 0).length;
      console.log(`[RMSNorm#${callId}] WEIGHTS: maxAbs=${weightMax.toFixed(4)}, nonZero=${weightNonZero}/${weightData.length}, first5=${Array.from(weightData.slice(0, 5)).map(x => x.toFixed(4)).join(', ')}`);
    } catch (e) {
      console.log(`[RMSNorm#${callId}] AFTER_DISPATCH error: ${e}`);
    }
  }

  uniformBuffer.destroy();
  if (!residual) residualBuffer.destroy();

  setBufferDtype(output, 'f32');
  return output;
}

/**
 * Record RMSNorm (batched, no submit)
 */
export async function recordRMSNorm(
  recorder: CommandRecorder,
  input: GPUBuffer,
  weight: GPUBuffer,
  eps: number = 1e-5,
  options: RMSNormOptions = {}
): Promise<GPUBuffer> {
  const device = recorder.device;
  const {
    batchSize = 1,
    hiddenSize = null,
    residual = null,
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
  uniformView.setUint32(0, inferredHiddenSize, true);
  uniformView.setUint32(4, batchSize, true);
  uniformView.setFloat32(8, eps, true);
  uniformView.setUint32(12, residual ? 1 : 0, true); // hasResidual flag

  const uniformBuffer = recorder.createUniformBuffer(uniformData, 'rmsnorm_uniforms');

  // Shader expects 5 bindings - create placeholder when no residual (uniform flags it as unused)
  const residualBuffer = residual || device.createBuffer({
    label: 'rmsnorm_residual_placeholder',
    size: 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // Bind group
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

  // Record pass
  const pass = recorder.beginComputePass('rmsnorm');
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(batchSize);
  pass.end();

  // Track dummy buffer for cleanup if we created it
  if (!residual) {
    recorder.trackTemporaryBuffer(residualBuffer);
  }

  setBufferDtype(output, 'f32');
  return output;
}
