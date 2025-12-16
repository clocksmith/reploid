# Phase 3: Scale Beyond WebLLM

**Status:** Planned
**Prerequisites:** Phase 1-2 (performance parity, MoE efficiency)
**Goal:** Run models larger than WebLLM's ~31GB limit using tiered memory.

---

## Milestones

- [x] Unified memory detection ✅
- [ ] 16GB model on 16GB unified memory (P0)
- [ ] 40GB+ model with expert paging (P0)
- [ ] 128K context via KV overflow (P1)

---

## Work Items

### 3.1 Unified Memory Support

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Detect unified memory architecture | P0 | ✅ Done | `memory/capability.ts` |
| Test 8GB model load | P0 | ⬜ TODO | Llama 3.1 8B |
| Test 16GB model load | P0 | ⬜ TODO | Needs larger model |
| Benchmark GPU↔unified latency | P1 | ⬜ TODO | Measure actual overhead |
| Document memory tier selection | P1 | ⬜ TODO | Auto-detection logic |

### 3.2 Expert Paging from P2P

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Expert shard request protocol | P0 | ⬜ TODO | Extend P2P spec |
| Expert availability announcements | P0 | ⬜ TODO | Peer inventory |
| Parallel expert fetch | P1 | ⬜ TODO | Multiple peers |
| Expert verification | P0 | ⬜ TODO | Hash check before use |

### 3.3 KV Cache Overflow

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| KV cache spill to unified memory | P1 | ⬜ TODO | For long contexts |
| Sliding window + spill hybrid | P2 | ⬜ TODO | Keep recent in VRAM |
| KV cache compression | P2 | ⬜ TODO | Reduce memory footprint |

---

## Architecture

### Tiered Memory

```
┌─────────────────────────────────────────────────────────────┐
│                        GPU VRAM (8-24 GB)                   │
│  Active layers │ Hot experts (top 25%) │ KV cache (active)  │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~1ms
┌─────────────────────────────────────────────────────────────┐
│                    Unified Memory (32-128 GB)               │
│  Warm experts (next 50%) │ KV overflow │ Prefetch buffer    │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~50ms
┌─────────────────────────────────────────────────────────────┐
│                        OPFS Cache (10-50 GB)                │
│  Cold experts (rare 25%) │ Model shards │ LoRA adapters     │
└─────────────────────────────────────────────────────────────┘
                              ↑↓ ~200ms
┌─────────────────────────────────────────────────────────────┐
│                        P2P Swarm (Unlimited)                │
│  Rare shards │ New models │ Community adapters              │
└─────────────────────────────────────────────────────────────┘
```

### WebLLM Limits vs DOPPLER

| Constraint | WebLLM Limit | DOPPLER Target |
|------------|--------------|----------------|
| Model size (unified mem) | ~31GB | 60GB+ |
| Model size (with paging) | ~31GB | 100GB+ (MoE) |
| Dynamic expert loading | No | Yes |
| Cross-session persistence | No | Yes (OPFS) |
| Context length | Fixed | Dynamic (KV overflow) |

---

## Target Models

| Model | Total Size | Active Size | Strategy |
|-------|------------|-------------|----------|
| Llama 3.1 8B | ~8GB | 8GB | Unified memory |
| Llama 3.1 70B | ~35GB | 35GB | Unified memory (64GB Mac) |
| Mixtral 8x7B | ~90GB | ~24GB | Expert paging |
| GPT-OSS 20B | ~40GB | ~8GB | Expert paging |
| DeepSeek-V3 | ~671GB | ~37GB | Expert paging + P2P |

---

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| 16GB model on 16GB unified | No OOM | - | ⬜ |
| Expert page latency (OPFS) | < 100ms | - | ⬜ |
| Expert page latency (P2P) | < 500ms | - | ⬜ |
| Expert cache hit rate | > 80% | - | ⬜ |
| No regression on small models | Same tok/s | - | ⬜ |

---

## Key Files

| File | Purpose |
|------|---------|
| `memory/capability.ts` | Unified memory detection |
| `loader/doppler-loader.ts` | `loadExpert()` API |
| `storage/shard-manager.ts` | Expert-level granularity |
| `inference/pipeline.ts` | Expert prefetch scheduling |
| `inference/kv-cache.ts` | Overflow to unified memory |

---

## Dependencies

- **Phase 1:** Buffer reuse, async pipeline
- **Phase 2:** MoE routing, expert paging infrastructure

---

## Next Phase

[Phase 4: P2P](PHASE_4_P2P.md) - Distributed shard distribution and remote inference.

---

*Last updated: December 2025*
