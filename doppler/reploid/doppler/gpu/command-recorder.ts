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

/** Statistics about recorded operations */
export interface RecorderStats {
  opCount: number;
  tempBufferCount: number;
  submitted: boolean;
}

/**
 * CommandRecorder wraps a GPUCommandEncoder and manages temporary resources.
 */
export class CommandRecorder {
  readonly device: GPUDevice;
  readonly label: string;
  private encoder: GPUCommandEncoder;

  /** Temporary buffers to destroy after submit */
  private tempBuffers: GPUBuffer[];

  /** Track if already submitted */
  private submitted: boolean;

  /** Operation count for debugging */
  private opCount: number;

  /**
   * @param device - GPU device (auto-detected if not provided)
   * @param label - Label for debugging
   */
  constructor(device: GPUDevice | null = null, label: string = 'command_recorder') {
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
   * @param size - Buffer size in bytes
   * @param usage - Buffer usage flags
   * @param label - Buffer label for debugging
   * @returns GPUBuffer
   */
  createTempBuffer(size: number, usage: GPUBufferUsageFlags, label: string = 'temp_buffer'): GPUBuffer {
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
   * @param data - Data to write
   * @param label - Buffer label
   * @returns GPUBuffer
   */
  createUniformBuffer(data: ArrayBuffer | ArrayBufferView, label: string = 'uniforms'): GPUBuffer {
    const byteLength = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    const buffer = this.createTempBuffer(
      byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label
    );
    this.device.queue.writeBuffer(buffer, 0, data as GPUAllowSharedBufferSource);
    return buffer;
  }

  /**
   * Begin a compute pass on the encoder.
   * @param label - Pass label for debugging
   * @returns GPUComputePassEncoder
   */
  beginComputePass(label: string = 'compute_pass'): GPUComputePassEncoder {
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
   * @returns GPUCommandEncoder
   */
  getEncoder(): GPUCommandEncoder {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Cannot access encoder after submit');
    }
    return this.encoder;
  }

  /**
   * Track an externally created buffer for cleanup after submit.
   * Use for buffers created outside the recorder that need cleanup.
   *
   * @param buffer - Buffer to track for destruction
   */
  trackTemporaryBuffer(buffer: GPUBuffer): void {
    if (this.submitted) {
      throw new Error('[CommandRecorder] Cannot track buffers after submit');
    }
    this.tempBuffers.push(buffer);
  }

  /**
   * Submit all recorded commands and clean up temporary buffers.
   * After calling this, the recorder cannot be reused.
   */
  submit(): void {
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
   * @returns Promise that resolves when GPU work is done
   */
  async submitAndWait(): Promise<void> {
    this.submit();
    await this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Get statistics about recorded operations.
   * @returns Statistics object
   */
  getStats(): RecorderStats {
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
  abort(): void {
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
 * @param label - Label for debugging
 * @returns CommandRecorder instance
 */
export function createCommandRecorder(label: string = 'command_recorder'): CommandRecorder {
  return new CommandRecorder(null, label);
}

export default CommandRecorder;
