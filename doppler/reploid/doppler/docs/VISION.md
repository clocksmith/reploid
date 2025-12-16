# DOPPLER Vision & Roadmap

**Why DOPPLER exists:** Browser-native, dynamic LLM inference that can't be achieved with pre-compiled approaches like TVM/WebLLM.

---

## Why Direct WGSL (Not TVM)

WebLLM uses TVM to pre-compile model-specific .wasm binaries. This works but limits flexibility:

| Constraint | TVM/WebLLM | DOPPLER (Direct WGSL) |
|------------|------------|----------------------|
| New model | Requires offline compilation | Runtime-compatible if arch matches |
| Dynamic sharding | Not possible (fixed in binary) | Can load/unload experts dynamically |
| P2P model distribution | Must distribute compiled .wasm | Distribute weights only, kernels shared |
| Model evolution | Recompile entire model | Swap weight shards, keep kernels |
| Browser-only operation | Needs compilation toolchain | Fully in-browser |

**DOPPLER's bet:** Direct WGSL + runtime flexibility enables capabilities impossible with pre-compiled approaches.

---

## Phased Roadmap

```
Phase 1: Performance Parity
    ↓
Phase 2: MoE Efficiency
    ↓
Phase 3: Scale Beyond WebLLM
    ↓
Phase 4: P2P Self-Healing Agents
```

---

## Phase 1: Performance Parity

**Goal:** Match or beat WebLLM performance for a subset of models.

**Status:** In progress — **Gemma 3 1B working** (Dec 2025)

### 1.1 WeInfer Tactics (Critical)

Implement the techniques that gave WeInfer 3.76x speedup over WebLLM:

| Tactic | Status | Impact | Doc |
|--------|--------|--------|-----|
| Buffer reuse | TODO | High | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) |
| Async pipeline | TODO | High | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) |
| Deferred readback | TODO | High | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) |
| Command batching | **In Progress** | Critical | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) |

**Command batching progress:** Submit tracker created, `do*` wrappers for FFN/norms/residuals done, `CommandRecorder` infrastructure ready. Remaining: `recordCastF32ToF16`, attention refactor, pipeline integration.

### 1.2 Target Models

Focus on models where DOPPLER can win. See [MODEL_SUPPORT.md](plans/MODEL_SUPPORT.md) for full matrix.

| Model | Size | Status | Notes |
|-------|------|--------|-------|
| **Gemma 3 1B** | ~1GB | **Working** | E2E verified Dec 2025 |
| Gemma 3 4B | ~3GB | Planned | Same arch as 1B |
| Llama 3.2 3B | ~2GB | Planned | Popular, well-understood |

### 1.3 Success Metrics

| Metric | WebLLM Baseline | DOPPLER Target |
|--------|-----------------|----------------|
| Decode tok/s (Gemma 1B) | ~40 | >= 40 |
| Time to first token | ~800ms | <= 800ms |
| VRAM usage | Baseline | <= 110% baseline |

---

## Phase 2: MoE Efficiency

**Goal:** Run Mixture-of-Experts models efficiently with expert paging.

**Status:** Partial (GPT-OSS 20B experimental)

### 2.1 Current MoE Support

| Feature | Status | Notes |
|---------|--------|-------|
| GPU-native routing | Done | Custom softmax+topk in WGSL |
| Expert FFN execution | Done | Per-expert matmul |
| Scatter-add combination | Done | Custom WGSL kernel |
| Expert lazy loading | Partial | OPFS-based, needs P2P |
| Expert paging | TODO | Load on-demand from swarm |

### 2.2 Target MoE Models

| Model | Experts | Active | Total Size | Active Size |
|-------|---------|--------|------------|-------------|
| Mixtral 8x7B | 8 | 2 | ~90GB | ~24GB |
| GPT-OSS 20B | 32 | 4 | ~40GB | ~8GB |

### 2.3 Expert Paging Strategy

```
Local VRAM: Keep router + active experts
OPFS cache: Recently used experts
P2P swarm:  Rare experts fetched on-demand
```

**Key insight:** MoE sparsity means only ~25% of experts active per token. Page the rest.

---

## Phase 3: Scale Beyond WebLLM

**Goal:** Run models larger than WebLLM's ~31GB limit using clever sharding + MoE techniques.

**Status:** Planned

### 3.1 WebLLM's Limits

| Constraint | WebLLM Limit | Cause |
|------------|--------------|-------|
| Model size | ~31GB | Must fit compiled .wasm + weights in memory |
| Expert count | Limited | All experts in memory |
| Context length | Fixed at compile | Memory planned at compilation |

### 3.2 DOPPLER's Approach

**Tiered memory + dynamic sharding:**

| Tier | Storage | Latency | Use For |
|------|---------|---------|---------|
| GPU VRAM | 8-24GB | <1ms | Active layers, hot experts |
| Unified memory | 32-128GB | ~5ms | Warm experts, KV cache overflow |
| OPFS | 10-50GB | ~50ms | Cold experts, model shards |
| P2P swarm | Unlimited | ~200ms | Rare experts, model distribution |

### 3.3 Target Capabilities

| Capability | WebLLM | DOPPLER Target |
|------------|--------|----------------|
| Max model (unified mem) | ~31GB | 60GB+ |
| Max model (with paging) | ~31GB | 100GB+ (MoE) |
| Dynamic expert loading | No | Yes |
| Cross-session persistence | No | Yes (OPFS) |

### 3.4 Implementation Path

1. Validate 16GB model on unified memory Mac
2. Implement expert paging from OPFS
3. Implement expert paging from P2P swarm
4. Benchmark vs WebLLM Mixtral

---

## Phase 4: P2P Self-Healing Agents

**Goal:** Distributed, evolvable AI agents with verified model integrity.

**Status:** Vision (see [P2P.md](plans/P2P.md))

### 4.1 Core Capabilities

| Capability | Description |
|------------|-------------|
| **P2P shard distribution** | Peers share model weight shards via WebRTC |
| **Verified hashes** | Manifest contains SHA256/BLAKE3 of each shard |
| **Modifiable sharding** | Agents can request different shard granularity |
| **Model evolution** | LoRA adapters distributed as delta shards |
| **HITL verification** | Human approval for model updates |

### 4.2 Self-Healing Swarm

```
Agent A                    Agent B                    Agent C
   │                          │                          │
   │◄─── shard request ───────│                          │
   │──── verified shard ─────►│                          │
   │                          │◄─── shard request ───────│
   │                          │──── verified shard ─────►│
   │                          │                          │
   └──────────── mesh gossip: who has what ─────────────┘
```

**Self-healing:** If a peer goes offline, others fill the gap. Swarm maintains availability.

### 4.3 Model Evolution with HITL

```
1. Base model: verified hash H0
2. LoRA adapter proposed: hash H1
3. HITL review: human approves/rejects
4. If approved: swarm distributes H1
5. Peers can run base (H0) or evolved (H0+H1)
```

### 4.4 REPLOID Integration

DOPPLER is the "neuro computer" for REPLOID agents:

| REPLOID Component | DOPPLER Role |
|-------------------|--------------|
| Agent loop | Calls DOPPLER for inference |
| Tool execution | Model decides tool calls |
| Self-modification | Can swap model shards |
| Verification | Hash verification of weights |
| Evolution | LoRA distribution via P2P |

---

## Success Criteria by Phase

| Phase | Criteria | Validation |
|-------|----------|------------|
| **1** | Match WebLLM tok/s on Gemma 1B | Benchmark harness |
| **2** | Run Mixtral 8x7B with expert paging | E2E test |
| **3** | Run 40GB+ model on 16GB unified mem | Memory profiling |
| **4** | 10-peer swarm shares model, self-heals | P2P integration test |

---

## Related Documents

| Document | Content |
|----------|---------|
| [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) | Phase 1-2 implementation details |
| [SCALE_ROADMAP.md](plans/SCALE_ROADMAP.md) | Phase 3 tiered memory architecture |
| [P2P.md](plans/P2P.md) | Phase 4 P2P architecture |
| [MODEL_SUPPORT.md](plans/MODEL_SUPPORT.md) | Model compatibility matrix |
| [KERNEL_TESTS.md](plans/KERNEL_TESTS.md) | Kernel correctness tests |
| [COMPETITIVE.md](analysis/COMPETITIVE.md) | Competitor analysis |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current system design |
| [DEBUG.md](DEBUG.md) | Debugging guide |

---

*Last updated: December 2025*
