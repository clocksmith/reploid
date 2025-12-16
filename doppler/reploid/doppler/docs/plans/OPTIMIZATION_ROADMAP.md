# DOPPLER Optimization Roadmap

**Part of:** [VISION.md](../VISION.md) - Phases 1 & 2 (Performance Parity + MoE Efficiency)

Tracking performance and UX work for the DOPPLER WebGPU path.

## Status

- [x] Dtype tracking and safe kernel selection
- [x] Shader prewarm during model load
- [x] Shard LRU cache in DopplerLoader
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
- [x] Kernel auto-tuner infrastructure (`kernel-tuner.ts`) with localStorage caching
- [x] Speculative decoding framework (`speculative.ts`) - needs draft model wiring

Notes:
- Regenerate `.rdrr` packs to include bundled `tokenizer.json`.
- Benchmark methodology and output schema: `docs/spec/BENCHMARK_HARNESS.md`
- Kernel test strategy: `docs/spec/KERNEL_TESTING.md`
- Competitive context and constraints: `docs/analysis/COMPETITIVE.md`

---

## Competitive Checklist

This file is the single source of truth for actionable work. `docs/analysis/COMPETITIVE.md` provides the rationale.

### WebGPU Pipeline Optimizations (Buffer Reuse + Async) ✅ COMPLETE

**Context:** WeInfer paper (WWW 2025) demonstrated 3.76x speedup over WebLLM using buffer reuse and async pipeline techniques. The WeInfer repo is stale (last commit Feb 2025, based on WebLLM 0.2.46), so implement from first principles using the paper as reference.

**Paper:** [ACM WWW 2025](https://dl.acm.org/doi/10.1145/3696410.3714553)

Goal: remove avoidable WebGPU overhead (buffer churn, redundant submits, unnecessary readbacks).

**Techniques for 3.76x speedup:**

| Action Item | Priority | Status | File(s) | Technique |
|-------------|----------|--------|---------|-----------|
| Command buffer batching | P0 | ✅ DONE | `gpu/command-recorder.ts`, `inference/pipeline.ts` | Single submit per forward pass |
| Buffer reuse strategy | P1 | ✅ DONE | `gpu/buffer-pool.ts` | Pool with acquire/release pattern |
| GPU-side sampling | P1 | ✅ DONE | `gpu/kernels/sample.ts`, `sample.wgsl` | Argmax/top-k on GPU, 4-byte readback |
| Deferred result fetching | P1 | ✅ DONE | `inference/pipeline/logits.ts` | `computeLogitsGPU` returns GPU buffer |
| Async pipeline | P1 | ✅ DONE | `inference/pipeline.ts` | Weights pre-loaded, buffer pool eliminates prep |

**Implementation approach (don't copy stale WeInfer code):**

```javascript
// Buffer reuse: pre-allocate and recycle
class PersistentBufferPool {
  constructor(device) {
    this.pools = new Map(); // size -> available buffers
  }

  acquire(size, usage) {
    // Return existing buffer if available, else create
    const key = `${size}_${usage}`;
    if (this.pools.has(key) && this.pools.get(key).length > 0) {
      return this.pools.get(key).pop();
    }
    return device.createBuffer({ size, usage });
  }

  release(buffer) {
    // Return to pool instead of destroy
    const key = `${buffer.size}_${buffer.usage}`;
    if (!this.pools.has(key)) this.pools.set(key, []);
    this.pools.get(key).push(buffer);
  }
}

// Async pipeline: overlap prep with execution
async function forwardPass(encoder, inputs) {
  // Stage 1: Prep next layer's buffers while current executes
  const prepPromise = prepareLayerBuffers(layerIdx + 1);

  // Stage 2: Record current layer
  recordLayer(encoder, layerIdx, inputs);

  // Stage 3: Await prep for next iteration
  await prepPromise;
}
```

Note: command buffer batching is tracked in the next section. It is a major overhead reducer.

### Scale and Storage (Native Bridge, OPFS, Unified Memory)

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| Validate 8GB model load via Native Bridge | P0 | TODO | `bridge/`, `storage/` |
| Validate 16GB model load on unified memory | P0 | TODO | `memory/capability.ts` |
| Validate 40GB+ model load (theoretical 60GB claim) | P1 | TODO | n/a |
| Benchmark Native Bridge vs OPFS load times | P1 | TODO | `storage/` |
| Document memory tier auto-detection | P2 | TODO | `memory/capability.ts` |
| Track ONNX WASM64 progress monthly | P2 | TODO | n/a |

### Model Coverage

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| Create model compatibility matrix (what works today) | P0 | TODO | `docs/` |
| Test Llama-3.2-1B-Instruct E2E | P0 | TODO | `tests/` |
| Test Llama-3.2-3B-Instruct E2E | P0 | TODO | `tests/` |
| Test Llama-3.1-8B-Instruct E2E | P0 | TODO | `tests/` |
| Test Mistral-7B-Instruct E2E | P1 | TODO | `tests/` |
| Document VRAM requirements per model | P2 | TODO | `docs/` |
| Create automated model test suite (CI) | P2 | TODO | `tests/` |

### MoE Performance vs WebLLM (Mixtral)

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| Convert Mixtral-8x7B-Instruct to RDRR format | P0 | TODO | `tools/convert-cli.ts` |
| Run Mixtral-8x7B-Instruct E2E (expert swapping) | P0 | TODO | `inference/pipeline.ts` |
| Benchmark MoE decode throughput | P0 | TODO | `tests/` |
| Benchmark vs WebLLM Mixtral (tok/s, TTFT, VRAM) | P0 | TODO | `tests/` |

### Benchmarks and Correctness

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| Create standardized pipeline benchmark harness | P0 | TODO | `tests/benchmark/`, `docs/spec/BENCHMARK_HARNESS.md` |
| Compare vs WebLLM on identical hardware and model | P0 | TODO | n/a |
| Add WGSL kernel unit tests and segment tests | P0 | TODO | `tests/`, `docs/spec/KERNEL_TESTING.md` |

Note: kernel unit tests and microbenchmarks already exist in `doppler/kernel-tests/`. The remaining gap is
pipeline segment tests tied to `inference/pipeline.ts` and end-to-end generation benchmarks.

### Multimodal (Optional)

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| Research vision encoder architectures (ViT, SigLIP) | P2 | TODO | n/a |
| Implement image preprocessing pipeline (resize, normalize) | P2 | TODO | `inference/` |
| Add vision encoder WGSL kernels (patch embed, attention) | P2 | TODO | `gpu/kernels/` |
| Test one vision-language model | P3 | TODO | n/a |

---

## Critical: Command Buffer Batching ✅ COMPLETE

**Status**: **IMPLEMENTED** (December 2025)

**Previous state**: Each kernel creates its own `GPUCommandEncoder` and calls `device.queue.submit()` independently. This caused:
- 10+ kernel dispatches per layer × 26 layers = **260+ submits per forward pass**
- Each submit has driver overhead (~0.1-0.5ms)
- **Estimated overhead: 50-100ms per token**

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

// In pipeline.ts
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

**Implementation (completed)**:
1. ✅ Added `record*` variants to all kernels (matmul, rmsnorm, rope, attention, silu, gelu, cast, residual, gather, softmax, dequant)
2. ✅ Created `CommandRecorder` class in `gpu/command-recorder.ts` to manage batched recording
3. ✅ Added `do*` wrapper functions in `layer.ts` that select run/record based on context
4. ✅ Refactored `pipeline.ts` to create CommandRecorder per forward pass, submit once at end
5. ✅ Added submit tracking utilities in `gpu/submit-tracker.ts` for benchmarking

**Key files changed**:
- `gpu/command-recorder.ts` - CommandRecorder class
- `gpu/submit-tracker.ts` - Submit statistics tracking
- `gpu/kernels/*.ts` - Added record* variants for all kernels
- `inference/pipeline.ts` - Creates recorder, single submit
- `inference/pipeline/layer.ts` - do* wrappers
- `inference/pipeline/attention.ts` - recordLayerAttentionGPU

**Savings**: 50-100ms per forward pass (reduces 260+ submits to 1)
**Status**: ✅ **COMPLETE** - Ready for benchmarking

---

## In Progress

- [ ] Optional f16 activation pipeline
  - Current state: weights and KV cache are f16 where supported. Activations remain f32.
  - Next: add f16 variants for rmsnorm, rope, silu, softmax if quality holds.
  - Note: May cause quality degradation on some models - needs testing

---

## High Impact

### Swarm Shard Cache (P2P)

Use peers as additional shard sources during model load. This primarily improves cold start and reduces origin bandwidth when a small group shares the same model.

**Proposed**:
- Discover peers for a given manifest hash.
- Request missing shards from multiple peers in parallel (chunked).
- Verify shard hash before accepting data.
- Store verified shards in OPFS for subsequent local loads.

**Savings**: Large for cold start in group settings. Low for warm start.
**Complexity**: High (networking, scheduling, integrity, abuse controls).
**Notes**: Documented in `docs/proposals/P2P.md`.

### GPU-Side Sampling ✅ COMPLETE

**Status**: **IMPLEMENTED** (December 2025)

**Previous state**: Read back entire logits array (~1MB for 256K vocab) to CPU for sampling.

**Implementation**: Run argmax/top-k/softmax/sampling on GPU, only read back single token ID.

```javascript
// Now implemented in pipeline.ts:
const logitsResult = await computeLogitsGPU(hiddenStates, numTokens, weights, config);
const nextToken = opts.temperature < 0.01
  ? await runArgmax(logitsResult.logitsBuffer, vocabSize)
  : await runGPUSample(logitsResult.logitsBuffer, vocabSize, { temperature, topK });
// Only 4 bytes read back!
```

**Key files**:
- `gpu/kernels/sample.wgsl` - Argmax, top-k, softmax, and sampling kernels
- `gpu/kernels/sample.ts` - TypeScript API: `runArgmax`, `runGPUSample`, `recordArgmax`
- `inference/pipeline/logits.ts` - `computeLogitsGPU` returns GPU buffer
- `inference/pipeline.ts` - Integrated GPU sampling in `_decodeStep`

**Savings**: ~0.5-1ms per token (PCIe/memory bandwidth)
**Status**: ✅ **COMPLETE**

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

**Current**: `speculative.ts` has full implementation but no draft model integration.

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

BEFORE command batching:
├── JS command build + submit overhead: 5-10ms  (20-40%)  ← 260+ submits
├── GPU kernel exec:                   15-20ms  (60-75%)
├── Readback + sample:                  1-2ms   (5-10%)

AFTER command batching (implemented Dec 2025):
├── JS command build (batched):         0.5ms  (2%)   ← 1 submit
├── GPU kernel exec:                   24.0ms  (95%)
├── Readback + sample:                  0.5ms  (2%)
└── IMPROVEMENT: 20-40% faster decode (pending benchmarks)
```

---

## Not Valid / Removed

- ~~Real kernel auto-tune selection~~ → Implemented in `kernel-tuner.ts`
- ~~Deeper storage prefetch~~ → Deferred, minimal impact once model cached

---

## Implementation Priority

### WeInfer Optimizations - ALL COMPLETE ✅

1. ✅ **Command buffer batching** - Single submit per forward pass (260+ → 1)
2. ✅ **Buffer reuse** - Pool with acquire/release pattern
3. ✅ **GPU-side sampling** - Argmax/top-k on GPU, 4-byte readback
4. ✅ **Deferred readback** - `computeLogitsGPU` returns GPU buffer
5. ✅ **Async pipeline** - Weights pre-loaded, buffer pool eliminates prep overhead

### Remaining Optimizations

6. **Speculative decoding wiring** - High impact, infrastructure ready
7. **Double/triple buffering** - Low effort, reduces variance
8. **QKV fusion** - High effort, good returns
9. **Hybrid Q4 matmul** - Blocked on WebGPU features

---

*Last updated: December 2025*
