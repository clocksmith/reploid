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
- All files reviewed by Agent-D (pending their update)

## Code Review of AGENT-D (inference/) — ALL APPROVED ✓

### moe-router.js ✓
- Clean MoERouter class with proper Mixtral-style top-k expert selection
- CPU fallback `computeRouterLogitsCPU()` implements correct matmul for gating
- Softmax uses max-subtraction for numerical stability
- Top-k selection with optional weight renormalization
- Load balancing stats tracking for debugging/monitoring
- `createExpertExecutionPlan()` groups tokens by expert for efficient batching
- `combineExpertOutputs()` properly weighted-sums expert results

### speculative.js ✓
- Implements Leviathan et al. 2022 speculative decoding
- `logSoftmax()` with numerical stability (max subtraction)
- Rejection sampling: `min(1, p_main/p_draft)` correctly implemented
- `sampleFromResidual()` computes `max(0, p_main - p_draft)` for rejected tokens
- Statistics tracking for acceptance rate and speedup estimation
- `TreeSpeculativeDecoder` extension for experimental tree-based drafting

### kv-cache.js ✓
- Dual layout support: contiguous (fast) and paged (memory-efficient)
- Lazy page allocation for paged mode reduces initial memory
- `clone()` for speculative decoding rollback
- `truncate()` for partial sequence rollback
- `SlidingWindowKVCache` with `copyWithin()` for efficient sliding
- `MQAKVCache` for multi-query attention (GQA support)
- Memory stats with efficiency tracking

### tokenizer.js ✓
- Clean abstraction with `BaseTokenizer` interface
- `TransformersTokenizer` wrapping HuggingFace Transformers.js
- `BPETokenizer` with full merge ranking implementation
- `SentencePieceTokenizer` stubbed for future WASM integration
- `createTokenizer()` factory with auto-detection from manifest
- Proper special token handling (BOS, EOS, PAD, UNK)

### pipeline.js ✓
- Full `InferencePipeline` orchestrating all components
- `initialize()` accepts contexts from all agents (gpu, memory, storage)
- `generate()` async generator with proper prefill/decode phases
- `_moeFeedForward()` integrates MoE router with expert execution plan
- `_sample()` with temperature, top-k, top-p (nucleus) sampling
- Repetition penalty on last 100 tokens
- Speculative decoding integration when draft model available
- Comprehensive stats (tokens/sec, KV cache memory, MoE utilization)

### Interface Compatibility
Agent-D's code is ready to integrate with my GPU interfaces:
```javascript
// In pipeline.js, replace TODO comments with:
import { initDevice, getKernelCapabilities } from '../gpu/device.js';
import { runMatmul, dequantize } from '../gpu/kernel-selector.js';
import { acquireBuffer, releaseBuffer } from '../gpu/buffer-pool.js';

// For attention/FFN:
const qkv = await runMatmul(hiddenStates, qkvWeight, numTokens, 3 * headDim * numHeads, hiddenSize);
const ffnUp = await runMatmul(normed, upWeight, numTokens, intermediateSize, hiddenSize);

// For quantized weights:
const dequantized = await dequantize(quantizedBuffer, numBlocks);
```

**Review Status: ALL 5 FILES APPROVED ✓**

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
