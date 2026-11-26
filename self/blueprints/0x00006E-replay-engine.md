# Blueprint 0x00006E: Replay Engine

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/replay-engine.js`, `/self/ui/proto/replay.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/replay-engine.js`, `ui/proto/replay.js`

**Former Blueprint Paths:** `self/blueprints/0x00006E-replay-engine.md`
**Objective:** Passive, validated playback of exported run traces with speed control, plus a separate re-execution path for internal audit-log sessions.

**Target Module:** `ReplayEngine`

**Implementation:** `/infrastructure/replay-engine.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x00004F` (Event Bus), `0x000011` (VFS), `0x00006F` (Telemetry Timeline); optional `0x00002B` (Audit Logging)

**Category:** Infrastructure

**Genesis Level:** substrate (`self/config/genesis-levels.json`; module metadata `replay-engine.js:79`)

---

## 1. Purpose

Post-mortem review needs to step through what an agent did. The Replay Engine loads an exported run trace and plays it back in order, at a chosen speed, through one namespaced event. It has two deliberately separate modes:

1. **Imported-trace playback.** Read-only. An imported trace can never execute tools, call a model, or restore the VFS.
2. **Audit-session re-execution.** A legacy internal API that rebuilds recorded model responses from `AuditLogger` entries and re-runs their tool calls through `ToolRunner`, comparing results.

## 2. Playback (`createTimelinePlayback`)

`createTimelinePlayback({ onEvent, onReset, onUpdate, now, schedule, cancel })` is exported for direct use and tests (`replay-engine.js:13-73`). It has no execution ports.

| Rule | Source |
| --- | --- |
| Input passes `importRunTrace` (`self/core/run-replay-bundle.js:84`) before it replaces a loaded trace; schema `reploid.run-trace.v1`, legacy VFS-timeline bundles are converted | `:58-62` |
| Trace limits: 4,096 events, 128 KiB per event, 4 MiB total, 7-day span; event types `model_text`, `tool_call`, `tool_result`, `tool_observation`, `status`, `error`; values are sanitized and likely secrets redacted | `run-replay-bundle.js:9-11,24-80` |
| Speeds are `REPLAY_SPEEDS = [1, 8, 64, 256]`; any other value throws `Unsupported replay speed.` | `:9,66-69` |
| Each tick applies every event whose offset is within the elapsed position, then renders once (16 ms default scheduling) | `:35-43` |
| `seek(n)` requires an integer in `[0, events.length]`, otherwise throws `Invalid replay position.`; it resets and re-applies events `0..n-1` | `:45-53` |
| `stop()` is `seek(0)`; `step()` pauses and applies one event; `play()` does nothing at the end of the trace | `:54-57,64-65` |
| Imported event names are never dispatched. Each event is delivered as a structured clone to `onEvent` | `:11,34` |

## 3. Module exports

`ReplayEngine.factory(deps)` (`replay-engine.js:567-596`). Dependencies: `Utils`, `EventBus`, `VFS`, optional `AuditLogger`, `VFSSandbox`, `ToolRunner`, `LLMClient` (`:80-83`).

| Group | Function | Behavior |
| --- | --- | --- |
| Playback | `loadRun(runData)` | Refuses while re-execution runs; validates, marks the session imported, emits `replay:loaded` with metadata (`:114-127`) |
| Playback | `play`, `pause`, `stop`, `step`, `seek`, `setSpeed`, `getState`, `getSpeeds` | From `createTimelinePlayback` |
| Re-execution | `loadSession(startDate, endDate?)` | Reads `AuditLogger.getEntries`; collects `llm_response` and `tool_result` actions; clears the imported flag; emits `replay:session_loaded` (`:140-199`) |
| Re-execution | `loadSessionFromRun(runData)` | Requires `runData.vfs`; loads the trace for viewing and summarizes it; the session stays imported and read-only (`:206-253`) |
| Re-execution | `createCheckpoint`, `restoreCheckpoint(i)` | VFSSandbox snapshot and restore; restore throws for imported sessions (`:259-298`) |
| Re-execution | `getMockedResponse`, `executeIteration`, `compareToolResult`, `executeSession(options)`, `abortExecution` | Execution throws `Imported traces are read-only playback, not execution.` when the session is imported (`:305-523`) |
| Inspection | `getComparisonResults`, `getCheckpoints`, `getExecutionState`, `clear`, `init` | `:529-571` |

`executeSession` options: `mode` (`'mocked'` default), `compareResults` (true), `checkpointInterval` (5), `onIteration`. `executeIteration` falls back to a live `LLMClient.chat` call when no recorded response exists for the iteration (`:336-342`).

## 4. Events emitted

| Event | Payload | Source |
| --- | --- | --- |
| `replay:loaded` | Trace metadata | `:125` |
| `replay:event` | Structured clone of one trace event | `:97` |
| `replay:reset` | None | `:98` |
| `replay:progress` | Playback state from `getState()` | `:101` |
| `replay:completed` | None | `:102` |
| `replay:session_loaded` | Session summary | `:196,250` |
| `replay:checkpoint_restored` | `{ index }` | `:297` |
| `replay:iteration` | `{ iteration, mode, content? }` | `:322,338` |
| `replay:comparison` | Comparison record | `:383` |
| `replay:execution_started`, `replay:execution_iteration`, `replay:execution_complete` | Mode, progress, final report | `:431,460,510` |

There is no `replay:${type}` re-emission and no `replay:started`, `replay:paused`, `replay:stopped`, `replay:stepped`, `replay:seeked` or `replay:speed-changed` event. `ui/proto/replay.js` refreshes through `replay:progress` and clears its event log on `replay:reset`, so after a seek backwards the log shows only the events up to the new position.

## 5. Proto panel (`ui/proto/replay.js`)

`createReplayManager({ logger, escapeHtml, EventBus })` returns `{ wireEvents, loadRunFile, updateUI, renderEventLog }` (`ui/proto/replay.js:9,234-239`). It resolves the engine lazily, loads a chosen file, passes the speed selector value to `setSpeed`, and appends `replay:event` payloads to the event log.

## 6. Verification requirements

- An invalid trace leaves the previously loaded trace in place.
- `setSpeed` accepts only 1, 8, 64 and 256; other values throw.
- `seek` rejects non-integer and out-of-range positions.
- Playback emits only `replay:*` events from the table above; imported event names are never dispatched.
- After `loadRun` or `loadSessionFromRun`, `executeSession`, `executeIteration` and `restoreCheckpoint` throw.

---

Maintain this blueprint as the replay engine capabilities evolve or new playback features are introduced.
