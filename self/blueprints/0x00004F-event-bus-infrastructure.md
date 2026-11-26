# Blueprint 0x00004F: Event Bus Infrastructure

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/shared/infrastructure/event-bus.js`, `/tests/unit/event-bus.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/event-bus.js`

**Former Blueprint Paths:** `self/blueprints/0x00004F-event-bus-infrastructure.md`
**Objective:** Provide one in-page publish/subscribe channel so modules can react to each other without holding direct references.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Core Utilities, for `logger` and `createSubscriptionTracker`)

**Affected Artifacts:** `shared/infrastructure/event-bus.js` (served at `/self/infrastructure/event-bus.js`)

---

### 1. Location

The source file is `shared/infrastructure/event-bus.js`. It moved from `self/` to `shared/` so that the substrate and the product share one copy; the served tree still exposes it at `/self/infrastructure/event-bus.js` and the module inventory still lists it as `infrastructure/event-bus.js`.

Module metadata: `id: 'EventBus'`, `genesis: { introduced: 'tabula' }` (loaded at every genesis level), `dependencies: ['Utils']`, `type: 'infrastructure'`.

### 2. Interface

`EventBus.factory({ Utils })` returns exactly three functions:

| Function | Behavior |
| --- | --- |
| `on(event, fn, ownerId = null)` | Adds `fn` to the listener set for `event` and returns an unsubscribe function. When `ownerId` is given, the unsubscribe function is also recorded under that owner. |
| `emit(event, data)` | Calls every listener for `event` synchronously with `data`. A listener that throws is logged through `logger.error` and does not stop the remaining listeners. Returns nothing. |
| `unsubscribeModule(moduleId)` | Calls every unsubscribe function recorded for `moduleId`, then forgets that owner. |

There is no `off`, `once`, wildcard matching, priority, event history or statistics API.

### 3. Unsubscribing

A subscriber removes one listener by calling the function that `on` returned:

```javascript
const unsubscribe = EventBus.on('agent:status', handleStatus);
// later
unsubscribe();
```

A module that registers many listeners passes its ID as `ownerId` and calls `EventBus.unsubscribeModule(id)` when it unloads. Removing the last listener for an event deletes that event's entry, so empty sets do not accumulate.

Known defect: `self/capabilities/cognition/semantic/semantic-memory-llm.js` and `self/ui/panels/cognition-panel.js` call `EventBus.off(...)`, which does not exist. Those calls throw when reached; the callers should keep and call the unsubscribe function instead.

### 4. Delivery semantics

- Delivery is synchronous and in insertion order of the listener set.
- A listener added during an `emit` of the same event may run in that same pass, because iteration is over the live `Set`.
- The bus is in-memory and per page. It does not cross workers, tabs or peers; swarm and worker messages use their own transports.
- Events carry no schema. Names in use follow `domain:action`, for example `agent:history`, `agent:status`, `agent:error`, `progress:update`, `swarm:peer-joined`, `vfs:module_loaded`, `tool:core_write` and `hitl:approval-pending`.

### 5. Verification

`tests/unit/event-bus.test.js` covers registration, multiple listeners, unsubscribe functions, owner-scoped cleanup and listener error isolation.
