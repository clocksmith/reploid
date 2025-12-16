# Phase 2: MoE Efficiency

**Status:** Partial
**Prerequisites:** Phase 1 (buffer reuse, async pipeline)
**Goal:** Run Mixture-of-Experts models efficiently with expert paging.

---

## Milestones

- [x] GPU-native MoE routing working ✅
- [x] GPT-OSS 20B experimental ✅
- [ ] Mixtral 8x7B E2E with expert paging (P0)
- [ ] Expert cache hit rate > 80% (P1)

---

## Work Items

### 2.1 Core MoE Infrastructure

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| GPU-native routing (softmax+topk) | P0 | ✅ Done | Custom WGSL |
| Expert FFN execution | P0 | ✅ Done | Per-expert matmul |
| Scatter-add combination | P0 | ✅ Done | Custom WGSL kernel |
| MoE router with load balancing | P0 | ✅ Done | `inference/moe-router.ts` |

### 2.2 Expert Paging (OPFS)

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Expert-level shard granularity | P0 | ⬜ TODO | RDRR manifest change |
| `loadExpert(layerIdx, expertIdx)` API | P0 | ⬜ TODO | `loader/doppler-loader.ts` |
| Expert LRU cache in VRAM | P0 | ⬜ TODO | Track hot experts |
| Prefetch next-layer experts | P1 | ⬜ TODO | Overlap with compute |
| Expert hit rate tracking | P1 | ⬜ TODO | Metrics for tuning |

### 2.3 Model Validation

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| GPT-OSS 20B E2E | P0 | ⏳ Partial | Router works, experts loading |
| Convert Mixtral 8x7B to RDRR | P0 | ⬜ TODO | |
| Mixtral 8x7B E2E | P0 | ⬜ TODO | With expert swapping |
| Benchmark MoE decode throughput | P0 | ⬜ TODO | |
| Benchmark vs WebLLM Mixtral | P1 | ⬜ TODO | tok/s, TTFT, VRAM |

---

## Architecture

### Expert Paging Strategy

```
Local VRAM:   Router + active experts (top 25%)
OPFS cache:   Recently used experts (next 50%)
P2P swarm:    Rare experts (bottom 25%) → Phase 4
```

### MoE Sparsity

| Model | Total Experts | Active/Token | Total Size | Active Size |
|-------|---------------|--------------|------------|-------------|
| Mixtral 8x7B | 8 | 2 | ~90GB | ~24GB |
| GPT-OSS 20B | 32 | 4 | ~40GB | ~8GB |
| DeepSeek-V3 | 256 | 8 | ~671GB | ~37GB |

**Key insight:** Only ~25% of experts active per token. Page the rest.

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Mixtral 8x7B E2E | Working | - | ⬜ |
| Expert page latency (OPFS) | < 100ms | - | ⬜ |
| Expert cache hit rate | > 80% | - | ⬜ |
| VRAM usage (2 experts) | < 8GB | - | ⬜ |

---

## Key Files

| File | Purpose |
|------|---------|
| `inference/moe-router.ts` | Router implementation |
| `gpu/kernels/moe_gather.wgsl` | Expert gathering |
| `gpu/kernels/scatter_add.wgsl` | Output combination |
| `loader/doppler-loader.ts` | Expert loading API |
| `storage/shard-manager.ts` | Shard granularity |

---

## Dependencies

- **Phase 1:** Buffer reuse (reduces memory pressure during expert swapping)
- **Phase 1:** Async pipeline (enables expert prefetch overlap)

---

## Next Phase

[Phase 3: Scale](PHASE_3_SCALE.md) - Extends expert paging to unified memory and larger models.

---

*Last updated: December 2025*
