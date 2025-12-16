# Phase 1: Performance Parity

**Status:** In Progress
**Prerequisites:** None (foundational)
**Goal:** Match or beat WebLLM performance for dense models.

---

## Milestones

- [x] Gemma 3 1B working E2E ✅ Dec 2025
- [ ] Llama 3.2 models validated (P0)
- [ ] 40+ tok/s decode on Gemma 1B (P0)
- [ ] Tiled matmul optimization (P0)

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
| Tiled matmul optimization | P0 | ⬜ TODO | 2-3x | Register tiling, shared memory |
| Subgroup operations | P0 | ⬜ TODO | 1.5x | `subgroupAdd`, `subgroupBroadcast` |
| Workgroup size auto-tuning | P1 | ⬜ TODO | 1.2-1.5x | Per-device optimal sizes |
| FlashAttention-style fusion | P1 | ⬜ TODO | 2x | Fused attention kernel |
| Fused FFN kernel | P1 | ⬜ TODO | 1.3x | Gate + up + down in one pass |
| Full f16 activation pipeline | P0 | ⏳ In Progress | 1.5-2x | End-to-end f16 |
| W4A16 quantized matmul | P0 | ⬜ TODO | 2-3x | 4-bit weights, 16-bit activations |

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
| `gpu/kernel-selector.ts` | Kernel dispatch |
| `inference/pipeline.ts` | Forward pass orchestration |

---

## Dependencies

None - this is the foundational phase.

---

## Next Phase

[Phase 2: MoE Efficiency](PHASE_2_MOE.md) - Requires buffer reuse and async pipeline from Phase 1.

---

*Last updated: December 2025*
