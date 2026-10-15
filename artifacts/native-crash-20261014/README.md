# Intel native 16 exit: investigation (2026-10-14)

Component: native contributor on `intel-host` (Reploid `server/native-participant.js`, Dawn
`webgpu` 0.4.0, Mesa 24.2.8 ANV on Intel Gen12LP). Intent preserved; no code changed here.

During run 7, contribution attempt j on `final-9`, `scj-run7-intel-native-16` (stage 1)
exited mid-answer at 18:15:22Z. The conversation correctly ended `CONNECTION_LOST` 15 s
later
([settlement record](../signed-completion-journey-20261013/run-7/settlement/scj-run7-intel-native-16-exit.json)).
That record's last log line, a cancelled peer-identity check, is **not** the cause.

## Established

- **The process died of SIGSEGV (signal 11) at 18:15:21.56Z.** Ubuntu's crash handler
  logged `called for global pid 1576952, signal 11` with the native's command line. It saved
  no report or core, because node had crashed within the previous 24 hours ("this
  executable already crashed 2 times, ignoring").
- **Not the identity check.** `Native participant identity verification failed ... This
  operation was aborted` appears five times in the same log, the earliest minutes before the
  exit, and the process kept serving after each one. The status line every ~10 s continued
  up to the exit, and the log ends on a complete JSON line. The process died between two
  writes, with no JavaScript error, unhandled rejection or shutdown output. A SIGTERM
  shutdown, as of native 17 at 18:21:27Z, logs `partition-state idle` and `[GPU] Device lost:
  device was destroyed`, and systemd records "Sending signal SIGTERM".
- **Not a stop, memory, runtime or GPU event.** The scope ended with only "Consumed 6min
  31.933s CPU time, 365.2M memory peak": no systemd stop, no OOM, and the runtime cap was 45
  min. No ssh session was open at that instant, and the harness never stops natives. The
  i915 hang/reset count stayed at 54. The user timer that started 6 ms later normally fires at
  :24 s past the quarter-hour, so it fired 1.4 s early. That is systemd coalescing a timer into
  the wake-up for the exit, not a cause of it.
- **The amd-host native in the same route kept running** until the harness stopped it with
  SIGTERM at 18:19:38Z.

## The only node crash on this host with a core

`intel-host` recorded three node SIGSEGVs in two days. All three were node with the Dawn
module on Intel Vulkan:
- 2026-10-13 15:17Z, a Doppler control script;
- 2026-10-13 18:43Z, the `reploid-recurrent-memory` probe, the only one with a saved core;
- the native above.

With the matching Mesa debug symbols (`mesa-vulkan-drivers-dbgsym 24.2.8-1ubuntu1~24.04.1`,
build id `92a11138...`), the probe's core resolves to
[oct13-crash-stack.txt](oct13-crash-stack.txt):

```
read_load_const            src/compiler/nir/nir_serialize.c:1258   (lc = 0x0)
read_instr / read_block / read_cf_list / read_if ...   (nested ifs)
vk_pipeline_cache_lookup_nir
anv_pipeline_stage_get_nir
anv_pipeline_compile_cs / anv_compute_pipeline_create / anv_CreateComputePipelines
dawn::native::vulkan::ComputePipeline::InitializeImpl   (CreateComputePipelineAsync task)
```

Mesa's Intel driver was reloading a shader's cached NIR (its intermediate form) from the disk
cache during compute pipeline creation, and the NIR deserializer dereferenced a null
instruction. Before that, the probe had created only its shader module.

**Replay, 5 of 5.** [replay-pipeline-probe.js](replay-pipeline-probe.js) repeats that
probe's pipeline creation: the same Dawn build `fbfe5990...`, shader `d057940f...`, `auto`
layout and limits, with no dispatch. It ran against a private copy of the shared Mesa cache
(`MESA_SHADER_CACHE_DIR`; the shared cache was not changed) in bounded scopes. Every run
crashed with exit 139 at pipeline creation, 65-101 ms after start. The i915 count stayed at 54.

**Cold compile, then reload: Mesa poisons its own cache.** The same pipeline was compiled into an empty private cache under the standard bounded scope (10 GiB soft, 12 GiB hard, no swap, 1,200 s). It sat at about 10.2 GiB, throttled at the soft limit (no OOM), and had not finished when the runtime cap ended it (exit 143). Two reload runs against that same cache, which nothing else had written, both crashed at pipeline creation within 0.1 s (exit 139). The i915 count stayed at 54.

ANV stores a shader's NIR in the cache before its backend compile, and the compiled binary only after the compile finishes. A compile that is stopped partway leaves NIR without a binary. Every later process that needs that pipeline then takes the NIR-reload path and dies in `read_load_const`. This needs no disk corruption and no concurrent writer. Campaigns routinely stop natives with SIGTERM or runtime caps, and this one shader's cold compile on Intel did not finish within 20 minutes at 10 GiB, so interrupted compiles are an ordinary event here.

## What this does and does not show

- **Shown:** on this host (Mesa 24.2.8 ANV), an interrupted compile leaves a cache entry that
  crashes node deterministically on reload, and the shared cache already holds one such entry. Doppler creates pipelines lazily, on first use
  of each kernel variant (`src/gpu/kernels/pipeline-cache.js`), and only the paired recurrent
  pipelines are prepared before readiness (Doppler `0ac64fa2`). So a native can still be
  creating pipelines while it is serving.
- **Not shown: native 16's own crash site.** No core exists, so whether it hit a poisoned entry for
  one of its own pipelines is a hypothesis. Contribution reruns h, i and l
  sent the same stop-step prompt to Intel natives without crashing, so if a cached pipeline
  was involved, it was not one that every such run needs.

## Next steps

1. **Capture the next crash.** Native launchers should set `ulimit -c unlimited`, so the crash
   handler keeps a core even when it skips its report. The current launchers inherit core limit
   0.
2. **Fail before serving, not mid-answer.** Create every pipeline a stage's plan can request
   before the stage reports ready. This extends `0ac64fa2` from the recurrent pipelines to the
   whole program. Any pipeline-creation crash then becomes a startup failure that placement
   avoids, instead of a lost answer. It also enumerates the stage's pipelines against the
   current cache, which tests whether any of them is affected.
3. **Driver.** Ubuntu 24.04 now ships `mesa-vulkan-drivers` 25.2.8-0ubuntu0.24.04.4; this host
   runs 24.2.8. An upgrade needs administrator access on the host and requalification of the
   Intel stage, because a compiler change can change results.
4. **Placement.** The same host is also the prefill bottleneck: Doppler
   `artifacts/paired-matmul-prefill-cost-20261014` measures the paired matmul about 20x slower
   than on `amd-host`. Routes without the Intel stage avoid both problems, and need their own
   partition qualification.

Retained on `intel-host` under `/var/tmp/native-crash-analysis-20261014/`: the unpacked Oct 13
report and core, the debug files, the symbolized stack, the replay events and both private
caches.

## Audit of the shared cache with full pipeline preparation (2026-10-14, 21:03Z)

Doppler `9830aaec` creates every pipeline a paired resident stage can request before the stage
reports ready. [cache-audit.mjs](cache-audit.mjs) ran that source on `intel-host`, opening the
three deployed paired stages (installed final-9 catalog, Capsule runtime config) with no token
executed. It used a private copy of the shared Mesa cache, taken at 20:55Z, in a bounded scope
with core dumps enabled.

**Result: all three stages opened.** They prepared 22, 20 and 22 pipelines, 24 distinct, with no
lazy remainder, in 277 ms, 0.3 ms and 15 ms. Those times mean cache hits; within one process,
later stages reuse pipelines already created. There was no crash, and the i915 count stayed at
54 ([cache-audit-20261014.json](cache-audit-20261014.json)).

So the shared cache holds no crashing entry for any pipeline the deployed paired stages use. This
does not explain native 16's crash, which left no core. Either no such entry existed at 18:15Z,
or one existed and is gone, or the crash happened outside pipeline creation. With full
preparation, an entry like the reproduced one would now stop a stage at startup instead of
mid-answer.

## Sealed shader cache and stopped verification (2026-10-15)

The native participant now compiles into a private staging cache and promotes it to a sealed cache,
keyed by runtime, provider, driver and program identity, only after complete stage preparation. A
start never inherits a staging directory left by an exited process. Verification on `intel-host`
stopped after its first step: the final-10 stage 1 cold preparation reached the 10 GiB soft limit
with 3 of 21 pipelines prepared, and systemd-oomd killed it together with other user-manager
workloads, including the public browser contributor. See
[intel-reliability-20261015](../intel-reliability-20261015/README.md). Native 16's crash site
remains unconfirmed.
