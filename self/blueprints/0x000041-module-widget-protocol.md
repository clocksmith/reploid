# Blueprint 0x000041: Module Widget Protocol

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** `/ui/module-widget-protocol.js`, `/ui/module-proto.js`

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000041-module-widget-protocol.md`
**Objective:** Give every module one optional, uniform way to report its status to the UI and to the agent, so that subsystems without their own view are still visible.

**Prerequisites:** [0x000042](0x000042-dependency-injection-container.md) (DI container), [0x00004F](0x00004F-event-bus-infrastructure.md) (event bus)

This blueprint also holds the dashboard idea of the retired [0x00004C](0x00004C-module-proto-orchestration.md) (module proto orchestration).

---

### 1. What exists

No module exposes a widget. Module factories return their API object directly (for example `self/infrastructure/circuit-breaker.js` returns `{ create, State, DEFAULTS }`), and no code discovers widgets. Neither planned file exists. Status is shown by purpose-built views under `self/ui/` (proto, Zero, boot homes), which read module state through the DI container and the event bus.

### 2. Proposed protocol

A module may add a `getStatus` function to the API it already returns:

```javascript
getStatus: () => ({
  state: 'active' | 'idle' | 'warning' | 'error',
  primaryMetric: '47 items',     // short text
  secondaryMetric: '120ms avg',  // optional
  lastActivity: 1730000000000    // epoch ms, or null
})
```

and may name an event it emits when that status changes. A subscriber uses the event bus as it exists: `EventBus.on(event, fn, ownerId)` returns an unsubscribe function, and `EventBus.unsubscribeModule(ownerId)` removes every subscription registered under that owner (`shared/infrastructure/event-bus.js`). There is no `EventBus.off`.

`/ui/module-widget-protocol.js` would validate a status object. `/ui/module-proto.js` would list the modules registered in the DI container, call `getStatus` on those that have it, and render one row per module, refreshing on the named events.

The protocol is read-only. It carries no controls that change module state; actions stay with the tools and the approval gates ([0x000049](0x000049-hitl-controller.md)).

### 3. Verification conditions

- A module without `getStatus` still loads and is listed with state `unknown`.
- Unmounting the dashboard removes all of its event subscriptions.
- `getStatus` never throws into the dashboard; an error is shown as state `error` for that module.
