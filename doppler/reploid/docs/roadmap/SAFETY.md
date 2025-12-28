# Phase 2: Safety & Governance ✓

Core safety infrastructure complete. Remaining items are polish/hardening.

### Human-in-the-Loop (HITL)

Autonomous by default. HITL is opt-in for users who want approval gates.

- [x] **HITL controller** — Central approval queue in `/infrastructure/hitl-controller.js`, manages pending requests
- [x] **Module capabilities** — Register modules with required capabilities (APPROVE_CORE_WRITES, APPROVE_TOOL_CREATION)
- [x] **Approval queue** — Async callbacks, configurable timeouts, statistics tracking
- [x] **Diff viewer** — Side-by-side comparison in `/ui/components/diff-viewer-ui.js`, syntax highlighting
- [x] **HITL widget** — Floating UI in `/ui/components/hitl-widget.js`, approve/reject buttons, queue count badge

### Audit & Replay

- [x] **AuditLogger integration** — Wired into ToolRunner, captures all tool executions
- [x] **Tool execution logs** — Name, args (sanitized), duration, success/error status, timestamp
- [x] **VFS mutation logs** — Before/after byte counts, path, operation type
- [x] **Core file warnings** — WARN severity for writes to `/core/`, `/infrastructure/`
- [x] **Structured export** — `AuditLogger.exportJSON()` and `exportCSV()` for external analysis
- [x] **Download logs** — `AuditLogger.download('json')` triggers browser download
- [x] **Audit replay** — ReplayEngine v2.0 in `/infrastructure/replay-engine.js`: `loadSession(date)` loads from audit logs, `executeSession()` re-executes with mocked LLM responses, `compareToolResult()` diffs outputs, VFS checkpointing via VFSSandbox

### Arena Mode

Test-driven selection for self-modification proposals.

- [x] **VFSSandbox** — Snapshot/restore in `/testing/arena/vfs-sandbox.js`, isolated filesystem for each competitor
- [x] **ArenaCompetitor** — Competitor definition in `/testing/arena/competitor.js`, wraps proposed changes
- [x] **ArenaMetrics** — Results ranking in `/testing/arena/arena-metrics.js`, score aggregation
- [x] **ArenaHarness** — Competition orchestrator in `/testing/arena/arena-harness.js`, runs competitors in parallel
- [x] **ToolRunner gating** — Opt-in via `setArenaGating(true)`, requires arena pass before self-mod
- [x] **Arena integration tests** — Create `/tests/integration/arena-harness.test.js` with scenarios: single competitor pass, single competitor fail, multi-competitor ranking, timeout handling, VFS isolation verification
- [x] **Arena results UI** — Build `/ui/components/arena-results.js` showing competition history, winner/loser diffs, score breakdown, re-run button

### Verification & Genesis

- [x] **Pattern expansion** — 20+ dangerous patterns in VerificationManager (eval, Function constructor, prototype pollution, etc.)
- [x] **Static analysis** — AST-based pattern matching, no runtime execution during verification
- [x] **Capability permissions** — `/tools/` can only write to `/tools/`, `/apps/`, `/.logs/`
- [x] **Complexity heuristics** — Warn on files >500 lines, >20 functions, deep nesting
- [x] **Genesis snapshots** — `/infrastructure/genesis-snapshot.js` creates immutable backups
- [x] **Lifeboat backups** — Store kernel in localStorage, survives IndexedDB wipe
- [x] **One-click rollback** — `restoreSnapshot()` and `restoreFromLifeboat()` for recovery
- [x] **Bundle export/import** — Download/upload genesis state as JSON

### Observability

- [x] **Token tracking** — Per-model token usage and cost in PerformanceMonitor
- [x] **Performance metrics** — LLM latency p50/p95/p99, tool latency, error rate
- [x] **Mutation stream** — Create `Observability.recordMutation(path, op, before, after)` that emits to EventBus topic `observability:mutation`, buffer last 1000 mutations in memory, persist overflow to VFS `/.logs/mutations/`
- [x] **Decision trace** — Create `Observability.recordDecision(goal, context, reasoning, action)` capturing agent decision points, store in `/.logs/decisions/`, enable "why did it do that?" debugging
- [x] **Unified dashboard** — Create `Observability.getDashboard()` returning `{ mutations, decisions, performance, errors, tokens }`, wire into MetricsDashboard UI, add real-time refresh
