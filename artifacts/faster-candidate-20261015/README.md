# Faster candidate: frozen, qualified and installed on placement C (2026-10-15)

Component: Launch 1 candidate delivery and qualification (Reploid release integration; Doppler runtime and
Capsule). Intent preserved. Boundary effects: test-signed release history advances to sequence 9; new
isolated exports, installs, scopes and evidence. The accepted public package (Doppler 0.6.27), public
catalogs and production signing are untouched. Nothing here is public promotion. Machines are `mac-host`,
`amd-host` and `intel-host`.

**Goal.** Reach a faster, correct installed conversation with independently acceptable answers. One
improved package is frozen and qualified. AMD replacement capacity serves the Intel layers, so the route
does not pass through Intel.

## Identity

- **Runtime archive:** `3b132ee7ff984c80ef48487d3010028ade46b64d39323304d674feebfde3bf78`, 1,999 files.
  - It is Doppler `77c5d9b2`: `1c9ec3db` plus the rolled sliced state program as a declared alternative.
  - Packed by `git archive`, then `npm pack --ignore-scripts`. The same method reproduces `2df37d88` and
    `21d054ee`.
- **Kernel configuration:** the combined paired kernels, all five replacements selected through the
  execution graph, with `prefillTokenChunkSize` 16.
  - **Recurrent state: the rolled sliced program**, chosen from full-model measurements
    ([variant-choice](variant-choice/README.md)).
  - **Q/K head norms:** the shipped `rmsnorm_paired` program, now declared (see "Open failures and defects
    found").
  - **Manifest-declared digests** (`execution.kernels`):

    | Program | Shader | Digest |
    |---|---|---|
    | attention | `attention_paired_tiled.wgsl` | `sha256:70a0a584...` |
    | norm | `rmsnorm_paired_sliced.wgsl` | `sha256:92760258...` |
    | projection_q4 / projection_f16 / head | `matmul_paired_compensated.wgsl` | `sha256:0b669911...` |
    | paired_state_sliced_rolled | `gated_delta_state_paired_sliced_rolled.wgsl` | `sha256:66ead303...` |
    | paired_qk_parallel | `gated_delta_qk_paired_parallel.wgsl` | `sha256:75b6c97c...` |
    | paired_qk_head_norm | `rmsnorm_paired.wgsl` | `sha256:c0268aa0...` |

  - The execution identity of every stage is `sha256:b2fbcbfe...`, the same on all three stages.
- **Model manifest:** `548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db`. It is the
  Capsule manifest `6b2cb026` with only declared execution kernels changed. Weights and tokenizer are
  unchanged.
- **Capsule** (Doppler `artifacts/faster-candidate-20261015`, commit `141d5c11`):
  - semantic root `sha256:b1527013b75971d9a301a71672cbccaa45ee59e87438c86fe52923ff51ad2de9`;
  - envelope `759f5ab1...`;
  - 67 artifacts;
  - bound to the placement C reports, attempt `c8`.
- **Release:** sequence 9, `sha256:dd83799625519d431d5e1f5c9b04b06bce0a0091ece922891d7d965a906c55bf`,
  expiring 2026-10-16T04:35:38Z, test authority.
  - The chain runs 1-6 (renewal 6, `b19052d5`), then 7 (`2486b1e7`, Capsule 1), 8 (`0b40731c`, Capsule 2)
    and 9.
  - `verifyCapsule` admits it from checkpoints 8, 7, 6, 5 and 0 with the candidate runtime, and from 8, 7,
    6 and 5 with the final-9 runtime.
  - The installed amd-host states and the mac-host stage 0 profile opened it from held checkpoint 8.
- **Installed delivery: final-10 pass 3** ([final-10](final-10/README.md)):
  - Reploid `5610260a` (main when frozen; includes `1f95f0b1` and `abf8973f`, with no ledger wiring);
  - prepared catalog `8d7e5b94...`, minimum sequence 9;
  - browser bundle `sha256:da29387c...`;
  - native tarball `f822a36e...`, descriptor `a2ee0c63...`;
  - installed on amd-host ([install-10](install-10/README.md)).

## Correctness

**The gate: 55/55 within the unchanged 0.001,** against approved F64 reference `ad26dfbc` (evaluator
`90376dde`). Every one of the 248,320 logits is within tolerance, every token matches, and the maximum
error is 9.520e-07, the shipped package's own. It holds on every GPU that serves a stage and on the
placement:

- **Whole model on the Mac browser** (Chrome 155, Metal) and **on amd-host native** (Node/Dawn, Vulkan),
  for all three manifest generations. See [numerical](numerical/README.md) and [variant-choice](variant-choice/README.md).
- **Placement C, 55 physical prefixes** (`c8`): requests 8.40e-07, 8.90e-07 and 9.52e-07, and three
  partition reports `passed`. Closes took 3.4, 2.7 and 2.7 s against 10 s. The earlier failed and refused
  attempts are kept ([placement-c](placement-c/README.md)).

**K/V identity, reported separately:** 12/12 full-attention F16 cache identities equal the approved
identities on both GPUs. No stored value differs from the installed package's (0 of 1,437,696).

## Performance

**Whole model, same GPU, frozen candidate against the unchanged controls** (one process per configuration):

| | amd-host native: control 0.6.28 → candidate | Mac Chrome/Metal: control → candidate |
|---|---|---|
| 56-token prompt | 17.04 → 8.21 s | 40.80 → 26.60 s |
| 184-token prompt | 56.82 → 26.43 s | 138.85 → 86.90 s |
| Decode per token | 570.4 → 286.5 ms | 1,299 → 732.5 ms |
| GPU pool peak | 1,002,913,536 (unchanged) | |

**Pipeline preparation,** through the real `maxPreparationMs` (1,200,000) path:

- **Installed amd-host stages**, both together, cold, with a new private Mesa cache: 90.7 s and 89.1 s
  (the unrolled variant took 103.5 and 103.0 s). Warm, after a restore: 0.15 s.
- **Load-only openings:** amd cold 97 s (rolled) against 111 s (unrolled); warm 0.2 s. On the Mac, Chrome
  pipeline creation took under 0.1 s, cold and warm, with the stage opening at about 5 s.

**Memory** (see Placement): the device allocation peaks are unchanged; the transient compiler heap is
large.

**Installed complete-answer latency** on placement C, from the application's own timing records with the
same journey prompts as final-9. The final-9 placement B column is **historical** (run 7; not rerun).

| Turn | Final-9 B | **final-10 C** |
|---|---|---|
| 56-token prompt, 100 tokens: complete answer | 326.1 s | **147.8 s** (attempt b: 116.1 s) |
| Time to first token | 75.8 s | **19.3 s** |
| Decode per token (sum of stages) | 2.49 s | **1.26 s** (b: 0.96 s) |
| Per-stage prompt (Mac / stage 1 / stage 2) | 13.9 / 55.2 / 6.2 s | 9.1 / 5.7 / 3.8 s |
| Per-stage decode | 404 / 1,659 / 430 ms | 221 / 624 / 417 ms (execution 208 / 88 / 137) |
| 189-token follow-up: complete answer (time to first token) | 291.3 s (262.2) | **72.5 s (60.2)** |
| Longest answer, 171 tokens | 440.9 s | **227.6 s** |

- **Network share:** most of the remaining AMD time per token is transfer and waiting through the mac-host
  coordinator. It rose with mac-host to amd-host round-trip spikes during attempt c (median 21 ms,
  90th percentile 160 ms) against attempt b (median 15 ms). See [journeys](journeys/README.md).
- **Transfer and publication** are not separable in the timing record. Stage elapsed minus execution
  bounds them from above, and that bound is shown per stage.

**Supported context: 1,588 prompt tokens, measured** ([context](context/README.md)).

- The slowest stage (the Mac) took 263.6 s against the unchanged 300 s stage bound. The fit reaches 300 s
  near 1,800 tokens; that is not run and not claimed.
- Time to first token at 1,588 tokens is 455 s. Under the 900 s answer deadline, that leaves about 440 s
  for the answer.

**The 1,588-token concurrency workload does not complete.** Two concurrent requesters both reached the
unchanged 900 s answer deadline ("Response timed out") with about 640 characters streamed. Their first
tokens came at 453 s and 721 s; same-stage execution serializes the two Mac prefills. No stage call
exceeded 300 s. With short answers, two concurrent 1,588-token prompts both complete, in 723 s. The
workload's long answers need more than the deadline leaves, so the largest workload size that completes
was not found.

## Application (installed journeys, final-10 pass 3, run 8 attempt c)

| Journey | Result |
|---|---|
| Requester | **13/13**: complete answers with EOS; follow-up; durable transactional history and reload (`reploid-requester-history`, chained publications, restored after reload); two concurrent independent requesters; isolated cancellation; explicit retry; Copy; selective acquisition with 0 weight requests; cleanup settled on every stage |
| Contributor loss | **7/7**: output-head stage SIGKILLed; "A computer disconnected. Retry this answer." after 17.3 s; ownership left unknown, not settled; capacity back 6.4 s after the restore; the retry generated 111 tokens |
| Bounded contribution | **7/7**, rerun after REP-12's custody change |
| Full-model seeding | **7/7**, rerun after REP-12: refused below the 1,103 MiB allowance; resource scope shown before approval; mac-host seeded the whole model (1,156,260,602 bytes, charged exactly); the amd-host browser acquired every file from the seeder in 14 min 47 s with 0 origin requests; reload rebuilt the whole inventory from cache; a bounded grant did not become seeding; Stop settled an in-flight seed without cancelling the conversation |

Attempt b (pass 2, unrolled) passed requester 13/13, loss 7/7 and contribution 7/7. Attempt a (pass 1)
failed bring-up. Every report is in `journeys/reports/`.

## Placement: AMD capacity for the additional layers

Two amd-host native stages served layers 8-23 together with the output head, replacing the Intel layers,
inside per-executor ceilings. Measured with [journeys/tools/amd-sampler.py](journeys/tools/amd-sampler.py)
(both scopes, every 2 s) and the qualification sampler:

| Condition | Both natives: combined scope memory | GTT (GPU memory, unified APU) | Host MemAvailable (min) |
|---|---|---|---|
| Qualification capture, warm-prepared natives | 1.48 GB (peaks 0.79 / 0.77 GB) | 2.54 GB | 48.5 GB |
| Installed journeys including two concurrent conversations, both natives cold-prepared | **13.64 GB** (7.28 / 6.39 GB) | 2.57 GB | 41.1 GB of 128.8 GB |
| Two concurrent 1,588-token prompts (stage 1 cold-prepared, stage 2 warm) | 8.51 GB (7.58 / 0.97 GB) | 2.62 GB | 45.4 GB |

- **Device ledgers:** stage 1 peaks at 125,659,504 bytes and stage 2 at 271,700,368, against
  1,420,000,000 each.
- **Cold preparation's cost:** Mesa's compiler heap (5.6-6.7 GB anonymous per native) is kept after a cold
  preparation. A warm-prepared native stays under 1 GB.
- **Contention** (two conversations, one GPU): stage execution per token was 119 / 145 ms against 88 /
  137 ms alone. Same-stage execution is serialized, so a long prefill delays the other conversation's
  decode on that stage.

Intel is not on the route. Its unrolled state program did not compile cold within 30 minutes, while the
rolled one took 38.6 s ([intel-compile](intel-compile/README.md)). Placement B was not run.

## Open failures and defects found

- **Q/K head-norm closure (Doppler).** Replacing the `norm` step's program removed `rmsnorm_paired.wgsl`
  from the signed closure, but the runtime still runs it for Q/K head norms outside the graph's steps. The
  manifest now declares it. `build.js` now refuses a Capsule whose closure misses any pipeline a captured
  stage prepared.
  - The underlying gap remains open: the runtime selects a program the graph does not declare. The root
    fix, a declared Q/K-norm step, is a Doppler change not made here.
- **Symlinked model directories** are refused by the native participant. The installs now use hard links.
- **Placement C captures under network load.** Attempts c2, c4, c5 and c6 failed on supervisor or owner
  deadlines and on the 10 s cleanup limit during mac-host to amd-host round-trip spikes of 0.5-1.5 s. c8
  passed with the controller co-located with the natives.
- **The 1,588-token workload does not complete within the 900 s answer deadline** (above).
- **Answers:** the two wrong example outputs and independent whole-answer review are unchanged and open.
- **Production signing** gates public promotion.
- **Process slips:** final-10 pass 3 was staged before its corrected preflight. The holder-count regex
  stopped the first run with all cases as expected. Generation 3's build binding mislabels its verifying
  runtime as `21d054ee`; the runtime path shows `3b132ee7`.

## Settlement (2026-10-15, after the run)

- **Release checkpoints after the run** ([journeys/settlement](journeys/settlement/)): both amd-host native
  states and the mac-host stage 0 profile hold sequence 9 (`dd837996`). intel-host was not on the route and
  still holds 5.
- **Stopped:**
  - stage 0 settled idle (`c-stage0-stop.json`) before its browser closed;
  - the last two natives reached their 2-hour scope caps idle, with 0 unsettled owners, and unloaded;
  - every owned browser, app server, tunnel and sampler on mac-host was stopped;
  - failed `fc-*` units on amd-host were reset.
- **Nothing owned remains:** no `fc-*` units on amd-host or intel-host, and no owned listening ports
  (29670-29674, 29850-29851, 29990-29999) on mac-host or amd-host.
- **GPU error counts are unchanged:** amdgpu 50 and i915 54. The i915 guard was released after the Intel
  compile measurement.
- **Public contributors** amd-host 4103868 and 4121371 and intel-host 297260 and 299769 were present and
  untouched.
- **Logs:**
  - amd-host native and acquirer logs, gzipped, are in `journeys/logs/amd-host/`;
  - the final amd sampler is `journeys/logs/amd-sampler-c.jsonl`;
  - the mac-host app-server request logs are `journeys/logs/mac-app-server-*`.

  None contains a machine address, a login or the room token.
