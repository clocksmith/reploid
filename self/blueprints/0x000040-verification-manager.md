# Blueprint 0x000040: Verification Manager

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/verification-manager.js`, `/shared/core/verification-worker.js`, `/self/testing/arena/vfs-sandbox.js`, `/tests/unit/verification-worker-prototype.test.js`, `/tests/unit/write-file-verification.test.js`, `/tests/unit/tool-verification-gate.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/verification-manager.js`, `testing/arena/vfs-sandbox.js`

**Former Blueprint Paths:** `self/blueprints/0x000040-verification-manager.md`
**Objective:** Check proposed source changes with static analysis in a disposable Web Worker before they are written or loaded, without executing the candidate code, and fail closed when the check cannot run.

**Prerequisites:** [0x00000A](0x00000A-tool-runner-engine.md) (Tool Runner), [0x000011](0x000011-advanced-storage-backend-indexeddb.md) (VFS), [0x00004F](0x00004F-event-bus-infrastructure.md) (EventBus)

**Affected Artifacts:** `self/core/verification-manager.js`, `shared/core/verification-worker.js` (served at `/self/core/verification-worker.js`), `self/testing/arena/vfs-sandbox.js`, `self/tools/WriteFile.js`, `self/core/tool-writer.js`, `self/core/vfs-module-loader.js`, `self/capabilities/system/substrate-loader.js`

---

### 1. What it is and is not

`VerificationManager` (metadata `id: 'VerificationManager'`, `genesis: { introduced: 'spark' }`, dependencies `Utils`, `VFS`, optional `EventBus`) is a static pre-flight checker. It parses candidate JavaScript with the vendored Acorn parser inside a Worker, matches dangerous patterns, checks path capabilities and measures complexity. It does not run tests, lint or type checks, and it is not a runtime sandbox for arbitrary JavaScript (`verification-worker.js:1-4`).

A pass is evidence that a change cleared these checks. It does not adopt or activate anything; adoption stays with the operator.

### 2. Interface

`factory(deps)` returns four functions (`verification-manager.js:302`):

| Function | Behavior |
| --- | --- |
| `verifyProposal(changes, options)` | `changes` is an array of `{ operation, file_path, new_content }` or a `{ path: content }` map (`null` content means delete). Options: `timeout` (default 10 000 ms), `quickMode` (default `true`: check only the changed files; `false` snapshots every `.js`/`.json` file in the VFS and overlays the changes), `requireVerification`, `toolCreation`. Resolves to `{ passed, skipped, reason, errors, warnings, events, details, verification }`. |
| `verifyFile(path, content)` | `verifyProposal` of one write in quick mode |
| `verifyFiles(filesMap)` | `verifyProposal` of several writes in quick mode |
| `getCapabilitiesForPath(path)` | Main-thread copy of the path rules for `/tools/`, `/apps/`, `/core/`, `/infrastructure/`, `/.logs/`; any other path gets the restricted `/tools/` rule |

### 3. Fail-closed behavior

- With the optional security mode off (`REPLOID_SECURITY_MODE`, default off) and no `requireVerification`, `verifyProposal` returns `{ passed: true, skipped: true, reason: 'Security disabled' }` without starting a Worker. A skipped result is not a pass; gates must check `skipped`.
- With `requireVerification: true` on the `x` or `zero` surface, the Worker URL is `/<surface>/__verifier__/worker.js` and the manager first checks that the controlling Service Worker is the matching active lab Service Worker; otherwise it fails with `VFS delivery unavailable`.
- A Worker that cannot be created, cannot receive the message, crashes, or does not answer within the timeout yields `passed: false` (events `verification:worker_crash`, `verification:timeout`).
- The manager hashes every snapshot file with SHA-256 and accepts the Worker's answer only if it reports `verification.kind === 'static-worker'` and the same hash for every file. Otherwise the result is `Worker source hash mismatch`.

### 4. Worker checks

`shared/core/verification-worker.js` is a classic Worker. It loads `/core/vendor/acorn.js` (or `./acorn.js` under the lab verifier path) with `importScripts`; a missing parser is a failure, never a reason to execute the candidate. For each `.js` file it runs:

1. Syntax parse (`verification:syntax_error`). With `toolCreation: true`, static `import` and re-export statements are errors: tools must use injected dependencies.
2. 37 dangerous patterns in the categories injection, prototype, execution, filesystem, network, storage, DOM, process and loop, for example `eval`, `function_constructor`, `dynamic_import`, `proto_access`, `fetch`, `indexeddb`, `innerhtml_assign`, `child_process`, `while_true` (`verification:pattern_detected`). A pattern whose required capability the path holds is allowed; `/core/` and `/infrastructure/` files skip patterns that need no capability.
3. Structural checks from the built-in `SimpleAST` scanner.
4. Top-level `/tools/*.js` files must have `export default` or `export const tool`.
5. Capability boundary: literal `VFS.write`, `VFS.delete`, `WriteFile` and `DeleteFile` targets must be allowed for the source path's prefix (`verification:capability_violation`). `/tools/` may write `/tools/`, `/apps/`, `/.logs/`, `/.memory/`; `/core/`, `/infrastructure/`, `/capabilities/` and `/testing/` may write anywhere.
6. Complexity warnings for non-privileged files: more than 500 lines, 20 functions, nesting depth 5, cyclomatic complexity 15 or line length 200 (`verification:complexity_warning`).

`passed` is true only when no check produced an error.

### 5. VFS sandbox

`VFSSandbox` (`self/testing/arena/vfs-sandbox.js`, `genesis: { introduced: 'substrate' }`) returns `createSnapshot()`, `restoreSnapshot(snapshot)`, `applyChanges(changesMap)` and `diffSnapshot(snapshot)`. It is not a separate copy of the VFS: `applyChanges` writes to the live VFS and `restoreSnapshot` deletes added files and rewrites changed ones. Callers wrap a candidate as snapshot, apply, verify, restore.

### 6. Callers

- `self/tools/WriteFile.js` contains a core-write gate for `/core/` and `/infrastructure/` paths when `REPLOID_ARENA_GATING` is `'true'` (a sandbox switch that runs no Arena competition): snapshot, apply, `verifyProposal(..., { requireVerification: true })` with a 30 s limit, restore. A missing verifier, error, timeout, restore failure, skipped result or any result other than an explicit pass blocks the write, audits `CORE_WRITE_BLOCKED` and emits `tool:core_blocked`. In the current policy the gate is not reached for VFS writes: `assertWritableVfsPath` (`self/config/vfs-policy.js`) allows only `/shadow`, `/artifacts` and `/cycles`, so `WriteFile` refuses core paths first.
- `self/core/tool-writer.js` requires a passing, non-skipped `verifyProposal` before installing a tool ([0x000015](0x000015-dynamic-tool-creation.md)).
- `self/capabilities/system/substrate-loader.js` verifies a critical-path module in the sandbox before loading it when the security mode and Arena gating are on. `self/core/vfs-module-loader.js` can verify before import, but only when a caller passes `verify: true`, and no current caller does.
- `self/testing/arena/arena-harness.js` and `self/capabilities/cognition/symbolic/rule-engine.js` call `verifyProposal` and read only `passed`. With the security mode off, the arena harness therefore counts a skipped check as `PASS`. Arena results rank candidates and grant nothing ([0x000066](0x000066-arena-harness.md)).

### 7. Related containment

| Layer | Blueprint |
| --- | --- |
| VFS in IndexedDB | [0x000011](0x000011-advanced-storage-backend-indexeddb.md) |
| Service Worker module delivery | [0x000002](0x000002-application-orchestration.md) |
| Genesis snapshots | [0x00003C](0x00003C-genesis-snapshot-system.md) |
| Arena scoring (informs only) | [0x000064](0x000064-arena-competitor.md), [0x000065](0x000065-arena-metrics.md), [0x000066](0x000066-arena-harness.md) |
| Circuit breaker | [0x00005C](0x00005C-circuit-breaker-pattern.md) |
| HITL approval | [0x000049](0x000049-hitl-controller.md) |
| Module integrity | [0x00002A](0x00002A-module-integrity-verification.md) |

### 8. Verification

- `tests/unit/tool-verification-gate.test.js` runs the real manager, tool writer and tool runner on the tool-creation gate.
- `tests/unit/verification-worker-prototype.test.js` loads the real Worker source and checks its prototype-access detection.
- `tests/unit/write-file-verification.test.js` exercises the `WriteFile` core gate with the VFS policy mocked open.
- `tests/unit/verification-manager.test.js` checks the real module's metadata; most of its cases test a copy of the capability rules held in the test file, so they do not prove the Worker's rules.
- `tests/e2e/vfs-storage-contract.spec.js` runs the Worker in a browser for the storage-owner exception.
