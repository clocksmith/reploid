# Blueprint 0x000071: Substrate Loader

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/system/substrate-loader.js`, `/self/core/vfs-module-loader.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/system/substrate-loader.js`, `core/vfs-module-loader.js`

**Former Blueprint Paths:** `self/blueprints/0x000071-substrate-loader.md`
**Objective:** Load ES modules and widgets from the VFS at runtime, with optional approval, sandbox verification and hash binding before import.

**Target Module:** `SubstrateLoader`

**Implementation:** `/capabilities/system/substrate-loader.js`, `/core/vfs-module-loader.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000011` (VFS); optional `0x000040` (Verification Manager), `0x000049` (Human-in-the-Loop Controller)

**Category:** System

**Genesis Level:** reflection (`self/config/genesis-levels.json` lists `SubstrateLoader` in level `reflection` with both files; module metadata `substrate-loader.js:12`)

---

## 1. Purpose

Code the agent writes lives in the VFS, but `import()` needs a URL. `loadVfsModule` turns VFS text into an importable URL (a blob URL in the browser, a `data:` URL in Node), rewrites relative imports so they resolve through the service worker, imports it, and revokes the URL. `SubstrateLoader` adds the policy checks that decide whether a given path may be loaded.

There is no `Storage` module or `Storage.getArtifactContent` call in this path. Both files read through the `VFS` dependency (`substrate-loader.js:14,77-79`; `vfs-module-loader.js:167`).

## 2. `SubstrateLoader` exports

Dependencies: `Utils`, `VFS`, optional `VerificationManager`, `VFSSandbox`, `HITLController` (`substrate-loader.js:14`). The factory returns `{ loadModule, loadWidget }` (`:130`).

| Function | Behavior | Source |
| --- | --- | --- |
| `loadModule(path, options)` | Throws `Module not found` if the VFS has no file. Reads the code, applies the approval and sandbox gates below, then calls `loadVfsModule` with `options.expectedSha256` and, for `options.force` (passed by `self/tools/LoadModule.js`), `forceReload`, which bypasses the loader's cache | `:76-113` |
| `loadWidget(path, containerId)` | Loads the module, requires `default.render()`, clears the container and appends the returned element | `:115-128` |

### Gates

| Gate | When it applies | Effect | Source |
| --- | --- | --- | --- |
| HITL approval | Security enabled, an `HITLController` exists, its `approvalMode` is not `autonomous`, and the path starts with `/core/`, `/infrastructure/` or `/capabilities/` | Requests `APPROVE_SELF_MODIFICATION` (5-minute timeout); rejection throws `Load blocked by HITL` | `:28-59,81-86` |
| Arena sandbox | Security enabled, `localStorage.REPLOID_ARENA_GATING === 'true'`, and a critical path | Snapshot, apply, `verifyProposal(..., { requireVerification: true })`, restore. A missing verifier, a non-pass or a skipped result throws | `:22-26,61-74,89-99` |
| Loader verification | Every load that did not go through the sandbox gate | `loadVfsModule(..., { verify: true })` | `:101-110` |

With security disabled, no gate runs; that is the documented permissive default (`:88`, `self/core/security-config.js`).

## 3. `vfs-module-loader.js` exports

| Export | Behavior | Source |
| --- | --- | --- |
| `loadVfsModule(options)` | Options: `VFS` (required), `path` (required), `logger`, `VerificationManager`, `EventBus`, `code`, `verify` (false), `forceReload` (false), `expectedSha256`, `retries` (0), `retryDelay` (100) | `:135-247` |
| `clearVfsModuleCache(path?)` | Clears one entry or the whole cache | `:253-262` |
| `getVfsModuleStats()` | Load, cache-hit, cache-miss, verification and error counters plus cache entries | `:268-281` |
| `isModuleCached(path)` | Cache membership | `:288-290` |
| `resetVfsModuleStats()` | Zeroes counters (tests) | `:295-302` |

Load rules:

- Paths are normalized to a leading `/` and a `.js` or `.mjs` suffix (`:114-118`).
- Concurrent loads of one path share a promise, except for forced or hash-bound loads (`:157-159`).
- With `expectedSha256`, the SHA-256 of the exact bytes to import must match, or the load fails (`:173-177`). This binds an approval to bytes, not to a path.
- The cache is keyed by path and reused only when the code is byte-identical (`:27-33`).
- With `verify` and security enabled, a missing verifier, a failed or a skipped result throws (`:188-205`).
- The import URL is revoked in a `finally` block (`:211-222`).

Events (only when an `EventBus` is passed): `vfs:module_loaded` `{ path, cached, size? }` and `vfs:module_error` `{ path, error }` (`:182,218,236`). `SubstrateLoader` does not pass one, so its loads emit nothing.

Other callers of `loadVfsModule`: `self/core/tool-runner.js:166`, `self/core/create-tool.js:296`, `self/zero/tools.js:163`, `self/tool-runner.js:6`. `SubstrateLoader.loadModule` is called by `self/tools/LoadModule.js:45` and `self/core/tool-writer.js:110` (with `expectedSha256`).

## 4. Boundaries

- A blob URL runs in the page's origin with full page privileges. Loading is not isolation; the gates above and the Verification Worker are the only checks.
- Loading a module does not promote it. Durable changes under `/self` follow [`promotion-contract.md`](promotion-contract.md).

## 5. Verification requirements

- A hash-bound load with mismatched bytes fails and does not reuse a pending path-only load.
- With security and arena gating enabled, a critical path does not load when the verifier is missing or returns a skipped result.
- With an HITL mode other than `autonomous`, a rejected approval blocks the load.
- `loadWidget` rejects a module without `default.render`.
