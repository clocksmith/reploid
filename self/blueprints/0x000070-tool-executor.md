# Blueprint 0x000070: Tool Executor

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/tool-executor.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/tool-executor.js`

**Former Blueprint Paths:** `self/blueprints/0x000070-tool-executor.md`
**Objective:** Shared tool execution with timeout, bounded retry, parallel batches and a read-only/mutating split.

**Target Module:** `ToolExecutor`

**Implementation:** `/infrastructure/tool-executor.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x00000A` (Tool Runner), `0x00004F` (Event Bus)

**Category:** Infrastructure

**Genesis Level:** capsule (`self/config/genesis-levels.json`, level `capsule`; module metadata `tool-executor.js:11`)

---

## 1. Purpose

Agent loops and workers need the same execution rules for every tool call: a per-call timeout, retry only for errors that can plausibly succeed on a second attempt, and a stable string result for the model context. ToolExecutor wraps `ToolRunner.execute` with those rules. It is used by `self/core/agent-loop.js:29-34`, `self/core/worker-manager.js:231` and `packages/reploid/src/agent/lab-strategy-tools.js:59-61`.

Dependencies: `Utils`, `ToolRunner`, optional `EventBus`, optional `TraceStore` (`tool-executor.js:12`).

## 2. Exports

Returned by the factory (`tool-executor.js:273-281`). There is no `getStats`, no concurrency limit and no result truncation in this module.

| Export | Behavior | Source |
| --- | --- | --- |
| `executeWithTimeout(name, args, options)` | Races `ToolRunner.execute(name, args, options)` (optionally wrapped by `options.invoke`) against a timer; rejects with `Tool timeout after <ms>ms`; always clears the timer | `:35-52` |
| `executeWithRetry(call, options)` | Runs `{ name, args }` with timeout and retry; returns `{ result, rawResult, error, duration }` and never throws for tool failures (an aborted `options.signal` does throw) | `:66-199` |
| `executeBatch(calls, options)` | `executeWithRetry` for every call at once with `Promise.all`; returns `[{ call, result, rawResult, error, duration }]` | `:207-215` |
| `executeWithParallelization(calls, readOnlyTools, options)` | `readOnlyTools` is a caller-supplied `Set` of names. Calls in the set run through `executeBatch`; the rest run one at a time afterwards. Returns `{ results, readOnlyResults, mutatingResults, telemetry }` | `:225-257` |
| `formatResultForContext(toolName, result, error)` | `Error executing <tool>: <message>` or `Result of <tool>:\n<result>` | `:266-271` |
| `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_RETRIES` | 30,000 and 2 | `:22-23` |

## 3. Retry and timeout rules

| Option | Default | Rule |
| --- | --- | --- |
| `timeoutMs` | 30,000 | A timeout is final: no retry, result text says the operation may still be running (`:140-158`) |
| `maxRetries` | 2 | Up to three attempts in total |
| `retryDelayMs` | 100 | Linear backoff: `retryDelayMs * (attempt + 1)` (`:161-163`) |
| `allowedTools`, `workerId`, `iteration`, `trace`, `signal`, `invoke` | `'*'`, `null`, `0`, `null` | Passed through to ToolRunner and to events |

Retry is allowed only when `isRetryableToolError` (`shared/vendor/reploid/agent/tool-retry.js`) returns true. Missing files, invalid arguments, path traversal, unknown or unpermitted tools, policy violations, user rejections and timeouts are not retried. A non-retryable error stops at the first attempt (`:164-167`).

Results are stringified (`JSON.stringify(value, null, 2)` for non-strings); an undefined result becomes `(Tool returned no output)` (`:107-111`).

## 4. Read-only classification

ToolExecutor does not decide which tools are read-only. The caller passes the set. The schema registry owns that decision through each schema's `readOnly` flag and `isToolReadOnly` / `getReadOnlyTools`; see [`0x00006B-schema-registry.md`](0x00006B-schema-registry.md). An earlier version of this blueprint carried a hard-coded list (`SearchFiles`, `GetArtifact`, `GetState`, `QueryVFS`, `InspectModule`, `GetMetrics`, `GetLogs`, and others) that named tools which do not exist in `self/tools/`; it has been removed.

## 5. Events emitted

| Event | Payload | Source |
| --- | --- | --- |
| `agent:tool:start` | `{ tool, cycle, workerId }` | `:82` |
| `tool:slow` | `{ tool, ms, cycle, workerId }`, when an attempt takes over 70% of the timeout | `:99-105` |
| `tool:timeout` | `{ tool, timeout, cycle, workerId }` | `:144` |
| `agent:tool:end` | `{ tool, cycle, workerId, durationMs, success }` | `:184-190` |

ToolExecutor does not emit `tool:error`, `tool:executed`, retry or batch events. When `TraceStore` and `options.trace.sessionId` are present it records `tool:execute` trace entries: one on success with a 2,000-character result preview, one for the final error, and for a timeout an extra entry marked `timeout: true` before the final error entry (`:113-133,146-157,171-181`).

## 6. Verification requirements

- A tool that exceeds `timeoutMs` produces the timeout result once, with no retry, and the timer is cleared.
- A retryable error is retried at most `maxRetries` times with linear delay; a non-retryable error is not retried.
- `executeWithParallelization` starts every call in the read-only set before any mutating call, and runs mutating calls in order.
- Tool failures are returned in `error`, not thrown.

---

Maintain this blueprint as the tool execution capabilities evolve or new execution strategies are introduced.
