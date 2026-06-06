# Reploid Simplification and True RSI Refactor Plan

## Goal

Goal: make `reploid` a single self-generating RSI substrate rooted at `/`, while keeping compatibility with existing boot/runtime contracts. Current reality: `/` boot coexists with `/0` and `/x`, `reploid_home` seeds 42 files, runtime context comes from `SELF_PROMPT_PATHS + SELF_BLUEPRINT_PATHS`, and tools are `ReadFile`, `WriteFile`, `CreateTool`, `LoadModule`; `Promote` remains policy text, not executable. We’ll treat these mismatches as debt and complete an eight-proposal consolidation through phased refactors and deterministic gates.

Phase 1 updates `reploid/NEXT.md` to capture current-state vs target-state and create migration contracts for boot, manifest, and test behavior. Phase 2 introduces `BlueprintIndex` as the only boot-time blueprint feed, with manifest hydration limited to explicit request. Phase 3 ports a strict `rgr-policy.js` gate (`scoreCandidate`, `verifyAnchors`, `canPromote`, `rollback`) and routes every candidate mutation through `/shadow` and atomic promote flow. Phase 4 collapses primitives to `ReadFile`, `WriteFile`, `LoadModule`, and `Promote`; every other behavior is generated in `/self/tools/*.js` and treated optional/archived. Phase 5 adds self-compiler flow (`self-compiler`) that generates `self.json`, prompt, and tool manifest from objective and capability probes, and rewires bootstrap so `/` is default active seed.

Success criterion is bounded RSI: every mutation must pass executable gates, emit signed receipt + version trace, avoid direct `/self` writes by the model, and pass post-promotion host replay and verification.

## Objective

Refactor `~/deco/reploid` so the primary `/` seed is the only first-class runtime, with a small immutable browser kernel + generated/validated VFS self-description, executable recursive GEPA Ring (RGR) policy, and bounded self-mutation via a real `Promote` gate.  
The migration must preserve deterministic operation, preserve rollback safety, and keep legacy architecture available only as archived research artifacts.

This plan is strict, staged, and file-level explicit so implementation can be performed incrementally with minimal ambiguity.

---

## Sources of Truth

The migration is constrained by existing behavior already present in code:

- Boot routing and profiles in `reploid/self/boot-spec.js`
- Seed material definitions in `reploid/self/config/boot-seed.js`
- VFS manifest logic in `reploid/self/manifest.js`
- Agent control loop and runtime context assembly in `reploid/self/runtime.js`
- Tool exposure in `reploid/self/tool-runner.js`
- Tool and module plumbing in `reploid/self/bridge.js`
- Tool load surface in `reploid/self/tool-runner.js`
- Existing bootstrap/module generation logic in `reploid/self/config/genesis-levels.json`
- Existing feature-blueprint registry in `reploid/self/config/blueprint-registry.json` (legacy references)

Important behavior preserved during planning:
- `/` is currently already a compact seed compared to `/0` and `/x` but still uses legacy bootstrap scaffolding.
- `0x000112-recursive-gepa-ring.md` exists and is currently source-projected but not necessarily initial context.
- `Promote` appears in tool contracts but is not a fully implemented primary runtime capability.

---

## Principles

1. **No behavior before gate**: every new capability must pass schema/anchor/policy checks before being promoted into active `/self`.
2. **Fail-closed policy**: any missing, malformed, or unverifiable output must deny promotion.
3. **`/` is the only live architecture**: `/0`, `/x`, and wizard/spark/full scaffolds are research-only and must not be booted in production runtime paths.
4. **Minimal initial context**: keep first model context to non-negotiable kernel files and a compact contract.
5. **No hardcoded self-construction**: generation of `self.json`, active toolset, and prompt must be produced by executable/self-compiling mechanisms and schema-validated.
6. **Single authoritative policy module**: prose blueprints inform reference docs only, not execution decisions.
7. **Atomic promotion and reversible state**: `/shadow` and `/self` transitions are transactional, snapshot-backed, and rollback-ready.

---

## Scope

In-scope:
- `reploid/self/*` runtime and bootstrap surface
- `reploid/self/config/*`
- `reploid/self/tools/*`
- `reploid/self/manifest.js`
- `reploid/self/blueprints/*` (index and references)
- Archival/relocation of legacy modules inside `reploid/` where needed

Out of scope for this plan:
- Doppler engine refactor (only integration contract changes where needed)
- Cross-repo changes outside `~/deco/reploid`
- Major UI redesign

---

## Target Architecture

### Desired VFS layout after migration

```text
/
├── self/
│   ├── boot-spec.js            # minimal bootstrap router for `/`
│   ├── runtime.js              # immutable core loop
│   ├── rgr-policy.js           # executable RGR policy
│   ├── self.json               # generated self descriptor
│   ├── blueprint-index.json     # generated index of loaded/available blueprints
│   ├── tools/
│   │   ├── read-file.js
│   │   ├── write-file.js
│   │   ├── load-module.js
│   │   ├── promote.js
│   │   └── self-compiler.js    # birth/birth-like generation tool
│   ├── prompts/
│   │   └── kernel.md
│   ├── blueprints/
│   │   ├── rgr-runtime-contract.md
│   │   ├── rgr-slot-topology.md
│   │   └── (others loaded on-demand only)
│   └── bridge.js               # module/tool/runtime bridge with SW constraints
├── shadow/                     # isolated mutation workspace
├── artifacts/
│   └── rgr/
│       ├── attempts/
│       ├── traces/
│       └── blueprints/
└── .system/
    ├── evolution.trace
    ├── receipt-chain.jsonl
    └── rollback-manifest.json
```

---

## Phase Plan

### Phase 0 — Preflight baseline capture

Goal: produce a non-editable baseline for comparison and gating.

Actions:
- Add `reploid/research/migration-baseline.md` if not present with:
  - current `/` boot profile file list
  - current `/` context-injected paths
  - current `ReadFile/WriteFile/LoadModule/CreateTool` surface
  - current `Promote` call contract vs runtime support status
- Capture and store this as immutable artifact in `reploid/artifacts/rgr/baseline/`.

Artifacts:
- `reploid/artifacts/rgr/baseline/reploid-boot-runtime-v0.json`
- `reploid/artifacts/rgr/baseline/tool-contract-v0.json`

Acceptance:
- Baseline file exists and includes explicit file list plus hashes for critical runtime files.

---

### Phase 1 — Remove multi-architecture boot routing

Objective: make `/` the only operational boot target.

Files and edits:
- `reploid/self/boot-spec.js`
  - Collapse `profiles` routing to keep `reploid_home` only for live startup.
  - Remove/disable `/0`, `/x`, wizard/spark/full mappings from live route resolution.
  - Keep compatibility aliases only if required for no-fail debugging, but mark as `deprecated: true` and never active by default.
  - Ensure any route resolution default still points at `/` profile.

- `reploid/self/config/boot-seed.js`
  - Keep existing exported profile constants but only expose `/` profile for runtime route.
  - Remove profile expansion that hydrates full manifest for non-`reploid_home` routes.
  - Replace non-core prefix boot lists with minimal set and explicit manifest-only mode.

- `reploid/self/config/boot-seed.js` runtime seed set:
  - Non-negotiable files in initial `/`:
    - `/self/self.json`
    - `/self/prompts/kernel.md`
    - `/self/blueprints/rgr-runtime-contract.md`
    - `/self/blueprints/rgr-slot-topology.md`
    - `runtime.js`
    - `bridge.js`
    - `tool-runner.js`
    - `rgr-policy.js` (once introduced)
    - `blueprint-index.json` (initial index skeleton)
  - Remove forced imports of legacy cognition modules from initial seed.

- `reploid/self/manifest.js`
  - Ensure `SELF_BLUEPRINT_PATHS` remains only compact contract topology blueprints.
  - Keep `SELF_SOURCE_MIRRORS` for archival/inspection, but prevent auto-context inclusion except explicit resolve requests.

Acceptance:
- Booting `/` loads minimal seed and does not hydrate non-core manifest paths.
- `/0` and `/x` are unreachable from production boot path.

---

### Phase 2 — Replace implicit tabula assumptions with generated boot descriptor

Objective: remove hand-authored/legacy `genesis-levels` control flow from live bootstrap.

Files and edits:
- `reploid/self/config/genesis-levels.json`
  - Deprecate current rich cognition stack entries from active resolution.
  - Keep file content intact for research (or move copies into `reploid/research/legacy/` if required by tooling).
  - Add explicit `"status": "legacy_research_only"` marker for any active profile-like entries.

- `reploid/self/runtime.js`
  - Replace implicit dependency assumptions on full genesis module graphs with explicit generated descriptor loading.
  - Read active kernel descriptor from `/self/self.json` as authoritative.

- `reploid/self/manifest.js`
  - Remove direct hardcoded build of 173/legacy manifest assumptions where they currently inject hidden execution context.

Acceptance:
- Runtime can boot and operate with no reliance on full legacy `genesis-levels` chain for first-step behavior.

---

### Phase 3 — Introduce executable policy `rgr-policy.js`

Objective: make RGR policy deterministic, testable, and non-prose.

New file:
- `reploid/self/rgr-policy.js`

Required API (must be implemented and exported):
- `class RGRPolicy`
  - `constructor(vfs, opts = {})`
  - `validateTraceSchema(trace)`
  - `scoreCandidate({ candidatePath, tracePath, candidateMeta })`
  - `verifyAnchors({ candidatePath, trace, tracePath })`
  - `rollbackPathRequired({ candidatePath, trace, score })`
  - `canPromote({ candidatePath, tracePath })`
  - `cryptoVerify(payload, signature, pubkey)` (internal verifier)

Implementation requirements:
- Trace schema strict JSON validation before scoring.
- Anchor verification order:
  1. Presence of required proof fields (`trace.version`, `trace.traceId`, `trace.timestamp`)
  2. Replay verification (`trace.replay_verified === true`)
  3. Signature verification for all declared signatures (if any), with deterministic failure on missing pubkey/signature formats
  4. Optional peer witness checks behind feature flag; not required if absent.
- Score computation:
  - Inputs: execution time, token budget delta, test pass ratio, regression delta, optional hazard flags.
  - Output: bounded score and rejection reasons.
- Promotion decision:
  - Fail closed when score missing/NaN/error
  - Require non-regression rule unless explicitly allowed in change class
  - Return object with `{ok, score, reasons, trace, evidence}`.

Acceptance:
- No candidate can pass without explicit, schema-valid anchors and score evidence.
- Policy module can be unit-tested in isolation in its module file.

---

### Phase 4 — Enforce tool contraction to primitives and dynamic generated tools

Objective: make `ReadFile`, `WriteFile`, `LoadModule`, and `Promote` the only kernel primitives.

Files and edits:
- `reploid/self/tool-runner.js`
  - Replace broad or hardcoded tool list with strict primitive switch dispatch:
    - `ReadFile`
    - `WriteFile`
    - `LoadModule`
    - `Promote`
  - Remove built-in `CreateTool`.
  - For non-primitive names:
    - Resolve under `/self/tools/${toolName}.js` only if allowlist permits and policy hash/manifest entry exists.
    - Load via `LoadModule` path policy and execute only through module contract.

- `reploid/self/tools/read-file.js`
  - Add as explicit primitive tool module (if not already standalone).

- `reploid/self/tools/write-file.js`
  - Restrict target paths:
    - For model-invoked operations: deny writes to `/self` and `/.system`.
    - Permit `/shadow`, `/artifacts`, `/tmp`, and approved shared staging roots.
  - Add policy flags for kernel-only override usage.

- `reploid/self/tools/load-module.js`
  - Add module import guard:
    - canonical path normalization
    - extension allowlist
    - max module depth and traversal guard
    - optional signature/hash verification.

- `reploid/self/tools/promote.js` or `ToolRunner.promoteCandidate`
  - Implement actual promotion semantics (described in Phase 5).

Acceptance:
- Model-visible tool set only contains listed four primitives.
- Dynamic tool execution is not implicit and must be policy-anchored.

---

### Phase 5 — Implement real `Promote` with GEPA gate

Objective: complete bounded self-modification path from `/shadow` into active `/self`.

Files and edits:
- `reploid/self/tool-runner.js`
  - Add real `Promote` handler using `RGRPolicy`.
  - Inputs required:
    - `candidatePath` (must be within `/shadow/`)
    - `tracePath` (must be existing under `/artifacts/rgr/traces/`)
    - optional `signaturePath`

Promotion algorithm:
1. Validate paths, policy domain, and manifest lock.
2. Load trace and candidate metadata.
3. Call `policy.canPromote(...)`.
4. If denied:
   - append rejection artifact under `/artifacts/rgr/attempts/<id>-rejected.json`
   - keep `/shadow` intact
   - return explicit reasons.
5. If approved:
   - snapshot active `/self` metadata into `/artifacts/rgr/rollback/<id>/`
   - move or copy candidate payloads from `/shadow` into `/self` via atomic staged write plan
   - update `/self/self.json` and blueprint/tool manifests
   - invalidate service worker cache/module loader state
   - emit promotion receipt under `/.system/evolution.trace`
6. Add post-promotion guard:
   - rerun lightweight readiness probe
   - if fails, auto-rollback using snapshot.

Important constraints:
- No direct overwrite path traversal.
- `Promote` can only mutate to paths inside `/self`.
- Rollback manifest includes:
  - `beforeStateHash`
  - `afterStateHash`
  - `changedFiles`
  - `promotionResult`.

Acceptance:
- A valid promotion creates a new active runtime manifest and a durable receipt.
- Failures auto-rollback and emit clear machine-readable reason.

---

### Phase 6 — Add `SelfCompiler`/Birth generation path

Objective: replace hardcoded self synthesis with objective-driven generation.

Files and edits:
- `reploid/self/tools/self-compiler.js` (new)
- `reploid/self/runtime.js` or bootstrap policy to invoke self-compiler when self descriptor invalid/out-of-date.
- `reploid/self/manifest.js` to stop hardcoding `rgr` runtime/bridge payload generation.

Compiler behavior:
- Inputs:
  - objective
  - capability probe (WebGPU, storage, worker, optional peer)
  - environment constraints (browser feature flags)
- Output artifacts written to `/artifacts` first:
  - generated `self.json`
  - generated prompt text
  - generated tool manifest
  - generated `blueprint-index` seed
- Only `Promote` is allowed to move these into `/self`.

Acceptance:
- No runtime path reads static hand-built `/self` module manifests for these core descriptors.
- `self.json` and kernel prompt can be regenerated deterministically from same probe inputs.

---

### Phase 7 — Build compact generated `blueprint-index.json`

Objective: stop loading giant blueprint sets by default.

Files and edits:
- `reploid/self/tools/self-compiler.js` writes/updates:
  - `blueprint-index.json`
- `reploid/self/runtime.js` and bridge path should:
  - load default context from compact contract set only
  - provide runtime request API for additional blueprints.

Index schema:
- `schemaVersion`
- `generatedAt`
- `entries`: array of
  - `id`
  - `path`
  - `status` (`active` | `lazy` | `archived`)
  - `tags`
  - `requiredAnchors`
  - `sourceDigest`

Loader rules:
- `rgr-runtime-contract.md` and `rgr-slot-topology.md` are always active.
- `0x000112-recursive-gepa-ring.md` loaded on explicit request only.
- Everything else remains lazy/reference until requested by objective + policy.

Acceptance:
- Initial seed context size drops materially.
- All blueprint accesses are logged with request reason and resolver result.

---

### Phase 8 — Legacy architecture archiving

Objective: preserve history without allowing execution path creep.

Actions:
- Move non-production substrate to `reploid/research/` with manifest references:
  - `reploid/self/config/genesis-levels.json` (full legacy version copy)
  - old `core/agent-loop.js`
  - `/0` and `/x` boot material
  - old cognition/tool registries
  - extra UI/style/tooling prebuilds currently relied on by legacy profiles
- Update code comments and docs:
  - annotate these as “research-only” and “do-not-import in live boot path”.

Acceptance:
- Live bootstrap/profile resolution cannot select any archived path unless explicitly debug-mode flag enabled.

---

### Phase 9 — Finalizing live integration contract

Objective: ensure runtime loop and bridge align with new model:

Files and edits:
- `reploid/self/runtime.js`
  - enforce compact context building:
    - `/self/self.json`
    - `/self/prompts/kernel.md`
    - `SELF_BLUEPRINT_PATHS` compact contract
  - explicit cycle:
    1) build/refresh context
    2) model generation
    3) tool execution
    4) shadow mutation staging
    5) verification
    6) promotion candidate if policy passes.
  - add explicit terminal/idle handling for no-op cycles.

- `reploid/self/bridge.js`
  - keep source projection for historical reference, but route all mutation through kernel policy path.
- `reploid/self/host/seed-vfs.js` (if present/used)
  - remove eager loading assumptions that bypass tool restrictions.
- `reploid/self/boot-spec.js`
  - remove references that imply multiple active seed classes.

Acceptance:
- Runtime loop has one policy path and one promotion path.
- No call path bypasses `Promote` for `/self` mutation.

---

## File-Level Change Matrix

### New files
- `reploid/NEXT.md` (this document)
- `reploid/self/rgr-policy.js`
- `reploid/self/tools/promote.js` (or integrate in runner)
- `reploid/self/tools/self-compiler.js`
- `reploid/self/schema/blueprint-index.schema.json`
- `reploid/self/schema/promotion-trace.schema.json`
- `reploid/artifacts/rgr/<cycle-id>/...` (runtime generated)
- `reploid/research/...` archival copies for legacy runtime modules

### Modified files
- `reploid/self/boot-spec.js`
- `reploid/self/config/boot-seed.js`
- `reploid/self/manifest.js`
- `reploid/self/runtime.js`
- `reploid/self/tool-runner.js`
- `reploid/self/bridge.js`
- `reploid/self/config/genesis-levels.json`
- `reploid/self/blueprints` references (metadata updates where needed)
- `reploid/self/prompts/kernel.md` (generated default prompt skeleton)

### Optional but recommended
- `reploid/self/tools/read-file.js`
- `reploid/self/tools/write-file.js`
- `reploid/self/tools/load-module.js`
- `reploid/self/blueprint-runtime-guide.md` if needed for implementer reference

---

## Hard Failure Modes and Mitigations

- **Boot broken after profile pruning**
  - Keep `boot-spec.js` compatibility alias temporarily; require explicit `--legacy` flag.
  - Validate bootstrap dependency closure before removing alias.
- **Model cannot mutate without `Promote`**
  - Ensure all self-edit workflows write to `/shadow` first and are observable in artifacts.
- **Tool path traversal / module injection**
  - Enforce canonical path checks and extension allowlist on `LoadModule`.
  - Reject paths containing `..` or control characters.
- **Promotion race and partial writes**
  - Use two-phase apply: staging + commit marker.
  - Write rollback manifest before mutating active state.
- **Service worker stale cache serving old modules**
  - force module cache invalidation on every successful promotion.
- **Missing anchor evidence**
  - `canPromote()` must return `false` with explicit reason, no partial writes.

---

## Deterministic Data Products

Each migration attempt must emit:
- `/.system/evolution.trace` append entry containing:
  - `cycleId`
  - `candidatePath`
  - `tracePath`
  - `score`
  - `gateResults`
  - `promotionResult`
- `/.system/receipt-chain.jsonl` line item for final accepted promotions
- `artifacts/rgr/attempts/<cycleId>.json` for every cycle, accepted and rejected
- `artifacts/rgr/traces/<cycleId>.json` with immutable trace schema

---

## Evidence and Review Gate

Before moving from one phase to the next, require:
1. Gate artifact for completed phase in `/artifacts/rgr/phase-<n>/`.
2. Diff checklist:
   - which files changed
   - whether runtime path changed
   - whether any legacy route/path remains active
   - policy enforcement evidence
3. Signed rejection/approval reasons:
   - `PASS` only if new boot path is deterministic and non-proliferating.
   - `BLOCK` if `/self` remains directly writable from model context.

---

## Deployment/Iteration Notes

- Keep each phase independently runnable with minimal coupled dependencies.
- Preserve old behavior under explicit `research_mode=true` for debug only.
- Preserve all archive materials, do not delete legacy files until archival copy is complete.
- Add inline migration comments in touched files:
  - `// migration contract`
  - `// legacy path retained for research only`
  - `// do not bypass RGRPolicy`

---

## Immediate next actions after writing this plan

1. Begin Phase 1 and Phase 2 in a single pass:
   - `boot-spec.js`
   - `boot-seed.js`
   - `manifest.js`
2. Create `schema/` + `rgr-policy.js`.
3. Wire `Promote` scaffolding in `tool-runner.js` only (dry-run first).
4. Add `self-compiler` tool and route it behind explicit tool invocation from `/shadow` artifacts.
5. Add archival manifest for legacy paths and lock production boot path.

--- 

## Notes

- This plan intentionally avoids changing Doppler internals.  
- Cross-system integration (reploid <-> doppler) should remain through existing model bridge semantics unless this plan requires a new contract method.
- Where existing code has naming conventions, new files should follow repository style to keep compatibility.
- Every phase should leave the system in a bootable state; avoid “big-bang” changes.
