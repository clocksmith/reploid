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
| **L2** | Self-Modification (Substrate) | Edit core modules, runtime patches | HITL approval |
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

> These capabilities are tracked in `feature-log/reploid/*.jsonl`.

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
- [blueprints/0x000000-reploid-genesis.md](../blueprints/0x000000-reploid-genesis.md) - Foundational architecture
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - Combined Doppler+Reploid vision
- [TODO.md](./TODO.md) - Task tracking and research references

---

*The question is not whether AI will improve itself, but whether we can make it safe to do so.*
