# Blueprint 0x000049: Human-in-the-Loop Controller

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/infrastructure/hitl-controller.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/hitl-controller.js`

**Former Blueprint Paths:** `self/blueprints/0x000049-hitl-controller.md`
**Objective:** Hold one approval mode for the substrate, queue actions that need an operator decision, and resolve each queued action only through an explicit approve, reject or timeout.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Utils), [0x00004F](0x00004F-event-bus-infrastructure.md) (EventBus)

**Affected Artifacts:** `self/infrastructure/hitl-controller.js`, `self/core/tool-runner.js`, `self/ui/zero/index.js`

---

### 1. Authority

The controller decides whether an action waits for an operator. It never makes the decision on the operator's behalf: a queued item leaves the queue only through `approve`, `reject` or its timeout (which rejects). A model, a score or a peer cannot approve; the shipped approve path is the operator's button in the Zero UI (`self/ui/zero/index.js`), which emits `hitl:approve` or `hitl:reject`.

The default is permissive. With the security mode off (`REPLOID_SECURITY_MODE`, default `false` in `self/core/security-config.js`) or the approval mode `autonomous`, `requiresApproval` returns `false` and `requestApproval` calls `onApprove` immediately. That is an absence of a gate, not an approval by anyone; it is recorded only in the `autoApproved` counter. A caller that must always wait for a person passes `alwaysRequireHuman: true`, which queues the item in every mode.

### 2. Modes

`MODES` (`hitl-controller.js:36`):

| Mode | Value | `requiresApproval(moduleId, capability)` |
| --- | --- | --- |
| `AUTONOMOUS` | `'autonomous'` | always `false` (the default `approvalMode`) |
| `HITL` | `'hitl'` | `true` only if the module is registered with that capability |
| `EVERY_N` | `'every_n'` | increments a step counter; `true` on every `everyNSteps`-th call (default 5, valid 1-100) |
| `INHERIT` | `'inherit'` | per-module override only: use the master `approvalMode` |

The master mode, per-module overrides, `everyNSteps` and the step counter persist in `localStorage` under `REPLOID_HITL_CONFIG`.

### 3. Capabilities

`CAPABILITIES` values: `approve_code_changes`, `approve_file_operations`, `approve_tool_execution`, `approve_self_modification`, `approve_core_writes`, `approve_intent_bundle`, `approve_trained_adapter`.

### 4. Interface

The factory returns:

| Member | Purpose |
| --- | --- |
| `init()` | Load the saved config and subscribe to the control events below |
| `CAPABILITIES`, `MODES` | Constants above |
| `registerModule(moduleId, capabilities, description)` | Declare which capabilities a module gates; emits `hitl:module-registered` |
| `getModuleMode(moduleId)` | Override, or the master mode when the override is absent or `inherit` |
| `setApprovalMode(mode)` | Accepts `autonomous`, `hitl`, `every_n`; emits `hitl:approval-mode-changed` |
| `setModuleMode(moduleId, mode)` | Registered modules only; emits `hitl:module-mode-changed` |
| `setEveryNSteps(n)` | Emits `hitl:every-n-changed` |
| `requiresApproval(moduleId, capability)` | Predicate in section 2 |
| `requestApproval({ moduleId, capability, action, data, onApprove, onReject, timeout, alwaysRequireHuman })` | Returns `null` when no approval is needed (after calling `onApprove`), otherwise queues the item, emits `hitl:approval-pending` and returns its ID |
| `approve(approvalId, data)` | Removes the item, calls `onApprove(data, { approvalId, approvedAt, source: 'hitl-controller', humanRequired })`, emits `hitl:approval-granted` |
| `reject(approvalId, reason)` | Removes the item, calls `onReject(reason)`, emits `hitl:approval-rejected` |
| `getState()`, `getApprovalQueue()`, `getStats()` | Read-only copies of config, queue, statistics and the last 50 outcomes |
| `isHITLEnabled()` | Security mode on and master mode `hitl` |
| `resetToDefaults()` | Mode back to `autonomous`, overrides and queue cleared, timeouts cancelled; emits `hitl:config-reset` |

A timed-out item is rejected with `'Approval timed out'` and emits `hitl:approval-timeout`.

### 5. Control events

`init()` subscribes, with owner `HITLController`, to `hitl:set-approval-mode` `{ mode }`, `hitl:set-module-mode` `{ moduleId, mode }`, `hitl:approve` `{ approvalId, data }` and `hitl:reject` `{ approvalId, reason }`.

### 6. Callers

- `self/core/tool-runner.js` gates `WriteFile`, `DeleteFile`, `CreateTool`, `EditFile`, `CopyFile`, `MoveFile`, `MakeDirectory`, `LoadModule` and `Promote` when the security mode is on and the master mode is not `autonomous`, with a 5-minute timeout.
- `self/capabilities/cognition/symbolic/rule-engine.js`, `self/capabilities/system/substrate-loader.js`, `self/infrastructure/intent-bundle-gate.js` and `self/experimental/intelligence/neural-compiler.js` (with `alwaysRequireHuman: true`) also request approval.

### 7. Incomplete boundary

- `ToolRunner` never calls `registerModule` and passes the key `'APPROVE_TOOL_EXECUTION'` rather than the value `approve_tool_execution`. In `hitl` mode, `requiresApproval('ToolRunner', ...)` therefore returns `false` and critical tool calls proceed without a queued decision; only `every_n` mode or `alwaysRequireHuman` queues them. Until ToolRunner registers the value and a test exercises a queued tool call, `hitl` mode is not a verified gate for tools.
- `approve` does not check who called it. Any code on the page bus can emit `hitl:approve`; the operator-only property rests on no module doing so.
- No unit test exercises this module.
