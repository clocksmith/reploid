# Local-tab split-chat checkpoint

The user selected separate local browser tabs for the current phase. This
checkpoint does not deliver a distributed model answer. No deployment or npm
publication was performed.

## Implemented

- Doppler exposes allocation/frame contracts through `doppler-gpu/partitions`.
  The Capsule root stays minimal. Reploid's 20 runner tests previously failed
  against the installed package; they now pass against the installed archive.
- Doppler's loader validates model-bound allocations, snapshots placement before
  asynchronous work, materializes assigned decoder layers at original indices,
  loads required endpoints (including shared tied embeddings), and suppresses
  prefetch outside the allocation. Layer progress counts assigned layers.
- Load coordination is extracted into a strictly checked module. Preflight and
  materialization failures clean up owned state; immutable plan internals and
  declaration checks protect placement.
- Reploid installs and serves the same candidate contract bytes. Vendoring
  replaces the complete generated tree, removes stale modules, rejects altered
  archives, and generates package metadata from the lock. Clean installed-package
  imports and types pass.

Candidate: `0.6.3-dev.split.1`

Archive integrity: `sha512-gKMWz8nMrevyZCA/dn0ckcA80HzXUVpMTpgJIclfGUxUgLWtKETdehS9ofC5OByx5ljf+/SxogF42aV3OIQ/3Q==`

The partition browser URL is explicit in `DOPPLER_PARTITIONS_MODULE_URL`.
Whole-model browser inference retains its qualified 0.6.2 runtime. Installing a
partition candidate does not requalify Poolday models or replace their runtime.

## Evidence

- [74 focused Reploid tests](unit.json): coordination, replay, cancellation,
  chat, resident providers, runtime configuration and archive delivery.
- [4 browser tests](browser.json): independent imports in two local tabs,
  inert mesh import, and Verification Worker acceptance/rejection boundaries.
  These tests do not execute GPU inference or partition WebRTC transfers.
- [6 Doppler focused files](doppler-focused.log): materialization ports and
  cleanup, existing loader lifecycle, partition contracts and public exports.
  Injected materialization is not physical partial-weight residency proof.
- [Clean package smoke](doppler-package.log): 31 public exports/types and
  installed synthetic consumer checks. Synthetic compute is labeled in the log.
- Reploid types, layers, 39 charters and ESLint pass. Registry reports
  [zero unresolved issues](registry.log). Six generated inventories were
  byte-identical after a second generator run.
- Doppler strict source types, source architecture/style and package closure pass.
- Chrome hardware availability was probed separately: Vulkan exposes Intel
  `gen-12lp`, `isFallbackAdapter=false`, with shader-f16. The default launch
  instead selected SwiftShader. Neither probe establishes model execution.

A broader Doppler sweep initially failed 9 of 869 files. After restoring a
version alias, completing the loader fixture and installing declared test
prerequisites, 8 failed files passed on rerun. The remaining RoPE numerical
failure reproduces on the unmodified original commit `8f4742bd` with the same
Intel GPU and dependencies; see [baseline reproduction](baseline-rope-failure.log).
The assertion was not weakened. This checkpoint does not claim a green full suite.

## Remaining defining work

1. Executable resident partition sessions, independent per-attempt generation
   state, explicit supported dependency closure and GPU residency measurements.
   Current artifact verification can still read shared shards containing other
   partitions. Selected materialization does not establish selective acquisition.
2. Authenticated bounded binary WebRTC activation/token transfer and actual host
   grant verification, wired into existing conversations.
3. Real streamed two-tab answers, exact unsplit-model numerical comparison,
   concurrent conversations, cancellation, revocation and peer-loss settlement.
4. Physical cross-device and capacity-pooling qualification remain separate from
   the user's current local-tab phase.

Component: Doppler allocation loading and Reploid partition delivery.
Intent: preserved; current acceptance environment deliberately changed to local tabs.
Acceptance evidence: linked records and tests named above.
Boundary effects: explicit Doppler partition export, typed loader allocation,
Reploid candidate pin and generated assets. Runtime execution/permission
boundaries and whole-model qualification remain unchanged.

Workflow: direct main; pull integrated Doppler `3da88feb` and Reploid `379ecf0a`.
The generated Doppler closure conflict was regenerated from combined source.
