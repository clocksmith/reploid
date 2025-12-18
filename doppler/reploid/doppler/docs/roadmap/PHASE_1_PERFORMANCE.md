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
- [ ] 40+ tok/s decode on Gemma 3 1B (P0) - currently ~6 tok/s
- [ ] Llama 3.2 models validated (P0)

---

## Work Items

### 1.1 WeInfer Optimizations (Critical Path)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Command buffer batching | P0 | ✅ Done | `gpu/command-recorder.ts` |
| Buffer reuse strategy | P0 | ✅ Done | `gpu/buffer-pool.ts` |
| GPU-side sampling | P0 | ⚠️ Partial | Kernel exists but reading full 1MB logits, not single token |
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

**Current:** ~3 tok/s decode on Gemma 3 1B (M3) - Dec 2025 benchmark
**Target:** ≥40 tok/s decode (13x improvement needed)

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
| **Row-wise Q4K quantization** | P0 | ✅ **Done** | `--q4k-layout row_wise` (default) in convert-cli |
| Column-wise Q4K (batched matmul only) | P2 | ⬜ TODO | Only helps prefill, not decode |

**Implementation:** `rdrr-writer.ts` has `transposeWeights` option that pre-transposes matmul weights. Manifest stores `weightsTransposed: true`. Loader sets `transposeB: false` when weights are pre-transposed.

#### Why Column-Major is Faster (GPU Coalescing)

**The operation:** `output[1, out] = input[1, K] @ weight[out, K]^T`

When threads in a GPU warp access consecutive memory addresses, the hardware coalesces into a single transaction. Strided access splits into multiple transactions → high latency.

```
Row-major W[out, K]:
Thread 0 reads W[0, 0]    ← address 0
Thread 1 reads W[1, 0]    ← address K (strided - BAD)
Thread 2 reads W[2, 0]    ← address 2K

Column-major W^T[K, out]:
Thread 0 reads W^T[0, 0]  ← address 0
Thread 1 reads W^T[0, 1]  ← address 1 (contiguous - GOOD)
Thread 2 reads W^T[0, 2]  ← address 2
```

| Layout | Memory Pattern | GPU Coalescing | Performance |
|--------|----------------|----------------|-------------|
| Row-major W[out, K] | Row i contiguous | Threads read strided | Slower |
| Column-major W^T[K, out] | Column i contiguous | Threads read contiguous | **1.5-2x faster** |

#### Current State by Format

| Format | Current Layout | Optimal Layout | Status |
|--------|---------------|----------------|--------|
| F16/BF16 | Column-major ✅ | Column-major | Done |
| Q4K | Row-wise ✅ | Row-wise | **IMPLEMENTED** (converter uses `--q4k-layout row_wise` by default) |

#### Q4K Block Layout Problem

Q4K has 256-value super-blocks with embedded metadata:
```
Block (144 bytes): [d: f16, dmin: f16, scales: 12B, nibbles: 128B]
```

**Current (flat packed):** Blocks cross row boundaries
```
Flat: [blk0][blk1][blk2][blk3][blk4][blk5]...
       ←─row 0──→←─row 0──→←row 1→←─row 1──→  ← WRONG!
```

**Row-wise Q4K:** Blocks aligned to rows (kernel expectation) - **IMPLEMENTED ✅**
```
Row 0: [blk0][blk1][blk2][blk3][blk4] ← K=1152 needs ceil(1152/256)=5 blocks
Row 1: [blk5][blk6][blk7][blk8][blk9]
```

#### Row-wise Q4K Fix - IMPLEMENTED

**Status:** ✅ Implemented in `tools/quantizer.ts` and `tools/convert-cli.ts`

**New functions:**
- `quantizeToQ4KMRowWise(data, shape)` - Row-aligned Q4K blocks
- `quantizeToQ4KMColumnWise(data, shape)` - Transpose + row-wise (for future batched matmul)
- `transposeF32(data, shape)` - Matrix transpose helper
- `getQ4KSize(shape, layout)` - Calculate expected Q4K size

**Usage:**
```bash
# Convert with row-wise Q4K (default - recommended for GEMV decode)
npx tsx doppler/tools/convert-cli.ts model/ output/ --quantize q4_k_m

# Explicitly specify layout
npx tsx doppler/tools/convert-cli.ts model/ output/ --quantize q4_k_m --q4k-layout row_wise
```

**Why row-wise, not column-wise?**

For GEMV (decode with M=1), the current fused Q4K kernel has:
- One workgroup per output column
- 256 threads split K dimension blocks
- Each thread processes blocks sequentially along row

**Row-wise is optimal for this design:**
- Row `col`'s blocks are contiguous at `col * num_blocks_per_row`
- Sequential block reads benefit from L2 cache
- Threads reading different K positions in same row get coalesced access

**Column-wise would only help** for batched matmul (prefill with M > 1) where multiple threads read the same K position across different output rows.

**References:**
- [NVIDIA Efficient Matrix Transpose](https://developer.nvidia.com/blog/efficient-matrix-transpose-cuda-cc/)
- [WebGPU Matmul 1TFLOP Optimization](https://www.nuss-and-bolts.com/p/optimizing-a-webgpu-matmul-kernel)
- [llama.cpp K-Quants Discussion](https://github.com/ggml-org/llama.cpp/discussions/5063)

### 1.7 Enable Fused Q4K Matmul

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Change `useFusedQ4K = true` | P0 | ✅ Done | Enabled in `doppler-loader.ts` |
| Validate Q4K block alignment | P0 | ✅ **FIXED** | Row-wise quantization implemented |
| Benchmark fused vs separate | P0 | ⏳ Pending | Need benchmark comparison |

**Status:** ✅ **FIX AVAILABLE** - Converter now produces row-wise Q4K by default.

**Previous issue (flat-packed models):**
```
[DopplerLoader] Packed Q4K matmul weight (incompatible with fused matmul):
model.layers.0.self_attn.q_proj.weight shape=[1024,1152] size=663552 expectedRowwise=737280
Falling back to dequantized weights for correctness.
```

**Fix:** Re-convert models with the updated converter:
```bash
npx tsx doppler/tools/convert-cli.ts model/ output/ --quantize q4_k_m
# Now uses row-wise Q4K by default (--q4k-layout row_wise)
```

**Expected impact:** Fused kernel should work after re-conversion. ~1.5-2x faster matmul.

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

### 1.11 Readback Minimization (Critical)

**Current:** 128KB/token (full vocab logits: 262144 × 4 bytes)
**Target:** 4 bytes/token (single token ID)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| GPU argmax kernel | P0 | ⬜ TODO | Return single i32 instead of full logits |
| GPU top-k sampling | P0 | ⬜ TODO | Sample on GPU, read only token ID |
| Measure readback overhead | P0 | ⬜ TODO | Isolate GPU→CPU transfer time |

**Impact:** Each 128KB readback costs 2-6ms. At 8 tokens, that's 1MB total readback.

**Measurement:**
```bash
# Check readback bytes per run
npm run doppler -- bench inference --prompt xs 2>&1 | grep "readback"
# Should see: gpu_readback_bytes_total in results JSON
```

**Implementation options:**
1. **GPU argmax:** Single parallel reduction → read 1 u32
2. **GPU top-k + sample:** Full sampling on GPU → read 1 u32
3. **Streaming readback:** Read only top-k logits (~1KB) instead of full vocab

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Decode tok/s (Gemma 3 1B, M3) | >= 40 | ~3 | ⬜ |
| Time to first token | <= 800ms | ~760ms | ⚠️ |
| VRAM usage vs WebLLM | <= 110% | TBD | ⬜ |
| Readback bytes/token | <= 4KB | 128KB | ⬜ |

**Measurement commands:**
```bash
# Quick performance check
npm run doppler -- bench inference --prompt xs --headed

# Check if fused Q4K is actually used
npm run doppler -- bench inference --prompt xs 2>&1 | grep -i "falling back"

# View detailed results
cat doppler/tests/results/*.json | jq '.metrics'
```

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
