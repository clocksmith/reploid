# REPLOID Roadmap

> Agent Safety Substrate — browser-native infrastructure for safe AI agent development

---

## Phase 1: Stabilize Core ✓

- [x] VFS with IndexedDB persistence
- [x] Multi-provider LLM client (WebLLM, Ollama, Cloud APIs)
- [x] Agent loop with 50-iteration circuit breaker
- [x] Tool runner with Web Worker sandboxing
- [x] VerificationManager pre-flight checks
- [x] Rate limiting and circuit breakers
- [x] Genesis levels (tabula/minimal/full/cli)
- [x] Streaming response edge cases (buffer flushing at stream end)
- [x] Circuit breaker half-open state (proper recovery testing)
- [x] LLM stream timeout handling (30s between chunks)

---

## Phase 2: Safety Infrastructure ✓

### 2.1 Human-in-the-Loop Approval (Opt-in)

Autonomous by default. HITL is opt-in for users who want approval gates.

- [x] Implement HITL controller (`/infrastructure/hitl-controller.js`)
- [x] Module registration with capabilities (APPROVE_CORE_WRITES, etc.)
- [x] Approval queue with callbacks, timeouts, statistics
- [x] Diff viewer for proposed changes (`/ui/components/diff-viewer-ui.js`)
- [x] UI widget for approval queue (`/ui/components/hitl-widget.js`)

### 2.2 Audit Logging Integration

- [x] Wire AuditLogger into ToolRunner
- [x] Log all tool executions (name, args, duration, success/error)
- [x] Log VFS mutations with before/after byte counts
- [x] Core file writes logged with WARN severity
- [x] Structured audit export (JSON/CSV) via `AuditLogger.exportJSON()` / `exportCSV()`
- [x] Download audit logs via `AuditLogger.download('json')` / `download('csv')`
- [ ] Implement audit replay for debugging

### 2.3 Arena Mode (Test-Driven Selection)

- [x] VFSSandbox — snapshot/restore isolation
- [x] ArenaCompetitor — competitor definition
- [x] ArenaMetrics — results ranking
- [x] ArenaHarness — competition orchestrator
- [x] Wire arena into ToolRunner for self-mod gating (opt-in via `setArenaGating(true)`)
- [ ] Integration tests for arena harness
- [ ] UI for arena results visualization

---

## Phase 3: Trust Building ✓

### 3.1 Verification Hardening

- [x] Expand VerificationManager patterns (20+ dangerous patterns)
- [x] Pattern-based static analysis for dangerous code
- [x] Capability-based permissions (`/tools/` can only write to `/tools/`, `/apps/`, `/.logs/`)
- [x] Complexity heuristics (warn on large files, many functions)
- [ ] Add cryptographic signing for approved modules

### 3.2 Genesis Factory

- [x] Genesis snapshot system (`/infrastructure/genesis-snapshot.js`)
- [x] "Lifeboat" immutable kernel backups (localStorage)
- [x] One-click rollback via `restoreSnapshot()` / `restoreFromLifeboat()`
- [x] Export/import genesis bundles

### 3.3 Observability

- [x] Real-time mutation stream (`Observability.recordMutation()`)
- [x] Agent decision trace (`Observability.recordDecision()`)
- [x] Token usage and cost tracking with per-model breakdown
- [x] Performance metrics (LLM latency, tool latency, error rate)
- [x] Full dashboard via `Observability.getDashboard()`

---

## Phase 4: Hierarchical Memory Architecture (Current)

Prerequisites for external validation. Implements production-ready infinite context.

### 4.1 MemGPT-Style Memory Hierarchy

- [ ] Implement MemoryManager module (`/core/memory-manager.js`)
- [ ] Working Memory tier (context window - 8K tokens)
- [ ] Episodic Memory tier (VFS `/memory/episodes/` - full messages + embeddings)
- [ ] Semantic Memory tier (VFS `/memory/knowledge/` - facts, preferences, patterns)
- [ ] Recursive summarization on eviction (temp=0 for consistency)
- [ ] Wire into agent-loop for automatic context management

### 4.2 RAPTOR-Style Knowledge Tree

- [ ] Implement hierarchical clustering (UMAP + GMM or simple k-means)
- [ ] Recursive summarization to build tree levels
- [ ] Collapsed tree retrieval (search ALL levels)
- [ ] Persist tree structure in VFS `/memory/knowledge/tree.json`
- [ ] Incremental updates (add documents without full rebuild)

### 4.3 Enhanced Retrieval

- [ ] Upgrade EmbeddingStore with temporal indexing
- [ ] Hybrid retrieval: summary + semantic search + temporal contiguity
- [ ] Anticipatory retrieval (predict future needs based on task)
- [ ] Adaptive forgetting curves (not just LRU)

### 4.4 Integration & Testing

- [ ] Update Context Manager to use MemoryManager
- [ ] Benchmark: memory reuse rate (target >50%, vs 0% for RAG)
- [ ] Benchmark: context reconstruction accuracy
- [ ] Long-session tests (100+ turns without degradation)

**Research References:**
- [RAPTOR](https://arxiv.org/abs/2401.18059) - Tree-organized retrieval, 20% accuracy gain
- [MemGPT](https://arxiv.org/abs/2310.08560) - OS-inspired memory hierarchy
- [Cognitive Workspace](https://arxiv.org/abs/2508.13171) - 54-60% memory reuse
- [EM-LLM](https://arxiv.org/abs/2407.09450) - Human episodic memory patterns

**See Also:**
- [MEMORY_ARCHITECTURE.md](./MEMORY_ARCHITECTURE.md) - Full implementation plan (this repo)
- Doppler: `docs/plans/FUNCTIONGEMMA.md` - FunctionGemma integration for local summarization (sibling repo)

---

## Phase 5: External Validation (Deferred)

Requires Phase 4 completion for credible demonstration.

- [ ] Security audit of sandbox boundaries
- [ ] Publish safety primitives as standalone library
- [ ] Academic paper on browser-native agent containment
- [ ] Compliance documentation (SOC2-style controls)

---

## Optional: Moonshots

These are high-value but high-effort. Pursue only after Phase 3.

### Policy Engine

- [ ] Upgrade RuleEngine from stub to real policy enforcement
- [ ] Define declarative safety policies (e.g., "no network calls from tools")
- [ ] Runtime policy violation detection

### Formal Verification

- [ ] Type-level guarantees for tool outputs
- [ ] Proof-carrying code for self-modifications
- [ ] Invariant checking across mutations

### Multi-Agent Coordination (Partial)

- [x] Swarm orchestration (`blueprints/0x000034-swarm-orchestration.md`) - SwarmSync implemented
- [x] Cross-tab coordination (`blueprints/0x00003A-tab-coordination.md`) - BroadcastChannel transport
- [ ] Consensus protocols for distributed agents

### WebRTC P2P (Partial)

- [x] Peer-to-peer agent communication (`blueprints/0x00003E-webrtc-swarm-transport.md`) - SwarmTransport implemented
- [x] Distributed VFS sync - LWW merge with Lamport timestamps
- [ ] Federated learning primitives

---

## Not Planned

These are explicitly out of scope:

- **Docker/OS access** — Browser sandbox is the security boundary
- **Unrestricted self-modification** — Always gated by verification
- **Autonomous deployment** — Human approval required for production changes

---

## Metrics for Success

| Metric | Target | Status |
|--------|--------|--------|
| Core module test coverage | >80% | In progress |
| Mean time to recovery (bad mutation) | <5s | Genesis rollback ready |
| HITL adoption (users who opt-in) | tracked | Implemented |
| Audit log completeness | 100% | Implemented |
| Arena pass rate (self-mod gating) | >90% | Implemented |
| Memory reuse rate | >50% | Phase 4 |
| Context reconstruction accuracy | >90% | Phase 4 |
| Max session length without degradation | 100+ turns | Phase 4 |

---

## Timeline Estimate

No dates — these are sequenced priorities:

1. **Phase 1** — stabilization ✓
2. **Phase 2** — safety infrastructure ✓
3. **Phase 3** — trust building ✓
4. **Phase 4** — hierarchical memory (current)
5. **Phase 5** — external validation (deferred)

Phase 4 is prerequisite for Phase 5. A credible safety demonstration requires
production-ready memory architecture (GEPA: Gemma-Enhanced Pipeline Architecture).

Fund with existing revenue. No external pressure on timelines.
