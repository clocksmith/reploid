# Blueprint 0x00000A: Tool Runner Engine

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/tool-runner.js`, `/self/core/tool-capabilities.js`, `/self/tool-runner.js`, `/packages/reploid/src/agent/tool-runner.js`, `/tests/unit/tool-runner.test.js`, `/tests/unit/tool-runner-disposal.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/tool-runner.js`

**Former Blueprint Paths:** `self/blueprints/0x00000A-tool-runner-engine.md`
**Objective:** Load tool modules from the VFS, keep the set of callable tools per surface, and run each call through the configured permission, policy, approval, validation, trace and audit steps.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Utils), [0x000011](0x000011-advanced-storage-backend-indexeddb.md) (VFS), [0x00004F](0x00004F-event-bus-infrastructure.md) (EventBus), [0x000040](0x000040-verification-manager.md) (VerificationManager)

**Affected Artifacts:** `self/core/tool-runner.js`, `self/core/tool-capabilities.js`, `self/core/vfs-module-loader.js`, `shared/config/tool-surfaces.js`, `self/tools/*.js`

---

### 1. Three runners

| File | Role |
| --- | --- |
| `self/core/tool-runner.js` | `ToolRunner` DI module (`genesis: { introduced: 'capsule' }`) for the Zero, X and legacy substrate boots. This blueprint describes it. |
| `self/tool-runner.js` | `createSelfToolRunner(options)` for the awakened Reploid self: wraps the shared minimal runner with `loadVfsModule` and `resolveSelfAuthorization` (`self/tool-authorization.js`), which by default allows only `ReadFile` and `WriteFile`. |
| `packages/reploid/src/agent/tool-runner.js` | `createToolRunner(options)`, the minimal library runner (vendored at `shared/vendor/reploid/agent/tool-runner.js`): built-in tools plus `LoadModule`, an explicit `authorize` callback that must return `true` for every call, and `executeTool`, `loadModule`, `listToolNames`, `close`. |

### 2. All tools are dynamic

`ToolRunner` has no built-in tools. Every tool is a VFS module (`tool-runner.js:62`):

- `init()` / `refresh()` (`loadDynamicTools`) unloads previous dynamic tools and scans `/tools/` and `/self/tools/`. `/tools/` files are loaded only if their name is in the surface allowlist; every `/self/tools/` file is loaded and allowed. Test files (`.test.`, `.spec.`, `.integration.`) are skipped, and minimal lab modes skip `Promote`.
- The allowlist is `getToolNamesForMode(mode, ...)` from `shared/config/tool-surfaces.js` plus names added with `allow(name)`. The Zero seed surface is `CreateTool` only.
- A tool module exports a default function or `tool.call`, and optionally `tool.description`, `tool.inputSchema` and `tool.capabilities` / `tool.zeroCapabilities`. The schema is registered with `SchemaRegistry`. A module whose source contains `ToolRunner.run` is refused.
- Modules are imported through `loadVfsModule` (`self/core/vfs-module-loader.js`) as Blob module URLs. The runner passes `expectedSha256` when it has one, so a pinned load fails on any byte change, but it does not pass `verify: true`; a tool is statically verified when it is created ([0x000015](0x000015-dynamic-tool-creation.md)), not again when it is loaded.
- `loadPath(path)` accepts only installed `/self/tools/*.js` paths and rejects `..`.

### 3. Interface

`factory(deps)` returns `init`, `dispose`, `execute`, `refresh`, `allow`, `load`, `loadPath`, `unload`, `list`, `listFiltered`, `has`, `setArenaGating`, `isArenaGatingEnabled`, `getToolSchemas`, `getToolSchemasFiltered`, `setOutputValidation`, `setStrictValidation`, `isOutputValidationEnabled` and `setWorkerManager`. `dispose()` is terminal: the instance refuses further calls, while saved tool source stays in the VFS.

### 4. `execute(name, args, { allowedTools, workerId, trace })`

In order:

1. `assertConfiguredGates` (on `x` and `zero` only): with the security mode on, a missing `PolicyEngine` is an error; a saved `REPLOID_HITL_CONFIG` that names a mode other than `autonomous` or `inherit` while no `HITLController` is present is an error, as is an unparsable saved config. The same check runs before loading tools.
2. Worker permission: when `allowedTools` is not `'*'` and does not include `name`, throw and audit `TOOL_PERMISSION_DENIED` ([0x000047](0x000047-worker-pool-parallelization.md)).
3. With the security mode on, `PolicyEngine.check(name, args, { workerId })`; a block throws and audits `TOOL_POLICY_BLOCKED`, a warning audits `TOOL_POLICY_WARNING`.
4. Load the tool on demand from `/tools/<name>.js` if it is allowlisted.
5. HITL: with the security mode on and the master approval mode not `autonomous`, `WriteFile`, `DeleteFile`, `CreateTool`, `EditFile`, `CopyFile`, `MoveFile`, `MakeDirectory`, `LoadModule` and `Promote` go through `HITLController.requestApproval` with a 5-minute timeout; a rejection returns `{ error, rejected: true }` and audits `TOOL_REJECTED` ([0x000049](0x000049-hitl-controller.md)).
6. Build the dependency object (VFS, EventBus, AuditLogger, VerificationManager, VFSSandbox, WorkerManager and the other optional modules, plus a restricted `ToolRunner` handle) and filter it with `filterToolDepsForTool` (`self/core/tool-capabilities.js`). On `x` and `zero`, `Shell` and `gitTools` are removed, the VFS is read-only unless the tool declares `vfs:write` or `self:write`, and tool loading is removed unless it declares `tool:load` or `self:write`. `CreateTool` is the internal exception.
7. Call the tool, validate its output when `SchemaValidator` validation is on, record `tool:execute` in `TraceStore` when tracing, and log through `AuditLogger.logToolExec`. Errors are rethrown as `ToolError` with the tool name and arguments.

The runner executes a tool; it does not decide that a tool's result should be adopted. Policy, approval and verification can only block a call.

### 5. Arena gating flag

`setArenaGating(enabled)` stores `REPLOID_ARENA_GATING` and emits `toolrunner:arena_gating`. `isArenaGatingEnabled()` is true only with the security mode on. The flag turns on the Verification Worker sandbox gate for core writes; it runs no Arena competition ([0x000040](0x000040-verification-manager.md)).

### 6. Verification

`tests/unit/tool-runner.test.js`, `tests/unit/tool-runner-disposal.test.js` and `tests/unit/self-authorization.test.js` cover loading, surfaces, arena gating, disposal and the self runner's default authorization.
