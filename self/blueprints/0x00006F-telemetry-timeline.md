# Blueprint 0x00006F: Telemetry Timeline

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/telemetry-timeline.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/telemetry-timeline.js`

**Former Blueprint Paths:** `self/blueprints/0x00006F-telemetry-timeline.md`
**Objective:** Append-only, date-partitioned event log for audit, performance and agent state changes, plus a bounded run-trace recorder for replay.

**Target Module:** `TelemetryTimeline`

**Implementation:** `/infrastructure/telemetry-timeline.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000011` (VFS), `0x00004F` (Event Bus)

**Category:** Infrastructure

**Genesis Level:** reflection (`self/config/genesis-levels.json`, level `reflection`; module metadata `telemetry-timeline.js:121`)

---

## 1. Purpose

The timeline is one append-only log of significant events, persisted to the VFS by day and kept in a small in-memory window for fast reads. A second export, the run-trace recorder, captures one agent run as a bounded `reploid.run-trace.v1` document that the Replay Engine (`0x00006E`) can import.

## 2. Module exports

`TelemetryTimeline.factory(deps)` returns the object below (`telemetry-timeline.js:305-316`). Dependencies: `Utils`, `VFS`, optional `EventBus` (`:122`). There is no `queryByType` or `exportRun`; filter the result of `getRecent` or `getEntries`, and use the run-trace recorder for replay export.

| Function | Behavior | Source |
| --- | --- | --- |
| `init()` | Loads up to the last 500 entries from today's file, then wires EventBus | `:306-311` |
| `record(type, payload = {}, options = {})` | Builds `{ id, ts, type, severity, tags, payload }` (`severity` defaults to `info`), keeps it in the 500-entry window, queues it for a batched append, emits `telemetry:event`, returns the id | `:221-239` |
| `flush()` | Waits until every queued entry has been appended | `:241-247` |
| `getRecent(limit = 100)` | Newest entries from the in-memory window | `:249-253` |
| `getEntries(startDate, endDate = startDate)` | Flushes, then reads each day file in the range; swaps inverted dates; skips malformed lines and unreadable files | `:255-287` |

## 3. Storage

| Item | Value | Source |
| --- | --- | --- |
| Path | `/.logs/timeline/YYYY-MM-DD.jsonl` (UTC date of `ts`) | `:131,149-150` |
| Batching | Entries queued in one microtask are appended together, grouped by day file | `:146-197` |
| Failure | Read and write errors are logged; `record` does not throw for them | `:162-172` |

## 4. Event subscriptions

Wired once by `init()` if EventBus exists (`:289-303`).

| Event | Severity | Tags |
| --- | --- | --- |
| `agent:status` | info | `agent` |
| `agent:warning` | warn | `agent` |
| `tool:slow` | warn | `tool` |
| `tool:timeout` | error | `tool` |
| `tool:error` | error | `tool` |
| `tool:circuit_skip` | warn | `tool` |

Other modules write directly: `self/infrastructure/audit-logger.js:135` records `audit:<type>` entries and `self/capabilities/performance/performance-monitor.js:46` records performance events.

## 5. Events emitted

| Event | Payload |
| --- | --- |
| `telemetry:event` | The new entry |

## 6. Run-trace recorder

Standalone exports used by `self/core/agent-loop.js` and `self/ui/zero/replay-panel.js`.

| Export | Behavior | Source |
| --- | --- | --- |
| `SAVED_TRACE_ROOT`, `MAX_SAVED_TRACES` | `/.logs/recordings`, at most 8 saved recordings | `:8-9` |
| `listSavedRunTraces(VFS)` | Newest valid recording paths, at most 8 | `:11-15` |
| `readSavedRunTrace(VFS, path)` | Rejects paths outside the recordings pattern; validates the trace | `:16-19` |
| `createRunTraceRecorder(options)` | Returns `{ reset, record, recordEvent, flush, snapshot, getPersistenceStatus, close }` | `:23-115` |

Recorder rules:

- Events are sanitized and bounded by `RUN_TRACE_LIMITS` from `self/core/run-replay-bundle.js:9`. Once one event is dropped, every later event is counted in `droppedEvents` instead of recorded, so the trace is always an ordered prefix (`:79-92`).
- `recordEvent` maps `agent:history` model responses to `model_text`, tool results to `tool_observation`, `agent:status` to `status`, and `agent:error` / `agent:warning` to `error` (`:93-108`).
- Saving is debounced by 250 ms and runs under the `reploid:recordings:write` Web Lock. It never overwrites an existing or externally changed recording and stops at the 8-recording limit; a failure blocks further saves for that session and is reported through `onPersistenceError` (`:23-72`).

## 7. Verification requirements

- `record()` returns an id, adds the entry to the 500-entry window and emits `telemetry:event`.
- After `flush()`, entries appear in the day file as one JSON object per line.
- `getEntries()` tolerates missing files and malformed lines, and handles inverted ranges.
- The recorder never records an event after a dropped one, and never overwrites a recording it did not write.

---

Maintain this blueprint as the telemetry capabilities evolve or new event types are introduced.
