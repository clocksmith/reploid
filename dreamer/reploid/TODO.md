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

## Phase 4: External Validation

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

### Multi-Agent Coordination

- [ ] Swarm orchestration (`blueprints/0x000034-swarm-orchestration.md`)
- [ ] Cross-tab coordination (`blueprints/0x00003A-tab-coordination.md`)
- [ ] Consensus protocols for distributed agents

### WebRTC P2P

- [ ] Peer-to-peer agent communication (`blueprints/0x00003E-webrtc-swarm-transport.md`)
- [ ] Distributed VFS sync
- [ ] Federated learning primitives

---

## Not Planned

These are explicitly out of scope:

- **Docker/OS access** — Browser sandbox is the security boundary
- **Unrestricted self-modification** — Always gated by verification
- **Autonomous deployment** — Human approval required for production changes

---

## Metrics for Success

| Metric | Target | Current |
|--------|--------|---------|
| Core module test coverage | >80% | ~40% |
| Mean time to recovery (bad mutation) | <5s | ~30s |
| HITL adoption (users who opt-in) | tracked | ready |
| Audit log completeness | 100% | ~95% |
| Arena pass rate (self-mod gating) | >90% | ready |

---

## Timeline Estimate

No dates — these are sequenced priorities:

1. **Phase 1** — stabilization ✓
2. **Phase 2** — safety infrastructure ✓
3. **Phase 3** — trust building ✓
4. **Phase 4** — validation (current)

Fund with existing revenue. No external pressure on timelines.
