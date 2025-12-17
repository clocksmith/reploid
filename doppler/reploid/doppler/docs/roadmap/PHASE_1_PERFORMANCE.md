# Phase 1: Performance Parity

**Status:** In Progress
**Prerequisites:** None (foundational)
**Goal:** Match or beat WebLLM performance for dense models.

---

## Milestones

- [x] Gemma 3 1B working E2E ✅ Dec 2025
- [x] Tiled matmul optimization ✅
- [x] FlashAttention-style fusion ✅
- [x] W4A16 quantized matmul ✅
- [ ] 40+ tok/s decode on Gemma 1B (P0) - currently ~6 tok/s
- [ ] Llama 3.2 models validated (P0)

---

## Work Items

### 1.1 WeInfer Optimizations (Critical Path)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Command buffer batching | P0 | ✅ Done | `gpu/command-recorder.ts` |
| Buffer reuse strategy | P0 | ✅ Done | `gpu/buffer-pool.ts` |
| GPU-side sampling | P0 | ✅ Done | `gpu/kernels/sample.ts` |
| Deferred result fetching | P0 | ✅ Done | `inference/pipeline/logits.ts` |
| Async pipeline | P0 | ✅ Done | Weights pre-loaded |

### 1.2 Kernel Infrastructure

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Shader prewarm during load | P0 | ✅ Done | |
| F16 weight storage | P0 | ✅ Done | Mixed-precision matmul |
| KV cache f16 allocation | P0 | ✅ Done | F16 attention path |
| Multi-tier attention kernels | P0 | ✅ Done | Large/small/streaming tiers |
| SwiGLU fused activation | P1 | ✅ Done | Gate + up + SiLU in one pass |
| Kernel auto-tuner | P1 | ✅ Done | `kernel-tuner.ts` with localStorage |
| Speculative decoding framework | P2 | ✅ Done | Needs draft model wiring |

### 1.3 Kernel Optimizations (Performance)

| Task | Priority | Status | Impact | Notes |
|------|----------|--------|--------|-------|
| Tiled matmul optimization | P0 | ✅ Done | 2-3x | 16x16 shared memory tiles in `matmul_f32.wgsl` |
| Subgroup operations | P0 | ✅ Done | 1.5x | `matmul_gemv_subgroup.wgsl` |
| Workgroup size auto-tuning | P1 | ⏳ Partial | 1.2-1.5x | Framework exists; only matmul benchmarks, others hardcoded |
| FlashAttention-style fusion | P1 | ✅ Done | 2x | Tiled + online softmax, 3 device-aware tiers |
| Fused FFN kernel (gate+up weights) | P0 | ✅ Done | 1.2-1.3x | 3→2 passes via gate+up weight concatenation |
| Matmul+SiLU epilogue fusion | P2 | ⬜ TODO | 1.1-1.2x | 2→~1.5 passes, fuse first matmul with split+SiLU |
| Full f16 activation pipeline | P0 | ⏳ Partial | 1.5-2x | F16 KV cache done; F32 activations intentional |
| W4A16 quantized matmul | P0 | ✅ Done | 2-3x | Fused Q4K kernel in `matmul_q4_fused.wgsl` |

### 1.4 Model Validation

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Gemma 3 1B E2E | P0 | ✅ Done | Dec 2025 |
| Gemma 3 4B E2E | P0 | ⬜ TODO | Same arch as 1B |
| Llama 3.2 1B E2E | P0 | ⬜ TODO | Standard Llama |
| Llama 3.2 3B E2E | P0 | ⬜ TODO | Standard Llama |
| Llama 3.1 8B E2E | P1 | ⬜ TODO | Needs unified mem |
| Mistral 7B E2E | P1 | ⬜ TODO | Standard Llama-like |
| Validate 8GB model load | P0 | ⬜ TODO | Memory test |
| Validate 16GB model load | P1 | ⬜ TODO | Large model test |

### 1.5 Performance Roadmap (6 → 40+ tok/s)

**Current:** ~6 tok/s decode on Gemma 1B (M3)
**Target:** ≥40 tok/s decode (6.7x improvement needed)

| Optimization | Est. Speedup | Cumulative | Priority | Status |
|--------------|--------------|------------|----------|--------|
| Column-major weight layout | 1.5-2x | 1.5-2x | P0 | ✅ Done (use `--transpose-weights` in rdrr-writer) |
| Fused Q4K matmul | 1.3-1.5x | 2-3x | P0 | ✅ Done (`useFusedQ4K = true` in loader) |
| F16 KV cache auto-detect | - | - | P0 | ✅ Done (init.ts auto-selects F16 when supported) |
| BF16→F16 matmul weights | 1.2-1.5x | 2.5-4x | P0 | ✅ Done (spans path fixed Dec 2025) |
| FFN gate+up fusion (3→2 passes) | 1.2-1.3x | 3-5x | P0 | ✅ Done |
| Complete workgroup auto-tuning | 1.1-1.2x | 3.5-6x | P1 | ⬜ TODO |

**Note:** Need to re-convert models with `--transpose-weights` flag to benefit from column-major layout.

**Conservative estimate:** 4-5x → 24-30 tok/s
**Optimistic estimate:** 6-7x → 36-42 tok/s

### 1.6 Column-Major Weight Storage

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Add `--transpose-weights` flag to rdrr-writer | P0 | ✅ Done | `transposeWeights` option in writer |
| Store layout metadata in manifest | P0 | ✅ Done | `weightsTransposed: true` in manifest |
| Update matmul kernel selection | P0 | ✅ Done | `matmul.ts` handles `transposeB` based on layout |
| Re-convert test models with column layout | P0 | ✅ Done | Use `--transpose-weights` flag |

**Implementation:** `rdrr-writer.ts` has `transposeWeights` option that pre-transposes matmul weights. Manifest stores `weightsTransposed: true`. Loader sets `transposeB: false` when weights are pre-transposed.

```
Row-major W[out, in]:     GPU reads strided
Column-major W^T[in, out]: GPU reads contiguous → 1.5-2x faster
```

### 1.7 Enable Fused Q4K Matmul

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Change `useFusedQ4K = true` | P0 | ✅ Done | Enabled in `doppler-loader.ts` |
| Validate Q4K block alignment | P0 | ✅ Done | 256-element blocks handled |
| Benchmark fused vs separate | P0 | ⏳ Pending | Need benchmark comparison |

**Status:** Fused Q4K kernel is now enabled by default. Single memory read for dequant+matmul.

### 1.8 FFN Gate+Up Fusion

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Concatenate gate+up weights in writer | P0 | ✅ Done | `--fuse-gate-up` flag in convert-cli |
| Add `gate_up_proj` tensor support | P0 | ✅ Done | Loader and manifest support |
| Update FFN to use fused path | P0 | ✅ Done | `layer.ts` and `ffn.ts` handle gateUp |
| Add split+SiLU kernel | P1 | ✅ Done | `runSiLURowSplit` kernel |

**Status:** Implemented. Models converted with `--fuse-gate-up` use 2 matmul passes.
**Impact:** 1.2-1.3x FFN speedup (gate+up fused, then down)

```typescript
// Current: 3 passes
gate = matmul(input, gateWeight)   // Pass 1
up = matmul(input, upWeight)       // Pass 2
out = matmul(silu(gate)*up, down)  // Pass 3

// Proposed: 2 passes
gateUp = matmul(input, gateUpWeight)  // Pass 1 (fused)
out = matmul(silu_split(gateUp), down) // Pass 2
```

### 1.9 Workgroup Auto-Tuning (Complete)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Add benchmark loop to `_tuneAttention()` | P1 | ⬜ TODO | Currently returns `[64, 1, 1]` |
| Add benchmark loop to `_tuneSoftmax()` | P1 | ⬜ TODO | Currently returns `[256, 1, 1]` |
| Add benchmark loop to `_tuneRMSNorm()` | P1 | ⬜ TODO | Currently returns `[256, 1, 1]` |
| Add benchmark loop to `_tuneDequant()` | P1 | ⬜ TODO | Currently returns `[64, 1, 1]` |

**Current:** Only matmul has real benchmarking; others use hardcoded sizes.
**Fix:** Add benchmark loops following `_tuneMatmul()` pattern for 1.1-1.2x improvement.

### 1.10 Precision Optimization (Q4/BF16/F16)

**Target Precision Stack:**
```
Weights:     Q4_K_M (quantized, 4-bit) → keeps model size small
Matmul:      Fused Q4K kernel (dequant + matmul in one pass)
KV Cache:    F16 (not F32) → 2x memory savings
Activations: F16 where possible, F32 for numerically sensitive ops
Embeddings:  BF16 → F16 (converted at load time)
Norms:       BF16 → F32 (for numerical stability)
```

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Enable fused Q4K matmul | P0 | ✅ Done | `useFusedQ4K = true` in doppler-loader.ts |
| Default KV cache to F16 | P0 | ✅ Done | `init.ts` auto-detects F16 when GPU supports it |
| F16 matmul output for F16 weights | P0 | ✅ Done | matmul.ts selects F16 output when inputs are F16 |
| BF16→F16 for matmul weights | P0 | ✅ Done | `_shouldDequantizeToF16()` + spans path fixed |
| Remove unnecessary F32 intermediates | P1 | ⬜ TODO | Audit pipeline for F32 allocations |
| F16 activation pipeline | P2 | ⬜ TODO | Trade-off: speed vs accuracy |

**Implementation Notes:**

1. **KV Cache auto-detects F16:**
```typescript
// init.ts:267-269
const caps = getKernelCapabilities();
const kvDtype = caps?.hasF16 ? 'f16' : 'f32';
```

2. **Fused Q4K enabled:**
```typescript
// doppler-loader.ts - useFusedQ4K = true by default
```

3. **BF16 → F16 conversion:**
```typescript
// Both direct load and spans path now convert BF16 → F32 → F16 for matmul weights
// This enables optimized F16 GEMV kernels
```

**WebGPU Precision Constraints:**
- WebGPU has **no native BF16 support** - must convert to F16 or F32
- F16 requires `shader-f16` feature (detected via `gpuCaps.hasF16`)
- Q4K fused kernel requires subgroup support (detected via `gpuCaps.hasSubgroups`)

**Expected Impact:**
| Change | Memory Savings | Speed Impact |
|--------|---------------|--------------|
| F16 KV cache | 2x KV memory | ~same |
| Fused Q4K | ~same | 1.3-1.5x faster |
| F16 activations | 2x activation memory | ~1.2x faster (bandwidth) |

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Decode tok/s (Gemma 1B, M3) | >= 40 | ~6 | ⬜ |
| Time to first token | <= 800ms | ~360ms | ✅ |
| VRAM usage vs WebLLM | <= 110% | TBD | ⬜ |

---

## Key Files

| File | Purpose |
|------|---------|
| `gpu/command-recorder.ts` | Command buffer batching |
| `gpu/buffer-pool.ts` | Buffer reuse |
| `gpu/kernels/*.wgsl` | WGSL shader sources |
| `gpu/kernels/matmul.ts` | Matmul kernel selection, layout handling |
| `gpu/kernels/matmul_q4_fused.wgsl` | Fused Q4K dequant+matmul |
| `gpu/kernel-selector.ts` | Kernel dispatch |
| `gpu/kernel-tuner.ts` | Workgroup auto-tuning |
| `inference/pipeline.ts` | Forward pass orchestration |
| `inference/pipeline/ffn.ts` | FFN with gate+up fusion support |
| `loader/doppler-loader.ts` | Model loading, `useFusedQ4K` flag |
| `tools/rdrr-writer.ts` | Weight transpose, gate+up fusion |
| `storage/rdrr-format.ts` | Manifest types, layout metadata |

---

## Dependencies

None - this is the foundational phase.

---

## Next Phase

[Phase 2: MoE Efficiency](PHASE_2_MOE.md) - Requires buffer reuse and async pipeline from Phase 1.

---

*Last updated: December 2025*
