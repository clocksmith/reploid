/**
 * Lightweight dtype tracking for GPU buffers.
 * WebGPU buffers are untyped; this module stores per-buffer dtype metadata.
 */

export type BufferDType = 'f16' | 'f32' | 'bf16' | 'q4' | 'q8' | 'i32' | 'u32' | 'unknown';

const dtypeMap = new WeakMap<GPUBuffer, BufferDType>();

export function setBufferDtype(buffer: GPUBuffer, dtype: BufferDType): void {
  if (buffer) dtypeMap.set(buffer, dtype);
}

export function getBufferDtype(buffer: GPUBuffer): BufferDType | null {
  return buffer ? (dtypeMap.get(buffer) ?? null) : null;
}

export function isF16Buffer(buffer: GPUBuffer): boolean {
  return getBufferDtype(buffer) === 'f16';
}

export function isBF16Buffer(buffer: GPUBuffer): boolean {
  return getBufferDtype(buffer) === 'bf16';
}

export function isQuantizedBuffer(buffer: GPUBuffer): boolean {
  const dtype = getBufferDtype(buffer);
  return dtype === 'q4' || dtype === 'q8';
}
