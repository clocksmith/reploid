# Blueprint 0x000149: core run replay bundle

**Objective:** Provide a small, browser-local JSON bundle contract for exporting a Zero/Reploid run and importing it back through the boot screen.

**Target Upgrade:** core/run-replay-bundle.js

**Affected Artifacts:** /core/run-replay-bundle.js

---

### 1. Intent

`run-replay-bundle.js` owns the portable run JSON shape. It lets the runtime export goal, model metadata, context, recent activity, cycle artifacts, and selected evidence files without depending on UI code.

The same module validates imported JSON and derives safe boot-state updates. Import may refill the objective and compatible model fields. It must not restore arbitrary VFS files or secrets from an untrusted bundle.

### 2. Architecture

The module exports pure helpers for:

- `buildRunReplayBundle`: package live run state into `reploid.run-replay.v1`
- `validateRunReplayBundle`: reject malformed or unsupported JSON
- `deriveBootStateFromRunReplayBundle`: convert safe bundle metadata into boot state
- `collectReplayVfsFiles`: read bounded `/cycles`, `/artifacts`, `/.logs/timeline`, and `/.system` files
- `formatRunReplayFilename`: create deterministic download names

AgentLoop calls the builder. Zero UI downloads the bundle. Boot home validates imports and applies only the safe derived state.

### 3. Implementation Notes

Model configs are recursively redacted before export. The flat `vfs` map remains compatible with the existing replay engine, while `cycles` provides parsed per-cycle evidence for direct inspection.

VFS export is bounded by file count, per-file size, and total payload size. The allowlist excludes `/self` and `/shadow` so exported replay JSON does not become a silent self-restore channel.

### 4. Verification Checklist

- [x] Secrets are redacted from exported model configs.
- [x] Import rejects missing or unsupported schemas.
- [x] Boot-state derivation does not write bundled VFS files.
- [x] Export includes replay-engine-compatible flat VFS data.
- [x] Zero boot seed includes the helper.

*Last updated: July 2026*
