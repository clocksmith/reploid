/**
 * buffer-dtypes.js - Lightweight dtype tracking for GPU buffers
 *
 * WebGPU buffers are untyped; Dreamer needs dtype awareness to
 * safely select kernel variants (e.g., f16 matmul).
 *
 * This module stores per-buffer dtype metadata in a WeakMap.
 *
 * @module gpu/buffer-dtypes
 */

const _dtypeMap = new WeakMap();

/**
 * Set dtype metadata for a GPUBuffer
 * @param {GPUBuffer} buffer
 * @param {'f16'|'f32'|'q4'|'unknown'} dtype
 */
export function setBufferDtype(buffer, dtype) {
  if (!buffer) return;
  try {
    _dtypeMap.set(buffer, dtype);
  } catch {
    // Ignore non-object keys or environments without WeakMap support
  }
}

/**
 * Get dtype metadata for a GPUBuffer
 * @param {GPUBuffer} buffer
 * @returns {'f16'|'f32'|'q4'|'unknown'|null}
 */
export function getBufferDtype(buffer) {
  if (!buffer) return null;
  try {
    return _dtypeMap.get(buffer) || null;
  } catch {
    return null;
  }
}

/**
 * Convenience check for f16 buffers
 * @param {GPUBuffer} buffer
 * @returns {boolean}
 */
export function isF16Buffer(buffer) {
  return getBufferDtype(buffer) === 'f16';
}

