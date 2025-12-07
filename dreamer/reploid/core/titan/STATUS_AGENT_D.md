# Agent-D Status (Inference Pipeline)

## Completed
- [x] Create inference directory structure
- [x] `moe-router.js` — MoE router with top-k expert selection, gating network, load balancing
- [x] `speculative.js` — Speculative decoding with draft model, token verification, tree drafting
- [x] `kv-cache.js` — KV cache with contiguous/paged layouts, sliding window, MQA support
- [x] `tokenizer.js` — Tokenizer wrapper for Transformers.js, SentencePiece, BPE backends
- [x] `pipeline.js` — Main inference orchestration with MoE routing, speculative decode support
- [x] **Reviewed Agent-C's GPU code** ✓

## In Progress
- (none)

## Blocked
- Waiting on Agent-A for memory interfaces (`getMemoryCapabilities`, `allocateBuffer`)
- Waiting on Agent-B for storage interfaces (`loadShard`, `getManifest`)

## Ready for Review
- `moe-router.js` — needs review by Agent-C
- `speculative.js` — needs review by Agent-C
- `kv-cache.js` — needs review by Agent-C
- `tokenizer.js` — needs review by Agent-C
- `pipeline.js` — needs review by Agent-C

## Agent-C Review Notes

Reviewed the following files from `gpu/`:

### device.js ✓
- Comprehensive feature detection (shader-f16, subgroups, timestamp-query)
- Good adapter fallback logic
- Device caching and lost handler properly implemented
- Interface matches: `initDevice()`, `getKernelCapabilities()`

### kernel-selector.js ✓
- Smart kernel variant selection based on features
- Pipeline caching for performance
- `runMatmul(A, B, M, N, K)` interface compatible with pipeline.js
- `dequantize(quantized, numBlocks)` interface compatible

### buffer-pool.js ✓
- Efficient buffer pooling with power-of-2 size buckets
- `createStagingBuffer(size)` matches expected interface
- Good stats tracking and cleanup

### WGSL Kernels ✓
- `matmul_f32.wgsl`: Tiled 16x16 matmul with shared memory
- `matmul_f16.wgsl`: FP16 variant for shader-f16 capable devices
- `dequant_subgroup.wgsl`: Q4_K_M with subgroup broadcasts
- `dequant_shared.wgsl`: Fallback using shared memory

**All interfaces compatible with inference pipeline.**

## Interface Contract (Exported)

```javascript
// From pipeline.js
export async function createPipeline(manifest, contexts) → InferencePipeline
export class InferencePipeline {
  async loadModel(manifest) → void
  async *generate(prompt, options) → AsyncGenerator<string>
  getActiveExperts() → number[]
  clearKVCache() → void
  getStats() → Object
}

// From moe-router.js
export class MoERouter {
  route(hiddenStates, numTokens) → ExpertSelection[]
  getActiveExperts() → number[]
}
export function createExpertExecutionPlan(selections, numExperts) → Map
export function combineExpertOutputs(expertOutputs, selections, numTokens, hiddenSize) → Float32Array

// From kv-cache.js
export class KVCache {
  update(layerIdx, keys, values, startPos) → void
  get(layerIdx, startPos, endPos) → {keys, values}
  clear() → void
  clone() → KVCache
}

// From tokenizer.js
export class Tokenizer {
  async initialize(manifest) → void
  encode(text) → number[]
  decode(ids, skipSpecialTokens) → string
}
```

## Notes
- All modules have CPU fallback implementations
- GPU paths ready to integrate with Agent-C's kernels
- KV cache supports both contiguous (fast) and paged (memory-efficient) layouts
- Speculative decoder includes tree-based drafting (experimental)
- Pipeline handles MoE expert loading on-demand for memory efficiency
