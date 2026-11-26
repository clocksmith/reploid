# Blueprint 0x000015: Dynamic Tool Creation System

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/tool-writer.js`, `/self/tools/CreateTool.js`, `/self/core/create-tool.js`, `/tests/unit/tool-writer.test.js`, `/tests/unit/tools/create-tool.test.js`, `/tests/unit/tool-verification-gate.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/tool-writer.js`, `tools/CreateTool.js`

**Former Blueprint Paths:** `self/blueprints/0x000015-dynamic-tool-creation.md`
**Objective:** Let the agent write a new tool as module source, stage it only after a static Verification Worker pass bound to its exact bytes, and install it only through evidence-producing activation or promotion.

**Prerequisites:** [0x00000A](0x00000A-tool-runner-engine.md) (Tool Runner), [0x000040](0x000040-verification-manager.md) (Verification Manager)

**Affected Artifacts:** `self/core/tool-writer.js`, `self/tools/CreateTool.js`, `self/core/create-tool.js`, `self/core/vfs-module-loader.js`

---

### 1. Components

| File | Role |
| --- | --- |
| `self/core/tool-writer.js` | `ToolWriter` DI module (`genesis: { introduced: 'spark' }`): `create(name, code, options)` and `assertVerified(result, code)` |
| `self/core/create-tool.js` | `CreateTool` implementation: builds source, calls `ToolWriter.create`, and in minimal X/Zero runs activation |
| `self/tools/CreateTool.js` | The tool module the runner loads; sets `minimalMode` from the route and delegates to `create-tool.js` |

There is no tool manifest file. A tool is a VFS module; the runner discovers it as described in [0x00000A](0x00000A-tool-runner-engine.md).

### 2. Staging: `ToolWriter.create(name, code, { root, load })`

1. The name must match `^[A-Z][A-Za-z0-9]*$`.
2. String checks: the source contains `export default` or `export const tool`, and an async call (`async function`, `async (` or `call: async`).
3. The staging root defaults to `/shadow/tools` and must be `/shadow/tools` or below it.
4. `VerificationManager.verifyProposal` is required. Without it, creation fails. The source is checked as the restricted path `/tools/<Name>.js` with `{ quickMode: true, requireVerification: true, toolCreation: true }`, so static imports are refused and the tool must use injected dependencies.
5. The result must be `passed: true`, `skipped: false`, `verification.kind === 'static-worker'`, and report the same SHA-256 as the staged source. Anything else throws `Verification Worker refused tool`.
6. The writer records an approval keyed by a frozen `verification` object in a private `WeakMap`, writes the file, and re-checks the written bytes with `assertVerified`. A caller cannot forge the receipt with a boolean.
7. With `load: true` and a `SubstrateLoader`, it loads the staged path with `expectedSha256`.

No code path compiles candidate source with `new Function` or `eval` on the main thread; the earlier `new Function(code)` check was removed (`tool-writer.js:43`). The candidate is imported as an ES module through `loadVfsModule` only after the Worker pass.

### 3. `CreateTool` call

`CreateTool` takes `name` and either `code` (complete module source) or structured fields (`description`, `activation`, `inputSchema`, `capabilities`, `call`). It rewrites `ToolRunner.run` to `ToolRunner.execute`, then calls `ToolWriter.create(name, code, { root: args.root || '/shadow/tools', load: false })`.

- Broader modes: the result is a staged candidate. `CreateTool` emits `tool:candidate_created` and audits `TOOL_CANDIDATE_CREATED`. Installing it into `/self/tools` requires evidence-gated promotion (`self/tools/Promote.js`, [0x000080](0x000080-core-promotion-policy.md)).
- Minimal X/Zero (unless `activate: false`): `activateZeroTool` installs a new tool into the Zero instance's own `/self/tools/<Name>.js`, after these checks:
  - targets that would change a validator are quarantined to `/artifacts/quarantine/` and not installed; an existing or protected target requires promotion;
  - `ToolWriter.assertVerified` on the staged bytes;
  - the module is imported, its declared name, input schema and `tool.activation` contract (fixture-backed checks, at most 8, 5 s each) are validated and run;
  - it is re-imported in a fresh harness and replayed, and the two transcripts must hash equal;
  - the installed bytes must match the verified hash, and `ToolRunner.loadPath(..., { allow: true, expectedSha256 })` must load it;
  - evidence `reploid.zero.createToolEvidence.v3` is written to `/artifacts/<Name>-evidence.json`; a failure writes failure evidence and removes the partial install.

  Success emits `tool:created_activated` and audits `TOOL_CREATED_ACTIVATED`.

### 4. Capabilities

A created tool starts read-only on X and Zero. It receives VFS write access only by declaring `vfs:write` or `self:write`, and tool-loading access only by declaring `tool:load` or `self:write`, in exported `tool.capabilities` or `tool.zeroCapabilities` (`self/core/tool-capabilities.js`).

### 5. Authority

Verification, activation checks and replay are evidence that block a bad candidate. Minimal-mode activation adds one tool to the requesting instance's own tool set; it is not adoption of a substrate change. Changes to shared substrate, core modules or validators go through promotion and operator adoption.

### 6. Verification

`tests/unit/tool-writer.test.js`, `tests/unit/tools/create-tool.test.js` and `tests/unit/tool-verification-gate.test.js` cover naming, the required Worker pass, byte binding, staging roots and activation.
