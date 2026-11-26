# Blueprint 0x000005: State Management Architecture

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/core/state-manager.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/state-manager.js`

**Former Blueprint Paths:** `self/blueprints/0x000005-state-management-architecture.md`
**Objective:** Keep the agent's high-level state (cycle count, current goal, session and counters) in one object persisted to the VFS, and expose a small API to read and change it.

**Prerequisites:** [0x000006](0x000006-pure-state-helpers.md) (Pure State Helpers), [0x000011](0x000011-advanced-storage-backend-indexeddb.md) (VFS), [0x00004F](0x00004F-event-bus-infrastructure.md) (EventBus), [0x00002B](0x00002B-audit-logging-policy.md) (AuditLogger, optional)

**Affected Artifacts:** `self/core/state-manager.js`, `/.system/state.json` (VFS)

---

### 1. Module

`StateManager` (`self/core/state-manager.js`), `genesis: { introduced: 'tabula' }`, dependencies `Utils`, `VFS`, `StateHelpersPure`, `EventBus`, optional `AuditLogger`. The state file is `/.system/state.json` in the VFS.

### 2. Interface

| Member | Behavior |
| --- | --- |
| `init()` | Reads and parses the state file. If `validateState` reports errors, logs a warning and starts from `createInitialState()`; otherwise merges the saved state over the defaults. A missing or unreadable file starts fresh and saves. Returns the state. |
| `getState()` | Deep copy of the state; throws `StateError` before `init` |
| `updateState(updates)` | Shallow `Object.assign` of `updates`, save, return a copy |
| `setGoal(goalText)` | `pushGoal` (the first goal becomes `currentGoal`, later goals become pending subgoals), save, `AuditLogger.logAgentAction('SET_GOAL', ...)` when present, emit `goal:set` `{ id, goal, timestamp }` |
| `incrementCycle()` | `totalCycles++`, save |

`updateState`, `setGoal` and `incrementCycle` load the state first if `init` has not run.

### 3. Persistence

`save` writes the whole state as indented JSON. It retries twice after 100 ms; if the last attempt fails it logs the error and emits `error:persistence` `{ message, details }` instead of throwing, so a caller's change remains in memory but may not be on disk.

There are no transactions, no artifact-metadata API and no checkpoints in this module. Rollback of files is the job of genesis snapshots ([0x00003C](0x00003C-genesis-snapshot-system.md)).

### 4. Verification

Incomplete: no test exercises this module. `tests/unit/state-manager.test.js` defines its own mock `StateManager` with an artifact API this module does not have, so it verifies neither the real file path, the validation fallback, `setGoal` nor the save retry. A test that imports `self/core/state-manager.js` is the missing evidence.
