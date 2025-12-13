# Dreamer Optimization Roadmap

Tracking performance and UX work for the Dreamer WebGPU path.

## Status

- [x] Dtype tracking and safe kernel selection
- [x] Shader prewarm during model load
- [x] Shard LRU cache in DreamerLoader
- [x] Incremental stop sequence checks
- [x] Hardware and model memory estimate (provider event)
- [x] Buffer pool outputs to prevent VRAM leaks
- [x] Direct f16 dequant output for matmul weights
- [x] f16 weight storage and mixed-precision matmul kernels
- [x] KV cache f16 allocation and f16 attention path
- [x] Multi-tier attention kernels (large/small/streaming) with headDim support
  - Large tier: headDim <= 64, 48KB shared memory (Llama, Mistral)
  - Small tier: headDim <= 256, 8KB shared memory with head tiling (Gemma 3)
  - Streaming tier: Any headDim, no shared memory (fallback)
  - f16 KV variants for all tiers (`_f16kv` suffix)
  - Automatic tier selection based on device limits and model config
- [x] Bundled tokenizer support and downloader caching
- [x] `convert-cli` `--fast` memory-buffered conversion
- [x] Absolute position tracking (`startPos`) for correct causal masking during decode
- [x] Cache invalidation: `clearPipelineCache()` clears both shader source and pipeline caches
- [x] Shader fetch cache busting (`cache: 'no-cache'`) to prevent stale shader loads
- [x] SwiGLU fused activation kernel (gate + up + SiLU in one pass)
- [x] Kernel auto-tuner infrastructure (`kernel-tuner.js`) with localStorage caching
- [x] Speculative decoding framework (`speculative.js`) - needs draft model wiring

Notes:
- Regenerate `.rdrr` packs to include bundled `tokenizer.json`.

---

## Critical: Command Buffer Batching

**Current state**: Each kernel creates its own `GPUCommandEncoder` and calls `device.queue.submit()` independently. This causes:
- 10+ kernel dispatches per layer × 26 layers = **260+ submits per forward pass**
- Each submit has driver overhead (~0.1-0.5ms)
- **Estimated overhead: 50-100ms per token** (not the 2% previously estimated)

```javascript
// CURRENT (bad): Each kernel submits independently
export async function runMatmul(...) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.dispatchWorkgroups(...);
  pass.end();
  device.queue.submit([encoder.finish()]);  // ← SUBMIT HERE
  return outputBuffer;
}
```

**Proposed**: Single command encoder records entire forward pass, submits once before sampling readback.

```javascript
// PROPOSED: Pass encoder through pipeline
export function recordMatmul(encoder, ...) {
  const pass = encoder.beginComputePass();
  pass.dispatchWorkgroups(...);
  pass.end();
  return outputBuffer;  // No submit - caller batches
}

// In pipeline.js
async *generate(prompt, options) {
  const encoder = device.createCommandEncoder();

  // Record ALL operations
  let hidden = recordEmbed(encoder, tokenIds);
  for (let l = 0; l < numLayers; l++) {
    hidden = recordLayer(encoder, l, hidden);
  }
  const logits = recordLMHead(encoder, hidden);

  // Single submit
  device.queue.submit([encoder.finish()]);

  // Only now read back for sampling
  const logitsData = await readBuffer(logits);
  const token = sample(logitsData);
  yield token;
}
```

**Implementation plan**:
1. Add `record*` variants to `kernel-selector.js` that accept external encoder
2. Refactor `pipeline.js` to create single encoder per forward pass
3. Keep existing `run*` functions as convenience wrappers for testing
4. Benchmark before/after on various devices

**Savings**: 50-100ms per forward pass (estimated)
**Complexity**: Medium - requires touching all kernel functions
**Priority**: **CRITICAL** - largest single optimization opportunity

---

## In Progress

- [ ] Optional f16 activation pipeline
  - Current state: weights and KV cache are f16 where supported. Activations remain f32.
  - Next: add f16 variants for rmsnorm, rope, silu, softmax if quality holds.
  - Note: May cause quality degradation on some models - needs testing

---

## High Impact

### GPU-Side Sampling

**Current**: Read back entire logits array (~1MB for 256K vocab) to CPU for sampling.

**Proposed**: Run top-k/softmax/sampling on GPU, only read back single token ID.

```javascript
// Current (bad)
const logitsData = await readBuffer(logitsBuffer);  // 1MB readback
const token = sampleTopK(logitsData, k=40);

// Proposed (good)
const tokenBuffer = runGPUSample(logitsBuffer, { topK: 40, temperature: 0.7 });
const tokenData = await readBuffer(tokenBuffer);  // 4 bytes readback
const token = tokenData[0];
```

**Implementation**:
- [x] `topk.wgsl` kernel exists
- [ ] Add temperature scaling kernel
- [ ] Add multinomial sampling kernel (or reuse random from WebGPU)
- [ ] Wire into pipeline

**Savings**: ~0.5-1ms per token (PCIe/memory bandwidth)
**Complexity**: Medium

### Kernel Fusion: QKV Projection

**Current**: 3 separate matmul dispatches for Q, K, V projections.

**Proposed**: Single fused kernel computes all three.

```wgsl
// Fused QKV: one kernel, one memory pass over input
@compute @workgroup_size(16, 16, 1)
fn fused_qkv(...) {
  // Load input tile once
  let input_tile = load_shared(input);

  // Compute Q, K, V in parallel
  let q = matmul_tile(input_tile, W_q);
  let k = matmul_tile(input_tile, W_k);
  let v = matmul_tile(input_tile, W_v);

  // Write all outputs
  store(Q_out, q);
  store(K_out, k);
  store(V_out, v);
}
```

**Savings**: ~30-40% of attention projection time
**Complexity**: High - significant kernel work
**Status**: Not started

### In-Kernel Dequantization (Hybrid Q4 Matmul)

**Current**: Dequantize Q4→F32, then matmul. Two memory passes.

**Proposed**: Load Q4 tiles, dequant in registers/shared memory, matmul immediately.

```wgsl
// Load Q4 block (144 bytes)
let q4_block = load_q4(weights, tile_idx);

// Dequant in shared memory
let f32_tile = dequant_q4k(q4_block);

// Matmul immediately (data still in cache)
let result = matmul_tile(input_tile, f32_tile);
```

**Savings**: ~50% decode time (memory-bound phase)
**Complexity**: High - requires custom tile format, Q4 math in WGSL
**Blocker**: No native int4 in WebGPU
**Status**: Deferred pending WebGPU int4 support or custom pack format

---

## Medium Impact

### Web Worker Command Buffer Building

**Current**: Main thread builds commands, GPU may idle during JS work.

**Proposed**: Worker builds buffer N+1 while GPU executes buffer N.

**Challenge**: `GPUDevice` can't cross worker boundary. Need to:
- Serialize command recording
- Or use OffscreenCanvas/transferable pattern

**Savings**: 10-15% decode throughput (if JS overhead is the bottleneck)
**Complexity**: High
**Status**: Deferred - command batching should be done first

### Double/Triple Buffering

**Current**: Allocate buffers on-demand during decode loop.

**Proposed**: Pre-allocate rotating buffer sets.

```javascript
const bufferSets = [
  { hidden: acquireBuffer(...), qkv: acquireBuffer(...), ... },
  { hidden: acquireBuffer(...), qkv: acquireBuffer(...), ... },
  { hidden: acquireBuffer(...), qkv: acquireBuffer(...), ... },
];

let currentSet = 0;
for (const token of decode()) {
  const buffers = bufferSets[currentSet % 3];
  // Use buffers...
  currentSet++;
}
```

**Savings**: 5-10% decode latency variance
**Complexity**: Low
**Status**: Not started

### Speculative Decoding Wiring

**Current**: `speculative.js` has full implementation but no draft model integration.

**Needed**:
1. Manifest convention for draft model packs (e.g., `"draftModel": "gemma-3-1b-draft"`)
2. Load draft model into separate pipeline instance
3. KV cache cloning for draft speculation
4. Verification batch forward pass

**Savings**: 1.5-2x decode throughput
**Complexity**: Medium - infrastructure exists, needs wiring
**Status**: Implementation complete, needs integration

---

## Lower Impact

### Worker-Based Tokenization

- Tokenize next user input while GPU generates
- Savings: 5% perceived latency
- Status: Not started

### Shard Prefetch Worker

- Background OPFS reads during inference
- Savings: 20%+ cold start, minimal warm impact
- Status: Not started

### Continuous Batching

- Multiple sequences in flight, fill GPU utilization
- Savings: 2-3x throughput for multi-user scenarios
- Complexity: Very high, needs request scheduler
- Status: Not started (likely out of scope for browser)

---

## Completed Recently

- [x] MXFP4 dequantization kernel (`dequant_mxfp4.wgsl`)
  - Supports GPT-OSS mixed-precision FP4 format (U8 blocks + U8 scales)
  - Expert-aware variant for slicing from packed tensors
- [x] GPT-OSS MoE architecture support
  - Per-layer attention types (alternating `sliding_attention` / `full_attention`)
  - Router with bias support (`mlp.router.weight` + `mlp.router.bias`)
  - YARN RoPE scaling (wavelength-based per-dimension interpolation)
  - Attention sinks tensor loading (placeholder integration)
- [x] Expert tensor mapping for GPT-OSS naming convention
  - Fused gate_up projection: `mlp.experts.gate_up_proj_{blocks,scales,bias}`
  - Down projection: `mlp.experts.down_proj_{blocks,scales,bias}`
- [x] Q4_K quantizer fix (see `GEMMA3-DEBUG-POSTMORTEM.md`)
  - Fixed sign handling to match llama.cpp format
  - Dequant formula: `d * scale * q - dmin * min`

---

## Bottleneck Analysis

### Prefill (N tokens)
- **Compute-bound**: large matrix multiplies keep GPU busy
- Attention is O(N²) and dominates for long sequences
- Quantization helps moderately (less data to load)
- Command batching helps significantly here (many ops to batch)

### Decode (1 token)
- **Memory-bound**: load full weight matrices for single output row
- GPU utilization often <30%
- Quantization helps significantly (4x less bandwidth)
- **JS orchestration overhead is significant** (was underestimated)

```
Decode timeline (7B model, ~26ms/token) - REVISED:

WITHOUT command batching:
├── JS command build + submit overhead: 5-10ms  (20-40%)  ← MUCH HIGHER
├── GPU kernel exec:                   15-20ms  (60-75%)
├── Readback + sample:                  1-2ms   (5-10%)

WITH command batching (projected):
├── JS command build (batched):         0.5ms  (2%)
├── GPU kernel exec:                   24.0ms  (95%)
├── Readback + sample:                  0.5ms  (2%)
└── PROJECTED IMPROVEMENT: 20-40% faster decode
```

---

## Not Valid / Removed

- ~~Real kernel auto-tune selection~~ → Implemented in `kernel-tuner.js`
- ~~Deeper storage prefetch~~ → Deferred, minimal impact once model cached

---

## Implementation Priority

1. **Command buffer batching** - Critical, largest impact, unblocks other work
2. **GPU-side sampling** - High impact, reduces readback
3. **Speculative decoding wiring** - High impact, infrastructure ready
4. **Double/triple buffering** - Low effort, reduces variance
5. **QKV fusion** - High effort, good returns
6. **Hybrid Q4 matmul** - Blocked on WebGPU features

---

*Last updated: December 2025*
