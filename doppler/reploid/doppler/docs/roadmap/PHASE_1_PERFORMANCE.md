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
- [x] Fused decode path (layers+logits+argmax) ✅ Dec 2025
- [x] GPU sampling (argmax on GPU) ✅ Dec 2025
- [ ] 40+ tok/s decode on Gemma 3 1B (P0) - currently ~7 tok/s (6x gap)
- [ ] GPU timestamp profiling to identify bottleneck (P0)
- [ ] Llama 3.2 models validated (P0)

---

## Work Items

### 1.1 WeInfer Optimizations (Critical Path)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Command buffer batching | P0 | ✅ Done | `gpu/command-recorder.ts` |
| Buffer reuse strategy | P0 | ✅ Done | `gpu/buffer-pool.ts` |
| GPU-side sampling | P0 | ✅ Done | Fused argmax, reads 4 bytes/token (was 1MB) |
| Fused decode path | P0 | ✅ Done | Single submit for layers+logits+argmax |
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
| Multi-column GEMV (LM head) | P0 | ✅ Done | ~0% | 32 cols/wg in `matmul_gemv_subgroup.wgsl` - LM head not bottleneck |
| Workgroup size auto-tuning | P1 | ⏳ Partial | 1.2-1.5x | Framework exists; only matmul benchmarks, others hardcoded |
| FlashAttention-style fusion | P1 | ✅ Done | 2x | Tiled + online softmax, 3 device-aware tiers |
| Fused FFN kernel (gate+up weights) | P0 | ✅ Done | 1.2-1.3x | 3→2 passes via gate+up weight concatenation |
| Kernel uniform audit (vs constants) | P0 | ⬜ TODO | Config fidelity | Catalog kernels with baked constants (e.g. `gpu/kernels/attention*.wgsl`, `matmul_q4_fused.wgsl`), add manifest-sourced uniforms so `tools/convert-cli.ts` → `storage/rdrr-format.ts` → runtime config stay in sync |
| Matmul+SiLU epilogue fusion | P2 | ⬜ TODO | 1.1-1.2x | 2→~1.5 passes, fuse first matmul with split+SiLU |
| Full f16 activation pipeline | P0 | ⏳ Partial | 1.5-2x | F16 KV cache done; F32 activations intentional |
| W4A16 quantized matmul | P0 | ✅ Done | 2-3x | Fused Q4K kernel in `matmul_q4_fused.wgsl` |

### 1.4 Model Validation

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Gemma 3 1B E2E | P0 | ✅ Done | Dec 2025 |
| Gemma 3 4B E2E | P0 | ⬜ TODO | Same arch as 1B |
| Gemma 3 variant regression tests (8 SKUs) | P0 | ⬜ TODO | Re-run suites for the variants whose weights changed |
| Llama 3.2 1B E2E | P0 | ⬜ TODO | Standard Llama |
| Llama 3.2 3B E2E | P0 | ⬜ TODO | Standard Llama |
| Llama 3.1 8B E2E | P1 | ⬜ TODO | Needs unified mem |
| Mistral 7B E2E | P1 | ⬜ TODO | Standard Llama-like |
| Validate 8GB model load | P0 | ⬜ TODO | Memory test |
| Validate 16GB model load | P1 | ⬜ TODO | Large model test |

### 1.5 Performance Roadmap (8 → 40+ tok/s)

**Current:** ~8 tok/s decode on Gemma 3 1B (M3) - Dec 2025 benchmark (column_wise Q4K)
**Target:** ≥40 tok/s decode (5x improvement needed)

| Optimization | Est. Speedup | Cumulative | Priority | Status |
|--------------|--------------|------------|----------|--------|
| Column-wise Q4K layout | **2.7x** | 2.7x | P0 | ✅ Done (`--q4k-layout column_wise` default) |
| Fused Q4K matmul | ~~1.3-1.5x~~ | ~~2-3x~~ | ~~P0~~ | ❌ **SLOWER** (see 1.7) |
| F16 KV cache auto-detect | - | - | P0 | ✅ Done (init.ts auto-selects F16 when supported) |
| BF16→F16 matmul weights | 1.2-1.5x | 2.5-4x | P0 | ✅ Done (spans path fixed Dec 2025) |
| FFN gate+up fusion (3→2 passes) | 1.2-1.3x | 3-5x | P0 | ✅ Done |
| GPU sampling (no logit readback) | 1.3-1.5x | 4-6x | P0 | ✅ Done (fused decode path) |
| Multi-column LM head GEMV | ~0% | - | P0 | ✅ Done (not bottleneck - see 1.11) |
| GPU timestamp profiling | - | - | P0 | ⬜ TODO (identify actual bottleneck) |
| Complete workgroup auto-tuning | 1.1-1.2x | 4.5-7x | P1 | ⬜ TODO |
| Speculative decoding | 2-3x | 9-21x | P2 | ⬜ Framework ready |

**Note:** Need to re-convert models with `--transpose-weights` flag to benefit from column-major layout.

**Performance progression (Dec 2025):**
| Stage | tok/s | Key Change |
|-------|-------|------------|
| Baseline (debug mode) | 2 | CPU sampling for first 5 tokens |
| + GPU sampling fix | 3.3 | Removed `!isDebugStep` gate |
| + Command batching | 4 | Set `debug: false` in benchmark |
| + Fused decode path | 7 | Single submit for layers+logits+argmax |

**Remaining gap analysis:**
- WebLLM achieves ~24 ms/token vs DOPPLER ~140 ms/token (6x gap)
- LM head multicol optimization had no effect → bottleneck is elsewhere
- Need GPU timestamp profiling to identify which of 156+ matmuls per forward pass is slowest

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
| Q4K | **Column-wise ✅** | Column-wise | **BENCHMARKED** (converter uses `--q4k-layout column_wise` by default) |

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

**Column-wise Q4K:** Blocks organized by input column - **BENCHMARKED FASTEST ✅**
```
Col 0: [blk0][blk5][blk10]...  ← All K positions for output 0
Col 1: [blk1][blk6][blk11]...  ← All K positions for output 1
```

#### Q4K Layout Benchmark Results (Dec 2025)

| Layout | Decode tok/s | vs Baseline | Notes |
|--------|--------------|-------------|-------|
| **column_wise** | **8.0** | +14% | **DEFAULT - FASTEST** |
| flat | 7.0 | baseline | Simple packing |
| row_wise | 3.0 | -57% | Fused kernel has poor thread utilization |

**Status:** ✅ Benchmarked in `tools/quantizer.ts` and `tools/convert-cli.ts`

**Available functions:**
- `quantizeToQ4KMColumnWise(data, shape)` - Column-aligned Q4K blocks **(DEFAULT)**
- `quantizeToQ4KMRowWise(data, shape)` - Row-aligned Q4K blocks
- `quantizeToQ4KM(data, shape)` - Flat sequential packing
- `getQ4KSize(shape, layout)` - Calculate expected Q4K size

**Usage:**
```bash
# Convert with column-wise Q4K (default - fastest for GEMV decode)
npx tsx doppler/tools/convert-cli.ts model/ output/ --quantize q4_k_m

# Explicitly specify layout
npx tsx doppler/tools/convert-cli.ts model/ output/ --quantize q4_k_m --q4k-layout column_wise
```

**Why column-wise is fastest:**

For GEMV (decode with M=1), computing `C[1, N] = A[1, K] × B[K, N]`:
- Each output column needs to read ALL K weights for that column
- Column-wise packing: column j's blocks are **contiguous in memory**
- Dequant kernel reads contiguous blocks → coalesced GPU access → high bandwidth

**Row-wise is SLOWER because:**
- The fused Q4K kernel has 256 threads per workgroup
- For K=1152, there are only 5 Q4K blocks per row
- **251 of 256 threads are IDLE** → massive underutilization
- See section 1.7 for details

**References:**
- [NVIDIA Efficient Matrix Transpose](https://developer.nvidia.com/blog/efficient-matrix-transpose-cuda-cc/)
- [WebGPU Matmul 1TFLOP Optimization](https://www.nuss-and-bolts.com/p/optimizing-a-webgpu-matmul-kernel)
- [llama.cpp K-Quants Discussion](https://github.com/ggml-org/llama.cpp/discussions/5063)

### 1.7 Fused Q4K Matmul - ❌ SLOWER THAN DEQUANT

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Change `useFusedQ4K = true` | P0 | ⚠️ Disabled | Enabled but bypassed via kernel hints |
| Validate Q4K block alignment | P0 | ✅ Done | Row-wise/column-wise implemented |
| Benchmark fused vs separate | P0 | ✅ **DONE** | **Fused is 2.7x SLOWER** |

**Status:** ❌ **FUSED KERNEL IS SLOWER** - Benchmarks show dequant path is faster.

**Benchmark Results (Dec 2025):**

| Path | Layout | tok/s | Notes |
|------|--------|-------|-------|
| **Dequant → F16 GEMV** | column_wise | **8.0** | **DEFAULT** |
| Dequant → F16 GEMV | flat | 7.0 | Good fallback |
| Fused Q4K kernel | row_wise | 3.0 | **2.7x SLOWER** |

**Root Cause: Poor Thread Utilization**

The fused Q4K kernel (`matmul_q4_fused.wgsl`) has a fundamental design issue:

```
For Gemma 3 1B with K=1152:
- Q4K block size: 256 weights
- Blocks per row: ceil(1152/256) = 5 blocks
- Threads per workgroup: 256

Problem: 5 blocks ÷ 256 threads = 5 active threads
         251 of 256 threads (98%) are IDLE per workgroup!
```

**Why this happens:**
```wgsl
// matmul_q4_fused.wgsl (simplified)
@compute @workgroup_size(256, 1, 1)
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
  let block_idx = lid.x;  // 0-255
  let num_blocks = (K + 255) / 256;  // = 5 for K=1152

  if (block_idx >= num_blocks) { return; }  // 251 threads exit immediately!

  // Only 5 threads do actual work...
}
```

**Current mitigation:**
- Converter defaults to `--q4k-layout column_wise`
- Loader uses dequant path via `kernelHints.q4kMatmul = 'dequant_f16'`
- Fused kernel still available for future optimization

**Future fix options:**
1. **Redesign kernel:** Multiple blocks per thread (loop over blocks)
2. **2D workgroup:** Use [32, 8, 1] instead of [256, 1, 1]
3. **Different kernel for small K:** Switch strategy based on K dimension

**Files:**
- `gpu/kernels/matmul_q4_fused.wgsl` - Fused kernel (needs redesign)
- `gpu/kernel-hints.ts` - `q4kMatmul: 'dequant_f16'` bypasses fused
- `loader/doppler-loader.ts` - `useFusedQ4K` flag (currently ignored via hints)

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

### 1.11 F16 GEMV Multi-Column Kernel (LM Head)

**Status:** ✅ Implemented, marginal impact

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Add `gemv_subgroup_multicol` config to utils.ts | P0 | ✅ Done | Lines 89-96 |
| Update runMatmul variant selection for N > 8192 | P0 | ✅ Done | Lines 263-267 |
| Update recordMatmul variant selection | P0 | ✅ Done | Lines 546-553 |
| Update workgroup calculation for 32 cols/wg | P0 | ✅ Done | Lines 314-315, 581-582 |
| Update dispatch logic for multicol | P0 | ✅ Done | Lines 404-406, 664-666 |
| Benchmark performance impact | P0 | ✅ Done | ~7 tok/s (no change from 4-col kernel) |

**Problem Identified:**

For Gemma 3's 262K vocab LM head with F16 tied embeddings:
- Original `gemv_subgroup`: 4 columns/workgroup → 65,536 workgroups
- New `gemv_subgroup_multicol`: 32 columns/workgroup → 8,192 workgroups (8x fewer)

```
LM head: M=1, N=262144, K=1152
Weight size: 262144 × 1152 × 2 bytes (F16) = 603MB per token read
```

**Implementation:**

```typescript
// matmul.ts selection logic (lines 263-267)
if (N > MULTICOL_THRESHOLD) {  // MULTICOL_THRESHOLD = 8192
  variant = 'gemv_subgroup_multicol';
} else {
  variant = 'gemv_subgroup';
}

// Workgroup dispatch (lines 314-315)
if (variant === 'gemv_subgroup_multicol') {
  gemvWorkgroupsX = Math.ceil(N / 32);  // 32 columns per workgroup
}
```

**Findings:**

| Metric | Before (4-col) | After (32-col) | Change |
|--------|----------------|----------------|--------|
| Workgroups | 65,536 | 8,192 | -87% |
| Decode tok/s | ~7 | ~7 | ~0% |
| Per-token latency | ~140ms | ~140ms | ~0% |

**Analysis:**

The 8x reduction in workgroups did NOT improve performance. This indicates:

1. **LM head is not the dominant bottleneck** - The 26 transformer layers have 4 matmuls each (Q/K/V/O projections) plus 2 FFN matmuls = 156 matmul operations per forward pass. The single LM head matmul may be <5% of total time.

2. **Need GPU timestamp profiling** - Must use `gpu/profiler.ts` to measure individual kernel execution times and identify the actual bottleneck.

3. **Memory bandwidth limited** - 603MB weight read per token at theoretical 200GB/s = 3ms minimum. Observed ~140ms suggests compute or other overheads dominate.

**Next Steps:**
- Profile with GPU timestamps to identify slowest kernels
- Consider speculative decoding to amortize LM head across multiple tokens
- Optimize layer matmul kernels if they prove to be bottlenecks

**Files Modified:**
- `gpu/kernels/utils.ts` - Added `gemv_subgroup_multicol` config
- `gpu/kernels/matmul.ts` - Updated selection and dispatch logic
- `gpu/kernels/matmul_gemv_subgroup.wgsl` - Kernel already existed (lines 130-213)

### 1.12 Readback Minimization (Critical)

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

### 1.13 Kernel Utilization Audit (P0)

**Goal:** Ensure all compute kernels have >50% thread utilization.

| Kernel | Workgroup | Active Threads | Utilization | Status |
|--------|-----------|----------------|-------------|--------|
| `q4_fused` | 256 | ceil(K/256) | **2%** (K=1152) | ❌ Use multicol |
| `q4_fused_multicol` | 256 | 32×ceil(K/256/8) | **62%** | ✅ Fixed |
| `q4_fused_batched` | 64×4 | 64×M | Varies | ⚠️ Audit |
| `gemv_subgroup` | 256 | 256 | **100%** | ✅ |
| `gemv_subgroup_multicol` | 256 | 256 | **100%** | ✅ |
| `dequant_q4k` | 64 | N×K/256 | **100%** | ✅ |
| `attention_*` | Varies | Varies | ⚠️ Audit | TODO |
| `rmsnorm` | 256 | hidden_size | **100%** | ✅ |
| `silu` | 256 | N | **100%** | ✅ |

**Fix Applied (Dec 2025):**
```typescript
// matmul.ts - Lowered threshold to use multicol for ALL layer matmuls
const MULTICOL_THRESHOLD = 256;  // Was 8192
// Now q4_fused_multicol used for q_proj (N=1024), gate_proj (N=6912), etc.
```

**Audit Checklist:**
- [x] Q4K fused GEMV (fixed: use multicol for N>256)
- [ ] Q4K fused batched (M>1 prefill)
- [ ] Attention kernels (tiled_large, tiled_small, streaming)
- [ ] RoPE kernel
- [ ] Gather/embedding kernel

**How to audit a kernel:**
```
1. Find workgroup size: @compute @workgroup_size(X, Y, Z)
2. Count threads that exit early: if (id >= limit) { return; }
3. Calculate: utilization = active_threads / (X × Y × Z)
4. Fix if utilization < 50%
```

### 1.14 Shader Configuration Audit (P1)

**Goal:** Use uniforms over constants for runtime configurability.

**Why this matters:**
- `const` values are compiled into shader → requires shader recompilation to change
- `uniform` values are set at dispatch time → can be configured via manifest/kernelHints
- Enables manifest → config → kernel layering without shader rebuilds

**Audit Checklist:**
| Kernel | Hardcoded Constants | Should Be Uniform | Status |
|--------|---------------------|-------------------|--------|
| `matmul_q4_fused.wgsl` | `COLS_PER_WG=32`, `THREADS_PER_COL_GEMV=8` | Yes (tune per device) | ⬜ TODO |
| `matmul_gemv_subgroup.wgsl` | `MULTICOL=32` | Yes | ⬜ TODO |
| `attention_*.wgsl` | `TILE_SIZE`, `HEAD_DIM` | Partial (head_dim varies) | ⬜ TODO |
| `dequant.wgsl` | `BLOCK_SIZE=256` | No (Q4K spec) | ✅ OK |
| `rmsnorm.wgsl` | `WG_SIZE=256` | Maybe | ⬜ TODO |

**Example migration:**
```wgsl
// Before (hardcoded):
const COLS_PER_WG: u32 = 32u;

// After (configurable via uniform):
struct KernelConfig {
    cols_per_wg: u32,
    threads_per_col: u32,
    // ... other tuning params
}
@group(0) @binding(4) var<uniform> config: KernelConfig;
```

**Benefits:**
1. Manifest `kernelHints.colsPerWorkgroup` → config struct → shader uniform
2. Device-specific tuning without shader variants
3. Auto-tuner can test different configs without recompilation

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Decode tok/s (Gemma 3 1B, M3) | >= 40 | **~8** | ⬜ (5x gap) |
| Per-token latency | <= 25ms | **~125ms** | ⬜ (5x gap) |
| Time to first token | <= 800ms | **~650ms** | ✅ Achieved |
| VRAM usage vs WebLLM | <= 110% | ~980MB (Q4K) | ✅ |
| Readback bytes/token | <= 4KB | 4 bytes | ✅ (fused argmax) |

**Dec 2025 Benchmark (M3 MacBook):**

| Variant | Decode tok/s | TTFT | VRAM |
|---------|--------------|------|------|
| Q4K column_wise | 8.0 | 650ms | 979MB |
| Q4K flat | 7.0 | 700ms | 965MB |
| Q4K row_wise | 3.0 | 1600ms | 992MB |
| F16 | 9.4 | 540ms | 1.9GB |

**WebLLM comparison (WeInfer paper):**
- WebLLM on Qwen2-1.5B: 24.18 ms/token (~41 tok/s)
- DOPPLER on Gemma 3 1B: ~125 ms/token (~8 tok/s)
- Gap: ~5x (was 10x before optimizations, was 6x before column_wise)

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
| `gpu/profiler.ts` | GPU timestamp profiling |
| `gpu/kernels/*.wgsl` | WGSL shader sources |
| `gpu/kernels/utils.ts` | Kernel configs (incl. `gemv_subgroup_multicol`) |
| `gpu/kernels/matmul.ts` | Matmul kernel selection, layout handling, multicol dispatch |
| `gpu/kernels/matmul_q4_fused.wgsl` | Fused Q4K dequant+matmul (GEMV + multicol + batched) |
| `gpu/kernels/matmul_gemv_subgroup.wgsl` | F16 GEMV (4-col + 32-col multicol variants) |
| `gpu/kernels/sample.ts` | GPU argmax kernel (`recordArgmax` for batching) |
| `gpu/kernel-selector.ts` | Kernel dispatch |
| `gpu/kernel-tuner.ts` | Workgroup auto-tuning |
| `inference/pipeline.ts` | Forward pass, fused decode path (lines 686-737) |
| `inference/pipeline/logits.ts` | `recordLogitsGPU` for batched logits computation |
| `inference/pipeline/ffn.ts` | FFN with gate+up fusion support |
| `loader/doppler-loader.ts` | Model loading, `useFusedQ4K` flag |
| `tools/rdrr-writer.ts` | Weight transpose, gate+up fusion |
| `tools/convert-cli.ts` | Converter with `--q4k-layout` flag |
| `storage/rdrr-format.ts` | Manifest types, layout metadata |

---

## Dependencies

None - this is the foundational phase.

---

## Next Phase

[Phase 2: MoE Efficiency](PHASE_2_MOE.md) - Requires buffer reuse and async pipeline from Phase 1.

---

*Last updated: December 2025*
