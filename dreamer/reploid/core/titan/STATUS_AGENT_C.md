# Agent-C Status (WebGPU Kernels)

## Completed
- [x] `device.js` — WebGPU device init with feature probing (shader-f16, subgroups, timestamp-query)
- [x] `kernels/matmul_f32.wgsl` — FP32 tiled matmul with shared memory (16x16 tiles)
- [x] `kernels/matmul_f16.wgsl` — FP16 matmul with f32 accumulation (requires shader-f16)
- [x] `kernels/dequant_subgroup.wgsl` — Q4_K_M dequant using subgroup broadcast
- [x] `kernels/dequant_shared.wgsl` — Q4_K_M dequant fallback using workgroup shared memory
- [x] `kernel-selector.js` — Runtime kernel selection based on device capabilities
- [x] `buffer-pool.js` — GPU buffer pool with allocation, reuse, staging buffers

## In Progress
- (none)

## Blocked
- (none)

## Ready for Review
- `device.js` — needs review by Agent-D
- `kernels/matmul_f32.wgsl` — needs review by Agent-D
- `kernels/matmul_f16.wgsl` — needs review by Agent-D
- `kernels/dequant_subgroup.wgsl` — needs review by Agent-D
- `kernels/dequant_shared.wgsl` — needs review by Agent-D
- `kernel-selector.js` — needs review by Agent-D
- `buffer-pool.js` — needs review by Agent-D

## Interface Contract (Exported)

```javascript
// device.js
export async function initDevice() → GPUDevice
export function getKernelCapabilities() → { hasSubgroups, hasF16, maxBufferSize, ... }
export function getDevice() → GPUDevice
export function destroyDevice() → void

// kernel-selector.js
export async function runMatmul(A, B, M, N, K, options?) → GPUBuffer
export async function dequantize(quantized, numBlocks, options?) → GPUBuffer
export function selectMatmulKernel(options?) → string
export function selectDequantKernel(options?) → string

// buffer-pool.js
export function getBufferPool() → BufferPool
export function createStagingBuffer(size) → GPUBuffer
export function acquireBuffer(size, usage, label?) → GPUBuffer
export function releaseBuffer(buffer) → void
export async function readBuffer(buffer, size?) → ArrayBuffer
```

## Notes
- Matmul kernels use 16x16 tiled algorithm with shared memory
- FP16 matmul uses f32 accumulation for numerical stability
- Q4_K_M dequant supports 256-element super-blocks with 4 sub-blocks
- Subgroup kernel uses `subgroupBroadcastFirst` for scale distribution
- Buffer pool uses power-of-2 size bucketing for efficient reuse
