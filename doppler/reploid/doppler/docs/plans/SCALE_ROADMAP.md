# DOPPLER Scale Roadmap

**Part of:** [VISION.md](../VISION.md) - Phase 3 (Scale Beyond WebLLM)

Goal: Run models larger than WebLLM's ~31GB limit using tiered memory and dynamic expert paging.

**Prerequisites:** Phase 1-2 complete (performance parity, MoE efficiency)

---

## The Problem

WebLLM's limits:

| Constraint | WebLLM Limit | Cause |
|------------|--------------|-------|
| Model size | ~31GB | Compiled .wasm + weights must fit in memory |
| Expert count | All in memory | No dynamic paging |
| Context length | Fixed | Memory planned at compile time |

DOPPLER's advantage: Direct WGSL + runtime flexibility enables dynamic loading.

---

## Tiered Memory Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        GPU VRAM                              │
│                       (8-24 GB)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Active Layer│  │ Hot Experts │  │ KV Cache (active)   │  │
│  │   Weights   │  │  (top 25%)  │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~1ms
┌─────────────────────────────────────────────────────────────┐
│                    Unified Memory                            │
│                     (32-128 GB)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Warm Experts│  │ KV Overflow │  │ Prefetch Buffer     │  │
│  │  (next 50%) │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~50ms
┌─────────────────────────────────────────────────────────────┐
│                        OPFS Cache                            │
│                       (10-50 GB)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Cold Experts│  │ Model Shards│  │ LoRA Adapters       │  │
│  │  (rare 25%) │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~200ms
┌─────────────────────────────────────────────────────────────┐
│                        P2P Swarm                             │
│                       (Unlimited)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Rare Shards │  │ New Models  │  │ Community Adapters  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### 3.1 Unified Memory Validation

**Goal:** Prove 16GB+ models work on Apple Silicon unified memory.

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Detect unified memory architecture | P0 | Done | `memory/capability.ts` |
| Test 8GB model load | P0 | TODO | Llama 3.1 8B |
| Test 16GB model load | P0 | TODO | Needs larger model |
| Benchmark GPU↔unified latency | P1 | TODO | Measure actual overhead |
| Document memory tier selection | P1 | TODO | |

**Target:** Run 16GB model on M1 Pro (16GB unified) without VRAM overflow.

### 3.2 Expert Paging from OPFS

**Goal:** MoE models with experts loaded on-demand from OPFS cache.

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Expert-level shard granularity | P0 | TODO | RDRR manifest change |
| `loadExpert(layerIdx, expertIdx)` API | P0 | TODO | `loader/doppler-loader.ts` |
| Expert LRU cache in VRAM | P0 | TODO | Track hot experts |
| Prefetch next-layer experts | P1 | TODO | Overlap with compute |
| Expert hit rate tracking | P1 | TODO | Metrics for tuning |

**Target:** Run Mixtral 8x7B with only 2 experts in VRAM at a time.

### 3.3 Expert Paging from P2P

**Goal:** Fetch rare experts from swarm when not in OPFS.

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Expert shard request protocol | P0 | TODO | Extend P2P.md |
| Expert availability announcements | P0 | TODO | Who has what |
| Parallel expert fetch | P1 | TODO | Multiple peers |
| Expert verification | P0 | TODO | Hash check before use |

**Target:** Cold expert fetch < 500ms from swarm.

### 3.4 KV Cache Overflow

**Goal:** Context lengths beyond VRAM capacity.

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| KV cache spill to unified memory | P1 | TODO | For long contexts |
| Sliding window + spill hybrid | P2 | TODO | Keep recent in VRAM |
| KV cache compression | P2 | TODO | Reduce memory footprint |

**Target:** 128K context on 8GB VRAM via overflow.

---

## Target Capabilities

| Capability | WebLLM | DOPPLER Phase 3 |
|------------|--------|-----------------|
| Max model (unified mem) | ~31GB | **60GB+** |
| Max model (with paging) | ~31GB | **100GB+ (MoE)** |
| Dynamic expert loading | No | **Yes** |
| Cross-session persistence | No | **Yes (OPFS)** |
| Expert prefetch | No | **Yes** |
| KV cache overflow | No | **Planned** |

---

## Model Targets

| Model | Total Size | Active Size | Strategy |
|-------|------------|-------------|----------|
| Llama 3.1 8B | ~8GB | 8GB | Unified memory |
| Llama 3.1 70B | ~35GB | 35GB | Unified memory (64GB Mac) |
| Mixtral 8x7B | ~90GB | ~24GB | Expert paging |
| GPT-OSS 20B | ~40GB | ~8GB | Expert paging |
| DeepSeek-V3 | ~671GB | ~37GB | Expert paging + P2P |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| 16GB model on 16GB unified | Works without OOM |
| Mixtral expert page latency | < 100ms from OPFS |
| Mixtral expert page latency | < 500ms from P2P |
| Expert cache hit rate | > 80% after warmup |
| No regression on small models | Same tok/s as Phase 1 |

---

## Dependencies

- **Phase 1:** Buffer reuse, async pipeline (reduces base memory pressure)
- **Phase 2:** MoE routing works efficiently
- **P2P.md:** Shard distribution protocol for expert paging

---

## Files to Modify

| File | Changes |
|------|---------|
| `memory/capability.ts` | Unified memory detection, tier selection |
| `loader/doppler-loader.ts` | `loadExpert()` API, expert LRU |
| `storage/shard-manager.ts` | Expert-level shard granularity |
| `inference/pipeline.ts` | Expert prefetch scheduling |
| `inference/kv-cache.ts` | Overflow to unified memory |

---

*Last updated: December 2025*
