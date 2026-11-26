# Blueprint 0x000047: Worker Pool for Parallel Execution

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/worker-manager.js`, `/self/core/worker-agent.js`, `/self/tools/SpawnWorker.js`, `/self/tools/AwaitWorkers.js`, `/self/tools/ListWorkers.js`, `/tests/unit/worker-manager.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/worker-manager.js`, `core/worker-agent.js`

**Former Blueprint Paths:** `self/blueprints/0x000047-worker-pool-parallelization.md`

**Module ID:** `WorkerManager` (version 1.0.0, genesis level `substrate`, type `core`, async; files `core/worker-manager.js` and `core/worker-agent.js`; dependencies `Utils`, `VFS`, `LLMClient`, `ToolRunner`, `ResponseParser`, `EventBus`, `ToolExecutor`, optional `AuditLogger`, `SchemaRegistry`, `TraceStore`)

**Source:** `self/core/worker-manager.js`

---

## Purpose

`WorkerManager` lets the main agent hand a sub-task to a typed sub-agent that runs its own think-act loop in a Web Worker, so several sub-tasks can proceed while the main agent continues. It is not a generic pool for CPU work and it does not run tools inside the worker; an earlier draft proposed a `worker-pool.js` for that, and it was never built.

The main agent reaches it through the `SpawnWorker`, `AwaitWorkers` and `ListWorkers` tools, which require the `substrate` genesis level or higher.

## Worker types

Types come from `workerTypes` in `self/config/genesis-levels.json`, passed to `init(config, modelConfig)` and registered with `SchemaRegistry` when present:

| Type | Tools | Default model role |
| --- | --- | --- |
| `explore` | `ReadFile`, `ListFiles`, `FileOutline`, `Grep`, `Find`, `Head`, `Tail` | `fast` |
| `analyze` | same read-only set | `fast` |
| `execute` | `*` (every tool) | `primary` |

An unknown type falls back to `explore`. `SpawnWorker` accepts only these three names. Model roles (`orchestrator`, `fast`, `code`, `local` in the genesis config, plus any set with `setModelRoles`) map a role to a model config; without a configured role the default model config is used, and spawn fails if there is none.

## Execution model

1. `spawn({ type, task, model?, maxIterations?, depth = 0, signal? })` rejects `depth > 0`, requires `Worker` support and allows at most 10 concurrent workers (checked before and after async setup). It audits `WORKER_SPAWN`, starts a `TraceStore` session when available, creates `new Worker('./core/worker-agent.js', { type: 'module' })` and posts `start` with the type, task, allowed tools and `maxIterations` (default 10). It returns `{ workerId, promise }`.
2. `worker-agent.js` loops up to `maxIterations`: it asks the main thread for a model response, parses tool calls and asks the main thread to run each tool, then posts `complete` or `error`.
3. The worker has no direct model or tool access. It uses three RPC operations answered on the main thread (`_handleWorkerRpc`): `llm:chat` calls `LLMClient.chat` with only the allowed tool schemas; `tool:execute` calls `ToolExecutor.executeWithRetry` with `allowedTools` and the `workerId`; `parse:tool_calls` calls `ResponseParser.parseToolCalls`. Unknown operations are refused.

So tool execution keeps the main thread's permission, policy, audit and HITL path; the worker boundary isolates only the loop's state.

## State and events

- Records are persisted to `/.system/workers/<workerId>.json` on spawn, on each log line and at the end. On `init`, finished records are reloaded; running ones are not resumed.
- Up to 100 finished records are kept in memory (oldest evicted).
- Events: `worker:spawned`, `worker:started`, `worker:progress`, `worker:completed`, `worker:error`, `worker:terminated`.

## Interface

`init`, `setModelConfig`, `setModelRoles`, `spawn`, `list` (active workers), `awaitWorkers({ workerIds } | { all: true })` (settles and returns `{ workerId, status, value, error }` for each), `terminate(workerId)`, `addLog`, `getResults(workerId?)`, `clearHistory()` (also deletes persisted files), `getToolsForType(type)` and `isToolAllowed(type, toolName)`.

`init` also calls `ToolRunner.setWorkerManager(api)`, because `ToolRunner` is created first.

## Boundaries and gaps

- Flat hierarchy: a worker reaches tools only through the manager's RPC. Unless its type sets `canSpawnWorkers: true` (none does), the manager leaves `SpawnWorker` and `AwaitWorkers` out of the schemas it offers the worker and refuses them in `tool:execute` with "flat hierarchy enforced", even for an `execute` worker with tools `*`. `spawn` still rejects `depth > 0` for direct callers.
- `spawn` reads the type from the genesis config directly, while `getToolsForType` prefers a `SchemaRegistry` definition; a type registered only in `SchemaRegistry` gets `explore` tools at spawn.
- `terminate` stops the Web Worker; a model request or tool call already running on the main thread for it is not cancelled.
- A worker's result is untrusted model output for the main agent to check; spawning grants no permission beyond the type's tool list.

## Verification

`tests/unit/worker-manager.test.js` covers the manager; `tests/e2e/workers.spec.js` exercises workers in a browser.

## Related blueprints

- [0x00000A Tool Runner Engine](0x00000A-tool-runner-engine.md) and [0x000070 Tool Executor](0x000070-tool-executor.md): run worker tool calls on the main thread.
- [0x000049 HITL Controller](0x000049-hitl-controller.md): approval for tool calls, including those a worker requests.
- [0x00002B Audit Logging Policy](0x00002B-audit-logging-policy.md): records `WORKER_SPAWN`.
