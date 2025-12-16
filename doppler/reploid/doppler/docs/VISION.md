# DOPPLER Vision & Roadmap

**Why DOPPLER exists:** Browser-native, dynamic LLM inference that can't be achieved with pre-compiled approaches like TVM/WebLLM.

---

## The Capability Thesis

The industry is fixated on a false dichotomy: **privacy vs. performance**. That is boring.

Reploid's value proposition is **Capability**. We are building the only architecture capable of running a 600B+ parameter model on a MacBook Air without lobotomizing the weights.

We achieve this by inverting the standard stack. Instead of bringing the data to a centralized model, we mount a **Distributed Mixture-of-Experts (MoE)** directly to the browser runtime via DOPPLER. The P2P mesh becomes an infinite-capacity cache tier for model weights.

**What we're building:**

- **Infrastructure:** A 600B+ parameter MoE mounted over P2P WebRTC mesh
- **Intelligence:** Hierarchical routers that stream specialized expert clusters on demand
- **Evolution:** LoRA adapters distributed as delta shards that upgrade model capabilities

We trade bandwidth (which is cheap) for intelligence (which is expensive). This delivers datacenter-grade capability on consumer-grade hardware. The big players can't pivot because their valuation depends on renting H100s.

---

## The Scale Math

A frontier-class model (e.g., DeepSeek-V3, 671B parameters) is not a monolithic binary. It is a file system of thousands of granular expert shards.

**RDRR Sharding Strategy:**
- Model sliced into ~9,600 **Expert Shards** (64MB each)
- 64MB optimized for WebRTC `RTCDataChannel` throughput
- Aligns with browser OPFS block allocation

**Content Addressing:**
- Request `SHA256(shard_bytes)`, not "Health Expert v1"
- Instant integrity verification
- P2P mesh acts as infinite-capacity L4 cache

**The Mount:**
- Reploid downloads a **Manifest** (~150KB), not the model
- Weights stay on the network until called
- MoE sparsity: only ~25% of experts active per token

**Tiered Storage:**

| Tier | Capacity | Latency | Contents |
|------|----------|---------|----------|
| GPU VRAM | 8-24GB | <1ms | Active experts, KV cache |
| Unified RAM | 32-128GB | ~5ms | Warm experts, session state |
| OPFS | 10-50GB | ~50ms | Cold experts, cached shards |
| P2P Swarm | Unlimited | ~200ms | Rare experts, full model |

**Result:** 600B model on consumer hardware.

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

| Phase | Goal | Status | Roadmap |
|-------|------|--------|---------|
| **1** | Performance Parity | In Progress | [PHASE_1_PERFORMANCE.md](roadmap/PHASE_1_PERFORMANCE.md) |
| **2** | MoE Efficiency | Partial | [PHASE_2_MOE.md](roadmap/PHASE_2_MOE.md) |
| **3** | Scale Beyond WebLLM | Planned | [PHASE_3_SCALE.md](roadmap/PHASE_3_SCALE.md) |
| **4** | P2P Distribution | Design | [PHASE_4_P2P.md](roadmap/PHASE_4_P2P.md) |
| **5** | Evolution | Design | [PHASE_5_EVOLUTION.md](roadmap/PHASE_5_EVOLUTION.md) |

```
Phase 1: Performance Parity ──┐
                              ├──▶ Phase 3: Scale Beyond WebLLM
Phase 2: MoE Efficiency ──────┤
                              ├──▶ Phase 4: P2P Distribution
                              │
                              └──▶ Phase 5: Evolution
```

---

## Success Criteria

| Phase | Criteria | Validation |
|-------|----------|------------|
| **1** | 40+ tok/s on Gemma 1B | Benchmark harness |
| **2** | Mixtral 8x7B with expert paging | E2E test |
| **3** | 40GB+ model on 16GB unified mem | Memory profiling |
| **4** | 10-peer swarm self-heals | P2P integration test |
| **5** | LoRA personalization working | User preference test |

---

## Related Documents

| Document | Content |
|----------|---------|
| [MODEL_SUPPORT.md](plans/MODEL_SUPPORT.md) | Model compatibility matrix |
| [COMPETITIVE.md](analysis/COMPETITIVE.md) | Competitor analysis |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current system design |
| [DOPPLER-TROUBLESHOOTING.md](DOPPLER-TROUBLESHOOTING.md) | Troubleshooting guide |

---

*Last updated: December 2025*
