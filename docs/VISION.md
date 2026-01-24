# REPLOID Vision

**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference **D**oppler

---

## The Strategic Imperative

REPLOID exists to answer a fundamental question: **Can an AI agent safely improve itself within a constrained environment?**

Traditional software is static - written by humans, executed by machines. REPLOID inverts this paradigm: the agent reads, reasons about, and modifies its own source code. This is **Recursive Self-Improvement (RSI)** - the ability to enhance one's own cognitive architecture.

The browser provides an ideal sandbox for this experiment:

| Property | Benefit |
|----------|---------|
| **Isolation** | Browser security model provides containment |
| **Persistence** | IndexedDB enables durable state without external dependencies |
| **Accessibility** | No installation, runs anywhere with a browser |
| **Observability** | All operations are visible, debuggable, and reversible |

---

## Constraints Are the Engine

Reploid + Doppler use browser constraints as a forcing function for safe RSI: no
root access, no build chains, no opaque binaries. The system is mutable but
bounded, making self-modification auditable and reversible.

### Why Browser-Native RSI is Different

| Advantage | What it enables |
|-----------|-----------------|
| **Self-modification as data** | Code lives in VFS; edits hot-reload without rebuilds |
| **Zero-install replication** | Variants are URLs/bundles; easy A/B comparisons |
| **Tight CPU<->GPU loop** | Ouroboros contract enables kernel evolution in-process |
| **UI-native introspection** | Live dashboards and HITL gating are first-class |
| **Constraint-shaped evolution** | Resource limits favor compact, safer changes |

---

## Central Thesis

**Browser-native recursive self-improvement is feasible, and constraints make it better.**

| Component | Feasibility | Confidence |
|-----------|-------------|------------|
| Reploid (agent substrate) | **HIGH** | Feature-complete, well-architected |
| Doppler Phase 1 (40 tok/s) | **MEDIUM-HIGH** | Achievable with kernel work |
| Doppler Phase 2 (MoE paging) | **MEDIUM** | Active research area |
| Doppler Phase 3 (600B P2P) | **LOW** | Novel, unproven |
| Ouroboros (kernel RSI) | **UNKNOWN** | Novel research contribution |

---

## Claims, Evidence & Feasibility

### 1. Self-modification is operationally fast because code is data

**Claim:** Iteration is "edit -> reload" inside the same runtime, not "edit -> rebuild -> reinstall."

**Feasibility: HIGH**

**Project Evidence:**
- VFS-backed module loading and hot reload
- First-class tools for VFS edits and tool creation

**Project Sources:**
- `../README.md` - browser-native architecture
- `../src/capabilities/system/README.md` - VFS self-modification capabilities
- `../src/blueprints/0x00001B-write-tools-manifest.md` - write-tools definition

**Research:**
- Certified Self-Modifying Code (Yale)
- A Model for Self-Modifying Code (Springer)
- Harnessing Self-modifying Code for Resilient Software

---

### 2. Recursive Self-Improvement is a validated research direction

**Claim:** RSI loops are achievable with the right architectural constraints.

**Feasibility: MEDIUM-HIGH**

**Project Evidence:**
- Ouroboros architecture specifies self-modification capabilities
- Reploid can rewrite tools and Doppler kernels
- Evolution traces are logged for verification

**Project Source:**
- `../../docs/ARCHITECTURE.md` - Ouroboros architecture summary

**Research:**
- "Gödel Agent" (arXiv 2024)
- "RISE: Recursive Introspection" (NeurIPS 2024)
- "The Darwin Gödel Machine" (Sakana AI 2024)
- "STOP: Self-Taught Optimizer" (2024)

---

### 3. Ouroboros makes RSI a tight CPU<->GPU loop

**Claim:** A minimal, file-based contract constrains changes to a small surface, making co-evolution practical.

**Feasibility: UNKNOWN** (novel research contribution)

**Project Evidence:**
- SharedArrayBuffer + VFS contract with `inference.rdrr` and `evolution.trace`
- Reploid can rewrite Doppler kernels via `kernel.wgsl`

**Project Source:**
- `design/SUBSTRATE.md` - Ouroboros contract

**Research:**
- WebLLM (arXiv 2024)
- nnJIT (MobiSys 2024)

---

### 4. Doppler provides in-browser WebGPU inference with kernel hot-swap

**Claim:** Co-locating inference with the agent loop removes integration latency and enables immediate A/B testing.

**Feasibility: HIGH** (for WebGPU inference), **MEDIUM-HIGH for Doppler performance targets**

**Project Evidence:**
- Doppler is a browser-native WebGPU inference engine
- Kernel hot-swap architecture and multi-model primitives

**Project Source:**
- `../doppler/README.md` - Doppler overview

**Research:**
- WebLLM (arXiv 2024)
- WeInfer (ACM WWW 2025)
- WebInf (IEEE 2024)

---

### 5. Browser context lowers distribution friction

**Claim:** Sharing a variant is operationally simpler than shipping a CLI build.

**Feasibility: HIGH**

**Project Evidence:**
- Client-only operational mode
- VFS-first deployment and runtime patching

**Project Source:**
- `OPERATIONAL_MODES.md` - operational modes comparison

---

### 6. Constraints drive creativity and innovation

**Claim:** Browser constraints force smaller, atomic changes and keep the evolution loop within a controlled surface.

**Feasibility: HIGH**

**Project Evidence:**
- Zero-API contract and VFS-only module loading
- Explicit style constraints for module boundaries

**Project Sources:**
- `design/SUBSTRATE.md` - minimal contract surface
- `STYLE_GUIDE.md` - import and module constraints

---

## Core Philosophy

### The RSI Thesis

Safe recursive self-improvement requires:

1. **Transparency** - Every modification is logged, diff-able, and reversible
2. **Gradual Capability** - Start minimal, earn capabilities through demonstrated safety
3. **Human Oversight** - Critical operations require HITL (Human-in-the-Loop) approval
4. **Verification** - Code changes pass through sandbox verification before execution
5. **Rollback** - Genesis snapshots enable recovery from any failure

### The OODA Loop

REPLOID's cognitive architecture follows the OODA loop:

```
OBSERVE  ->  ORIENT  ->  DECIDE  ->  ACT
   |            |           |         |
   v            v           v         v
[Read VFS]  [Analyze]  [Plan]    [Execute]
   |                               |
   +---------- FEEDBACK ----------+
```

---

## RSI Levels

Recursive self-improvement with graduated safety gates:

| Level | Name | Scope | Safety Gate |
|-------|------|-------|-------------|
| **L0** | Basic Functions | CreateTool, Web APIs, new tools | Verification Worker |
| **L1** | Meta Tooling | Modify tool-writer, improve CreateTool | Arena consensus |
| **L2** | Self-Modification (Substrate) | EditFile core modules, runtime patches | HITL approval |
| **L3** | Weak RSI (Iterative) | Bounded feedback loops, self-improvement | HITL + rollback |
| **L4** | True RSI (Impossible) | Unbounded self-improvement, theoretical | N/A |

> **Note:** L3 previously required strict HITL. Current beta policy allows autonomous L3 with multi-model Arena validation and instant rollback.

---

## The Ouroboros

REPLOID and DOPPLER form a closed loop - the serpent eating its own tail:

```
    ┌─────────────────────────────────────┐
    │                                     │
    ▼                                     │
┌────────┐   InferenceProvider    ┌───────────┐
│DOPPLER │ ────────────────────▶  │  REPLOID  │
│(Engine)│                        │  (Agent)  │
└────────┘  ◀──────────────────── └───────────┘
    ▲         AdaptationProvider          │
    │                                     │
    └─────────────────────────────────────┘
```

- **DOPPLER** provides inference (the brain)
- **REPLOID** provides agency (the body)
- Each can modify the other through a shared substrate

---

## Key Capabilities

### Memory Hierarchy (MemGPT-style)
- **Working Memory** - Context window (8K tokens)
- **Episodic Memory** - Full messages with embeddings
- **Semantic Memory** - Extracted facts, preferences, patterns

### Safety Infrastructure
- **HITL Controller** - Approval queue for risky operations
- **Verification Worker** - Static analysis before execution
- **Arena Consensus** - Multi-model voting for L2+ changes
- **Genesis Snapshots** - Instant rollback to pristine state

### Distribution *(Planned)*
- **Swarm Orchestration** - Multi-agent coordination *(P2)*
- **P2P Networking** - WebRTC for cross-device collaboration *(P2)*
- **Federated Learning** - Private data stays local *(P2)*

> These capabilities are tracked in project roadmaps and implementation docs.

---

## What REPLOID Is Not

- **Not a chatbot** - It's an agent that can modify its own code
- **Not cloud-dependent** - Runs entirely in-browser with local models
- **Not a framework** - It's a living system that evolves
- **Not static** - The version you run today may rewrite itself tomorrow

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Core module test coverage | >80% |
| Mean time to recovery | <5s (Genesis rollback) |
| Arena pass rate | >90% |
| Memory reuse rate | >50% |
| Max session length | 100+ turns |

---

## Related

- [README.md](../README.md) - Quick start and features
- [design/SYSTEM_ARCHITECTURE.md](design/SYSTEM_ARCHITECTURE.md) - System overview
- [design/SUBSTRATE.md](design/SUBSTRATE.md) - Substrate + Ouroboros contract
- [blueprints/0x000000-reploid-genesis.md](../src/blueprints/0x000000-reploid-genesis.md) - Foundational architecture
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) - Integration summary

---

*The question is not whether AI will improve itself, but whether we can make it safe to do so.*
