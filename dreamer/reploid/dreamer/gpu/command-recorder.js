/**
 * CommandRecorder - Batched GPU Command Recording
 *
 * Enables recording multiple GPU operations into a single command buffer,
 * avoiding per-kernel submit overhead. Manages temporary buffers automatically.
 *
 * Usage:
 *   const recorder = new CommandRecorder(device);
 *   recordMatmul(recorder, A, B, M, N, K);
 *   recordRMSNorm(recorder, input, weight, eps);
 *   // ... more operations
 *   await recorder.submit();  // Single GPU submission + cleanup
 *
 * Performance impact:
 *   Without batching: 260+ submits per forward pass (~50-100ms overhead)
 *   With batching: 1 submit per forward pass (~0.5ms overhead)
 */

import { getDevice } from './device.js';

/**
 * CommandRecorder wraps a GPUCommandEncoder and manages temporary resources.
 */
export class CommandRecorder {
  /**
   * @param {GPUDevice} [device] - GPU device (auto-detected if not provided)
   * @param {string} [label] - Label for debugging
   */
  constructor(device = null, label = 'command_recorder') {
    this.device = device || getDevice();
    if (!this.device) {
      throw new Error('[CommandRecorder] No GPU device available');
    }

    this.label = label;
    this.encoder = this.device.createCommandEncoder({ label });

    // Temporary buffers to destroy after submit
    this.tempBuffers = [];

    // Track if already submitted
    this.submitted = false;

    // Operation count for debugging
    this.opCount = 0;
  }

  /**
   * Create a temporary buffer that will be destroyed after submit.
   * Use for uniform buffers and other per-operation temporaries.
   *
   * @param {number} size - Buffer size in bytes
   * @param {GPUBufferUsageFlags} usage - Buffer usage flags
   * @param {string} [label] - Buffer label for debugging
   * @returns {GPUBuffer}
   */
  createTempBuffer(size, usage, label = 'temp_buffer') {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Cannot create buffers after submit');
    }

    const buffer = this.device.createBuffer({
      label: `${this.label}_${label}_${this.tempBuffers.length}`,
      size,
      usage,
    });

    this.tempBuffers.push(buffer);
    return buffer;
  }

  /**
   * Create a uniform buffer, write data, and track for cleanup.
   * Convenience method for the common uniform buffer pattern.
   *
   * @param {ArrayBuffer|TypedArray} data - Data to write
   * @param {string} [label] - Buffer label
   * @returns {GPUBuffer}
   */
  createUniformBuffer(data, label = 'uniforms') {
    const buffer = this.createTempBuffer(
      data.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label
    );
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  /**
   * Begin a compute pass on the encoder.
   * @param {string} [label] - Pass label for debugging
   * @returns {GPUComputePassEncoder}
   */
  beginComputePass(label = 'compute_pass') {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Cannot begin pass after submit');
    }
    this.opCount++;
    return this.encoder.beginComputePass({
      label: `${this.label}_${label}_${this.opCount}`,
    });
  }

  /**
   * Get the raw encoder for advanced use cases.
   * @returns {GPUCommandEncoder}
   */
  getEncoder() {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Cannot access encoder after submit');
    }
    return this.encoder;
  }

  /**
   * Submit all recorded commands and clean up temporary buffers.
   * After calling this, the recorder cannot be reused.
   */
  submit() {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Already submitted');
    }

    // Submit commands
    this.device.queue.submit([this.encoder.finish()]);
    this.submitted = true;

    // Destroy temporary buffers
    for (const buffer of this.tempBuffers) {
      buffer.destroy();
    }
    this.tempBuffers = [];
  }

  /**
   * Submit and wait for GPU to complete (useful for debugging/profiling).
   * @returns {Promise<void>}
   */
  async submitAndWait() {
    this.submit();
    await this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Get statistics about recorded operations.
   * @returns {{opCount: number, tempBufferCount: number, submitted: boolean}}
   */
  getStats() {
    return {
      opCount: this.opCount,
      tempBufferCount: this.tempBuffers.length,
      submitted: this.submitted,
    };
  }

  /**
   * Abort recording without submitting (cleanup only).
   * Use if an error occurs during recording.
   */
  abort() {
    if (this.submitted) return;

    // Destroy temp buffers without submitting
    for (const buffer of this.tempBuffers) {
      buffer.destroy();
    }
    this.tempBuffers = [];
    this.submitted = true; // Prevent further use
  }
}

/**
 * Create a new CommandRecorder.
 * @param {string} [label] - Label for debugging
 * @returns {CommandRecorder}
 */
export function createCommandRecorder(label = 'command_recorder') {
  return new CommandRecorder(null, label);
}

export default CommandRecorder;
