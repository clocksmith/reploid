# Blueprint 0x00006C: Error Store

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/error-store.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/error-store.js`

**Former Blueprint Paths:** `self/blueprints/0x00006C-error-store.md`
**Module:** `ErrorStore`
**File:** `infrastructure/error-store.js`
**Purpose:** Persist errors to VFS for display in the Status tab

**Genesis Level:** tabula (`self/config/genesis-levels.json`, level `tabula`; module metadata `genesis.introduced: 'tabula'`, `error-store.js:11`)

---

## Purpose

The Error Store keeps a bounded, persisted list of errors and warnings in the VFS so they survive page reloads and can be reviewed in the Status tab. When an EventBus is present it subscribes to a small set of error events and records them automatically.

---

## Exports

`ErrorStore.factory(deps)` returns the object below (`error-store.js:157-163`). Dependencies: `Utils`, `VFS`, optional `EventBus` (`error-store.js:12`).

| Function | Signature | Behavior | Source |
| --- | --- | --- | --- |
| `addError` | `(type, message, details = {})` | Builds `{ id, ts, type, message, details, severity }`, inserts it at the front, prunes to the newest 100, saves, emits `error:added`, returns the record. `severity` is `details.severity` or `'error'`. | `error-store.js:61-88` |
| `addWarning` | `(type, message, details = {})` | `addError` with `severity: 'warning'`. | `error-store.js:93-95` |
| `getErrors` | `()` | Copy of the stored list, newest first. | `error-store.js:100-103` |
| `clearErrors` | `()` | Empties the list, saves, emits `error:cleared`. | `error-store.js:108-115` |
| `getCount` | `()` | Number of stored records (errors and warnings together). | `error-store.js:120-123` |

## Storage

| Item | Value | Source |
| --- | --- | --- |
| Path | `/.system/errors.json` | `error-store.js:21` |
| Bound | 100 records (`MAX_ERRORS`); oldest dropped | `error-store.js:22,76-78` |
| Load | Lazy on first call; a missing, unreadable or non-array file yields an empty list | `error-store.js:29-42` |
| Save failure | Logged, not thrown | `error-store.js:47-53` |

## Event subscriptions

Wired once when the factory runs, only if `EventBus` exists (`error-store.js:128-155`).

| Event | Recorded as | Known emitters |
| --- | --- | --- |
| `tool:error` `{ tool, error, context }` | error, type `tool:error` | `packages/reploid/src/agent/lab-strategy-tools.js:43` |
| `error:persistence` `{ message, details }` | error, type `persistence` | `self/core/state-manager.js:59` |
| `circuit:open` `{ breaker, key, failures, error }` | warning, type `circuit:open` | `CircuitBreaker` when a circuit trips (`self/infrastructure/circuit-breaker.js`) |
| `agent:error` `{ message, error }` | error, type `agent:error` | `self/ui/proto/index.js:938,993`, `packages/reploid/src/agent/lab-strategy-cycle.js:250` |

## Events emitted

| Event | Payload | Consumers |
| --- | --- | --- |
| `error:added` | The stored record | `self/infrastructure/observability.js:363`, `self/ui/proto/index.js:1168` |
| `error:cleared` | None | `self/infrastructure/observability.js:364`, `self/ui/proto/index.js:1172` |

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| 0x000003 | Utils | `generateId`, logging |
| 0x000011 | VFS | Persistence to `/.system/errors.json` |
| 0x00004F | EventBus | Event subscription and emission (optional) |

---
