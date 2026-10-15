# Intel reliability: sealed shader cache, and a stopped verification (2026-10-15)

Component: native participant GPU startup (Reploid `server/native-participant.js`,
`server/native-shader-cache.js`). Intent preserved. Boundary effects: a new Linux-only startup
step for `--contribute` (`--shader-cache-root`, `shader-cache` status lines); no Doppler change.
Machines are `mac-host` and `intel-host`; `amd-host` was not used.

Follows [native-crash-20261014](../native-crash-20261014/README.md): Mesa ANV 24.2.8 stores a
shader's NIR before its binary, so an interrupted compile leaves an entry that crashes every later
process that reloads it.

## The fix: a sealed Mesa shader cache

[server/native-shader-cache.js](../../server/native-shader-cache.js), bound in
`server/native-participant.js` `main()` for `--contribute` on Linux before any native module loads,
so `MESA_SHADER_CACHE_DIR` is set before the Vulkan driver initializes.

- **Identity key.** SHA-256 of the canonical JSON of:
  - the installed Doppler runtime: name, version, pinned archive integrity
    (`self/config/doppler-package.json`) and a digest of every installed file;
  - the WebGPU provider module: name, version and a digest of every installed file;
  - the Vulkan driver: every ICD manifest the loader would search, honoring `VK_DRIVER_FILES`,
    `VK_ICD_FILENAMES` and `VK_ADD_DRIVER_FILES`, each manifest's and library's SHA-256; the
    render devices (`/sys/class/drm/renderD*` vendor, device, revision, kernel driver); and every
    `MESA_`/`INTEL_`/`ANV_`/`RADV_`/`ACO_`/`NIR_`/`LP_`/`GALLIUM_`/`VK_` variable;
  - the program: catalog model id and manifest identity, the Capsule semantic root, digests of the
    whole catalog entry and the partition policy, the ordered stage index (null when automatic) and
    the canonical flag.
- **Layout.** Under `<root>/v1/` (the default root is `shader-cache` beside the identity file):
  - `sealed/<key>/` holds `seal.json` (identity, program, every file's size and SHA-256) and
    `cache/`; it is read-only;
  - `sessions/<boot>-<pid>-<start ticks>-<nonce>/cache` is one process's working cache.
- **Cold start.** Without a sealed cache, the process compiles into its own new staging session.
- **Sealing.** After the stage reports `pipelinePreparation.complete` with at least one
  pipeline, the protocol waits for quiescence: Mesa's `disk$` writer threads idle and the
  directory unchanged, for 4 samples 250 ms apart, within 120 s. It then:
  1. copies and hashes a snapshot;
  2. checks again that nothing changed during the copy, and retakes the snapshot if anything did;
  3. writes `seal.json`, makes the snapshot read-only and `fsync`s it;
  4. renames it to `sealed/<key>`. The rename is atomic, and a concurrent seal of the same key
     reports `already-sealed`.

  The process keeps its own staging directory: Mesa holds open handles there, so renaming the live
  directory would let it keep writing into the sealed cache.
- **Warm start.** Each file is verified against `seal.json` while it is copied into a private
  session. Mesa only ever gets that copy; Mesa-DB updates its index even on cache hits. On a failed
  verification, the seal is moved aside and removed, and the start compiles cold.
- **Interruption.** Every start removes sessions and `.promote-*` directories whose owner is gone
  (`/proc/<pid>/stat` start time or boot id differs). A killed, crashed or capped preparation is
  therefore never inherited.
- **Fails fast.** Startup stops with an actionable message on any of:
  - `MESA_SHADER_CACHE_DIR` or `MESA_SHADER_CACHE_DISABLE` already set;
  - a relative or unwritable root;
  - a non-Linux host given `--shader-cache-root`;
  - unreadable `/proc` identity.

  A driver that writes nothing, or a process with no `disk$` writer threads, is refused sealing and
  the refusal is reported.
- **Not changed.** A cold start still compiles every pipeline. The protocol prevents inheritance;
  it does not lower compile time or memory.

Acceptance (no GPU): `npx vitest run --config tests/vitest.config.js tests/unit/native-shader-cache.test.js`
covers 20 tests:
- staging and promotion;
- refusal while writers are busy, the directory changes, the driver ignores it, or preparation is
  incomplete;
- snapshot retake after a write during the copy;
- concurrent seals and cancellation on close;
- discard of an exited owner's staging and promotion, including pid reuse and another boot;
- a warm private copy;
- rejection of changed, extra or unrecorded sealed files;
- identity keying across runtime, provider, driver, device, environment, model, stage and policy;
- the misconfiguration errors.

`tests/unit/work-partitions-lifecycle.test.js` checks that `openNativePartition` offers the seal
only the readiness-time `pipelinePreparation`, and nothing when opening fails.

## intel-host verification: stopped after the first step

**Setup** (under `/var/tmp/intel-reliability-20261015/`):
- **Runtime:** final-10, archive `3b132ee7`, whose SHA-512 equals the final-10 pin's integrity
  `sha512-wNR6Lbpi...`; 1,999 files.
- **Provider:** `webgpu` 0.4.0, the copy the deployed natives use.
- **Catalog and policy:** final-10's installed catalog and partition policy.
- **Model:** manifest `548e6559` copied from mac-host. Its 18 shards are identical to the Capsule
  model `6b2cb026` already on the host and are hard-linked from there.
- **Stage and tools:** stage 1 (layers 8-15). [stage-probe.mjs](stage-probe.mjs) opens the stage
  through Doppler's public resident-stage API and calls the protocol exactly as the native
  participant does. [run-scope.sh](run-scope.sh) runs each step in a user scope (MemoryHigh 10 GiB,
  MemoryMax 12 GiB, no swap, runtime cap, `ulimit -c unlimited`) and reads the i915 count before
  and after. The baseline was 54.

**(a) Cold start into an empty root** ([evidence/a-cold.stdout.txt](evidence/a-cold.stdout.txt),
[a-cold.json](evidence/a-cold.json), [runner](evidence/a-cold.runner.json)):

| t (s) | Event |
|---|---|
| 0.4 | Bound: mode `cold`, key `851a1a96...`. The identity took 383 ms. |
| 0.9 | Device: `Intel open-source Mesa driver: Mesa 24.2.8-1ubuntu1~24.04.1`, gen-12lp |
| 1.7 | Stage weights loaded (89.6 MB) |
| 216.5 | `Model loaded` (215.6 s after the weights; the load phase that took this time was not captured) |
| 216.5 to 268.1 | `rmsnorm_paired_sliced` compiled: 51.6 s |
| 268.1 to 272.8 | the two `matmul_paired_compensated` programs: about 2 s each |
| 272.8 | `gated_delta_conv_paired` started: pipeline 4 of 21 |
| 402.7 | **systemd-oomd killed the scope** (exit 137). The scope was at 10.2G, its own memory-pressure Avg10 was 52.48%, and the user manager's pressure was 64.04% (above oomd's 50% limit for more than 20 s) |

The i915 count stayed at 54. No core was written, because SIGKILL produces none.

**Collateral: oomd killed other units in the same user manager**
([evidence/oomd-20261015T135848Z.txt](evidence/oomd-20261015T135848Z.txt)). oomd ranks candidates
by reclaim activity, so before my scope it killed:
- two `tmux-spawn-*` scopes (5.6G and 1.2G);
- `zero-supervisor.service` (restarted automatically);
- `app-org.chromium.Chromium-299780.scope`;
- `appimagelauncherd.service` (restarted).

After the kill, the public browser contributor (pid 299769, `scripts/run-mesh-contributor.js`)
was no longer running. The public native contributor 297260 runs in `session-14051.scope`,
outside the user manager, and kept running. I did not restart, signal or inspect either one. All
GPU work stopped here.

**After the kill, CPU only** ([evidence/a-bind-after-oomd.stdout.txt](evidence/a-bind-after-oomd.stdout.txt),
[json](evidence/a-bind-after-oomd.json)). A binding with the same identity, without loading the
provider:
- derived the same key `851a1a96...`;
- discarded the killed staging session `943c81e7db3a-1893692-...` ("owner process exited before
  sealing");
- chose `cold` and left no session or seal behind.

A copy of that interrupted staging (7.1 MB of Mesa-DB) is retained on intel-host at
`evidence/a-cold-interrupted-session/` for a later control reload.

**Not run:**
- (a)'s seal;
- (b) SIGTERM and SIGKILL mid-preparation restarts, with control reloads of the interrupted copies;
- (c) the warm start;
- task 3's execution soak. The configs were written but no soak budget was declared or started.

## What this shows and does not show

- **Shown on intel-host:**
  - the binding;
  - deterministic keying, with the same key on both starts;
  - discard of a staging directory left by a killed preparation. The kill came from oomd, not the
    planned signal.
- **Shown:** final-10 stage 1 cannot be cold-prepared on this host within the standard bound. After
  6.7 minutes, 3 of its 21 pipelines were prepared and the process was at the 10 GiB soft limit.
  This applies with or without the protocol: any cold Intel start of this program compiles the same
  shaders. (The rolled state program alone took 38.6 s and +1.47 GiB in
  [intel-compile](../faster-candidate-20261015/intel-compile/README.md); the whole stage had not
  been measured.)
- **Shown:** on this host, a user scope's MemoryHigh bounds its own memory but not the effect of
  its throttling. The resulting pressure is counted for the whole `user@1000.service`, where oomd
  (`ManagedOOMMemoryPressure=kill`, 50%) kills unrelated workloads.
- **Not shown:**
  - sealing or a warm start on hardware;
  - that a SIGTERM or SIGKILL restart prepares cleanly;
  - whether this program's interrupted entries crash on reload.

  Native 16's crash site remains unconfirmed: no core exists and no soak ran.

## Open decisions

1. **The stopped public browser contributor (299769)** is the owner's to restart. I did not touch
   it.
2. **How to run cold compiles on intel-host without oomd killing other work.** The incident shows
   failed containment, so another attempt needs verified isolation, not larger or different memory
   limits. Raising or dropping MemoryHigh, or relaxing oomd alone, is not evidence of isolation.
   Before any further GPU step, a non-GPU memory-pressure probe at the cold-compile footprint
   (more than 10 GiB for over 400 s) must show that the other user-session units (tmux sessions,
   `zero-supervisor`, the public contributors) keep running and their pressure stays below oomd's
   limit. Candidate mechanisms, each needing the owner's choice and administrator access where noted:
   - run GPU steps outside `user@1000.service`, in a system slice with its own memory budget (sudo);
   - protect the other units (`MemoryMin`/`MemoryLow`, `ManagedOOMPreference=avoid`) and confirm
     oomd then selects only the experiment (admin for system-wide oomd policy);
   - schedule the step when the owner has paused the other workloads.
   The incident's disruption and recovery belong in the cost record
   (Flash-Next register (moved to the private economics evidence)).
3. **Mesa upgrade.** Ubuntu 24.04 ships `mesa-vulkan-drivers` 25.2.8-0ubuntu0.24.04.4. Installing
   it needs administrator access (`apt`) and requalification of the Intel stage, numerically and
   for compile cost. A compiler change can change both the crash and the cold-compile footprint
   measured here. Not done.
4. **A protocol trade-off made visible.** A host whose cold preparation never finishes in one
   process makes no progress across restarts, because each restart discards the staging. Mesa's
   shared cache keeps completed binaries, but also the poisoned NIR. Two options:
   - keep this behavior: the host fails visibly and Intel stays unsupported;
   - seal once in a separate, explicitly bounded preparation run before contribution.
