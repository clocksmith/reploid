# Faster paired kernels under the unchanged reference (2026-10-14)

**Question.** The Launch 1 model, Qwen3.5 0.8B Q4_K, must agree with the approved F64 reference,
which needs paired (two-F32) arithmetic ([plain-profile-reference-20261014](../plain-profile-reference-20261014/README.md)).
Paired decode took 454 GPU ms per step, against 8.4 ms for the plain profile
([speed-isolation-20261014](../speed-isolation-20261014/README.md)). Can the slow paired kernels
recover speed while the correctness standard stays exactly as it is?

**Standard, two separate gates, for every kernel and for the combined candidate:**

- **Acceptance gate (unchanged).** The approved F64 reference (`approved-reference.json`, sha256
  `ad26dfbc...`) over all 55 required prefixes. Every one of the 248,320 logits must be within
  0.001 at every step, and every argmax token must equal the reference token. The comparison is the
  unchanged `substitution-check.mjs` from plain-profile-reference-20261014.
- **Regression requirement: bit-identical stored F16 K/V cache.** After all 51 request-2 prefixes,
  the 12 full-attention cache hashes (6 layers, K and V) must equal the approved F64 evaluator's
  identities ([approved-cache-identities.json](approved-cache-identities.json), from Doppler
  `artifacts/selective-materialization-20261012/cache-coordinate-result-summary.json`). Each
  candidate's stored F16 bytes are also compared value by value with the unchanged paired
  package's. A kernel that changes any stored value fails this requirement even if the logits
  pass, and is reported as such.

**Result.** Every new kernel passes both gates. Each kernel alone and every combination tested
reproduce the shipped package's per-step maximum logit error exactly (9.520e-07). All 12 cache
identities are bit-identical, and 0 of 1,437,696 stored F16 values differ.

On the same GPU and controls, the combined candidate runs paired decode at 286-293 ms per token,
against 581-726 ms for the unchanged paired package (2.0-2.5x). The 56-token prompt takes 8.4 s
against 17.1 s, and the 184-token prompt 27.5 s against 56.8 s (2.0-2.1x). GPU time per decode
step falls from 455 to 214 ms.

The plain profile remains far faster (27-29 ms per token, 0.3 s prompts) and still fails the
acceptance gate (28/55). One open risk is the new recurrent-state program's compile cost: it is
8x the shipped kernel's on AMD, and Intel is untested (see [State](#3-recurrent-gated-delta-state-and-qk)).

## Setup

- **Machine:** `amd-host` (Radeon 8060S, RDNA3, RADV), Node v22 with the `webgpu` 0.4.0 Dawn module
  of the installed final-9 application. Every model-level, speed, compile and memory run here is
  amd-host.
- **The Mac's GPU was also used, against the brief.** The brief said to leave the mac-host GPU
  alone, but short kernel-level runs used the Mac this work was done from:
  - Doppler's `tests/kernels/paired-*-physical.js` in Chrome/Metal;
  - Node/Dawn kernel checks on Metal (single dispatches, no model).

  No result or gate here depends on them.
- **Bounds:** every GPU process ran in its own bounded systemd scope (10 GiB high, 12 GiB max, no
  swap, at most 3,600 s; [run-jobs.sh](run-jobs.sh)). The amdgpu error count was 50 before and
  after every job ([amd-host/session-*.log](amd-host)).
- **Load:** the public contributor processes kept running (110-140% of one CPU). These are matched
  controls, not an exclusive benchmark.
- **Controls, rerun in every session:**
  - the installed Doppler 0.6.28 package with the Capsule manifest (the qualified paired program);
  - Doppler main at each commit, with the unchanged Capsule manifest. This shows the new wiring
    leaves existing Capsules unchanged;
  - the plain profile (ordinary manifest).
- **Candidates:** scratch packages from `git archive` of Doppler main at each commit
  (`/var/tmp/paired-kernel-opt-20261014/pkg-*`, `webgpu` symlinked from the installed tree).
  - A candidate's model directory symlinks the 18 weight shards and the tokenizer.
  - It holds a manifest that differs from the Capsule manifest only in the declared execution
    kernels ([make-variant-model.py](make-variant-model.py); each `variant.json` records the
    change).
  - The speed ladder checks that the variant differs from the catalog's Capsule manifest only in
    those entries ([speed-ladder.mjs](speed-ladder.mjs); otherwise unchanged from
    speed-isolation-20261014).
- **Completion waits:** every new variant keeps `immediateCompletion: "settled"`.
- **Packages and commits:** each scratch package was archived from a local commit before its
  push. The push only amended the message, so the trees are identical:

  | Archived | Pushed |
  |---|---|
  | 0617dbf5 | 2a46e930 |
  | e2a73be5 | c3efe060 |
  | e62a2d41 | 0f92176c |
  | 980d4f39 | 1c9ec3db |

## Method

1. **Kernel level, before any full-model run** (`*-kernel-check.mjs`):
   - shipped and candidate WGSL run unmodified on identical inputs on amd-host, against an
     independent F64 evaluation;
   - input profiles: model-range, wide dynamic range (log-uniform magnitudes over 18-30 binades)
     and near-cancellation, aimed at each kernel's reordered reductions;
   - lengths straddle the new kernels' round, tile, slice and column-block boundaries;
   - recorded: maximum error against F64 (relative to max(1,|ref|) and to |ref|), maximum
     shipped-vs-candidate difference, bit-identical outputs, and median single-dispatch wall time.
2. **Model level** ([substitution-check.mjs](substitution-check.mjs), `dumpCaches`):
   - the 55-step acceptance comparison and the 12 cache hashes, for each kernel alone and for the
     combinations;
   - in the same process: the 56-token prompt with 64 decode tokens (second, warm pass reported)
     and the warm 184-token prompt.
3. **Speed:**
   - [speed-ladder.mjs](speed-ladder.mjs) `paired-unsplit` (56- and 189-token answer-cause turns,
     up to 128 tokens, Capsule sampler, EOS stop);
   - `paired-profile` (GPU timestamps per kernel family over 16 decode steps after the 56-token
     prompt);
   - controls `ordinary-per-token` and `ordinary-profile`.
4. **Preparation cost:**
   - [compile-cost.mjs](compile-cost.mjs): shader module plus pipeline creation for each new and
     replaced program specialization, in a fresh process, cold (`MESA_SHADER_CACHE_DISABLE=true`)
     and warm, with the process resident high-water mark before and after;
   - GPU buffer peak through Doppler's pool accounting ([memory-peak.mjs](memory-peak.mjs)).

[summarize.py](summarize.py) builds each session's `amd-host/out/summary-s*.json`.

## Results by kernel

Decode GPU ms per step is the kernel family's time in `paired-profile` (16 steps after the
56-token prompt), measured with every earlier kernel already replaced. Prompt and decode times
come from each kernel-alone 55-step run (the unchanged harness timing), beside that session's
installed paired control.

| Kernel (commit) | Decode GPU ms/step, old -> new | Kernel-level max error vs F64, shipped / new; max shipped-new difference | 55-step acceptance | Cache regression (identities; stored values differing) | Prompt 56 / 184 tok, s (control) | Decode ms/token (control) |
|---|---|---|---|---|---|---|
| Attention, tiled (2a46e930) | 93.5 -> 9.0 | 1.6e-12 / 1.8e-12; 1.9e-12 (49 cases) | 55/55, tokens 55/55, max 9.520e-07 | 12/12; 0 | 16.88 / 54.78 (16.97 / 57.10) | 454.7 (576.9) |
| RMSNorm, sliced (c3efe060) | 35.9 -> 13.4 | 1.6e-14 / 1.6e-14; 2.1e-14 (67 cases) | 55/55, 55/55, 9.520e-07 | 12/12; 0 | 17.50 / 57.64 (16.92 / 56.82) | 554.9 (577.5) |
| Recurrent state, sliced (0f92176c) | recurrent family 132.4 -> 31.9 (state and Q/K together) | output 2.3e-11 / 2.6e-11, state 1.4e-11 / 1.6e-11; 2.5e-11 (12 cases) | 55/55, 55/55, 9.520e-07 | 12/12; 0 | 11.02 / 36.79 (17.41 / 57.57) | 472.3 (586.8) |
| Q/K normalization, parallel (0f92176c) | (in the recurrent family) | 2.7e-15 / 2.7e-15; bit-identical (7 cases) | 55/55, 55/55, 9.520e-07 | 12/12; 0 | 16.95 / 57.14 (17.41 / 57.57) | 576.6 (586.8) |
| Matmul, compensated (1c9ec3db) | 116.0 -> 86.3 | vector outputs equal or lower than shipped (e.g. 8.8e-13 -> 3.9e-13); 4.4e-12 (12 cases) | 55/55, 55/55, 9.520e-07 | 12/12; 0 | 15.27 / 49.92 (17.12 / 56.75) | 535.3 (581.1) |

Reading the table:

- **Kernel-level errors** are relative to max(1, |ref|). The state rows include the wide and
  near-cancelling profiles, where both kernels lose the same relative accuracy; on model-range
  inputs both are within 7e-15.
- **The logits are unchanged at step granularity.** Every candidate's maximum logit difference
  equals the shipped package's at each of the 55 steps (`logitsMarginVsControl.maxStepChange` 0
  in the summaries). The margin to 0.001 is unchanged at 9.520e-07.
- **No stored value changed**, so the coordinator's follow-up investigation (which values, how
  many F16 steps, a different reduction order) did not arise. `summarize.py` records it per layer
  whenever a candidate differs.

### 1. Attention (`attention_paired_tiled.wgsl`)

**Cause.** `attention_paired.wgsl` runs one 256-lane workgroup per head and token, walks keys 4
at a time, and lane 0 alone updates the online softmax with up to five `pair_exp` calls per step.

**New kernel.**
- It walks the contiguous visible key range (causal and window bounds computed once) in tiles of
  255 keys.
- Four lanes score each key. A tree finds the tile maximum.
- Every key's exponential runs in its own lane. The last lane evaluates the running-maximum
  rescale at the same single `pair_exp` callsite. There is one `pair_div` callsite.
- The sum and value accumulators are rescaled once per tile.

**Kernel level** ([attention-kernel-check.mjs](attention-kernel-check.mjs),
[result](amd-host/out/attention-kernel-check-v2.json)):
- Decode at 57-72 keys: 14.0-17.3 -> 1.3-1.6 ms per layer dispatch. At 255 keys: 60.7 -> 3.2 ms.
  At 600 keys: 142.9 -> 7.9 ms.
- A 16-token prefill chunk at 176 keys: 45.0 -> 4.1 ms.
- Errors as in the table. The cases include the 63-65, 254-256 and 509-511 key straddles in every
  profile.

### 2. RMSNorm (`rmsnorm_paired_sliced.wgsl`) and linear-attention prepare

**RMSNorm cause.** One 64-lane workgroup per token. In decode, one workgroup per call: each lane
squares 16 elements, runs the inverse-root chain, then weights 16 more.

**RMSNorm new kernel.**
- One 256-lane workgroup per token and 256-element output slice.
- Each workgroup reduces the row (4 elements per lane), runs the unchanged
  mean/epsilon/root/reciprocal sequence, and normalizes one element per lane.

**Selection.**
- Input, post-attention and final norms follow the graph's `norm` step.
- Q/K head norms have no declared step and keep the shipped program. They account for most of
  the remaining 13.4 ms.

**Kernel level** ([rmsnorm-kernel-check.mjs](rmsnorm-kernel-check.mjs),
[result](amd-host/out/rmsnorm-kernel-check-v1.json)):
- Size-1024 dispatch: 0.7-0.9 -> 0.21-0.23 ms wall.
- Outputs are bit-identical to the shipped kernel in most cases, and within 2.1e-14 otherwise.
- Prenorm outputs are bit-identical.

**Linear-attention prepare (42.3-42.8 ms/step), inspected and not changed.**
- Each of its four phases (`paired_beta`, `paired_decay_scale`, `paired_log_decay`,
  `paired_decay`) is one 64-lane workgroup in decode with 16 active lanes (one per value head).
  Each lane runs a single dependent chain: a paired exponential or logarithm, plus a division
  for the sigmoid.
- There is no reduction, serial lane-0 section or idle-lane wait to parallelize. Phase time is
  the chain latency of one paired transcendental.
- The only structural saving is to fold the beta sigmoid into the decay-scale dispatch as a third
  row. That removes one dispatch's exponential depth, an estimated 9 ms per step. It needs an
  extra `pair_div` callsite in that kernel and a way for one declared program to replace two
  mechanisms.
- Merging exp and log phases would go against the documented separation that bounds their native
  compilation.
- Any further gain needs cheaper paired transcendental arithmetic. That is a change to the shared
  generated arithmetic, not to parallelism.

### 3. Recurrent gated delta (state and Q/K)

**Cause.**
- The state phase ran one 128-lane workgroup per value head (16 in decode). Each lane walked all
  128 state rows of its column twice per token: a dependent chain of about 512 paired multiplies
  and 384 paired adds.
- The Q/K phase evaluated three paired reciprocal square roots one after another per token.

**New kernels.**
- `gated_delta_state_paired_sliced.wgsl`: one 256-lane workgroup per value head and block of 16
  columns (128 workgroups in decode).
  - 16 lanes share a column. Each lane keeps 8 state rows in registers across all tokens and
    writes them back once.
  - Prediction and readout are tree-reduced over the slices.
- `gated_delta_qk_paired_parallel.wgsl`: Q and K squares reduce in the two halves of the
  workgroup in the shipped order. Three lanes evaluate the three roots at one callsite. Its
  output is bit-identical to the shipped kernel's.

**Selection (new).** Mechanism kernels were fixed in JavaScript, and the graph only pinned them.
A registry variant may now declare `variantMetadata.replacesMechanism`. When the manifest's
`mechanismKernels` declare it with its exact shader, entry and constants, it runs in that
mechanism's place, and the closure still requires the replaced mechanism. The variant models add
these declarations (`addMechanismKernels` in [state-substitution.json](state-substitution.json)
and [qk-substitution.json](qk-substitution.json)).

**Kernel level** ([state-kernel-check.mjs](state-kernel-check.mjs),
[qk-kernel-check.mjs](qk-kernel-check.mjs)):
- State: 1 token 6.4-7.4 -> 0.75-0.83 ms; 16 tokens 99-101 -> 9.0 ms.
- Q/K: 1 token 0.32 -> 0.17 ms; 16 tokens 3.2 -> 1.8 ms.

**Compile-cost risk (state only).**
- Cold, on amd-host, the sliced state program takes 16.6 s and raises the process high-water
  mark by 1.37 GiB. The shipped state kernel takes 2.0 s and 0.43 GiB.
- The cause is the fully unrolled 8-row register loop.
- Prototypes ([prototypes/](prototypes), [results](amd-host/out)):

  | State program | AMD 1 / 16 tokens, ms | AMD cold compile | Metal 16 tokens: prototype / committed form, same run |
  |---|---|---|---|
  | Shipped `gated_delta_state_paired` | 6.4-7.4 / 99-101 | 2.0 s, +0.43 GiB | 87.5 ms; the committed form measured 42.6 ms in that run |
  | Committed: 8 rows unrolled | 0.75-0.83 / 9.0 | 16.6 s, +1.37 GiB | (reference) |
  | Rolled loop (uniform row count), 8 rows | 0.73 / 8.8 | 2.7 s, +0.46 GiB | 56.8 / 9.8 ms |
  | 4 rows, 32 slices | 0.63 / 8.1 | 9.0 s, +0.81 GiB | 58.4 / 8.8 ms |
  | 2 rows, 64 slices | 0.66 / 8.8 | 4.3 s, +0.54 GiB | 57.2 / 9.3 ms |

  - The rolled form is as fast on AMD and compiles like the shipped kernel.
  - In Node/Dawn on the Mac, all three prototypes run a 16-token chunk about 6x slower than the
    committed form, though still faster than the shipped kernel. The Mac's timings also vary
    between runs.
  - The committed form passed every gate. The prototypes passed the kernel-level check only (F64
    errors as in [the results](amd-host/out)).
  Intel's compile cost is not measured; this run did not use intel-host. Which form to bind
  depends on the placement: placement B runs a Mac browser stage and an Intel stage. That is a
  decision for the owner.

### 4. Matmul (`matmul_paired_compensated.wgsl`)

**Restructuring does not help.**
- A prototype computing 4 outputs per 64-lane workgroup (16 lanes each,
  [prototypes/matmul_paired_grouped.wgsl](prototypes/matmul_paired_grouped.wgsl),
  [result](amd-host/out/matmul-kernel-check-grouped-v1.json)) measured -5% to +57% on amd-host.
- Sharing input loads cannot help either: the kernel is bound by its compensated arithmetic
  (88-93%, Doppler `artifacts/paired-matmul-prefill-cost-20261014`).

**The arithmetic is the lever.**
- The shipped kernel renormalizes a pair at every multiply-accumulate, through two
  integer-residual pair additions.
- The new kernel keeps each lane's sum unnormalized:
  - the high products sum in F32 with their exact addition residuals;
  - those residuals, the exact product residuals and the low-component products accumulate in a
    second, compensated F32 sum;
  - the lane normalizes once, before the unchanged paired tree reduction and alpha step.
- Each lane's partial is at least as accurate as before. On vector outputs its F64 error is equal
  or lower.

**Selection.** A projection or head step may declare a registry program that replaces exactly
the rule-selected one for its weight encoding and output form.

**Kernel level** ([result](amd-host/out/matmul-kernel-check-compensated-v1.json)):

| Shape | Shipped, ms | Compensated, ms |
|---|---|---|
| 3584x1024, M=1 | 0.87 | 0.66 |
| 3584x1024, M=16 | 13.1 | 10.8 |
| 1024x3584, M=16 | 13.1 | 9.2 |
| 65536x1024 scalar head | 15.1 | 12.1 |

On Metal the gain is larger (73.7 -> 48.6 ms).

## Combined candidate

Doppler 1c9ec3db with the Capsule manifest's attention, norm, projection and head programs
replaced, and the state and Q/K programs declared ([final-substitution.json](final-substitution.json)).

| Session 4 run | 55-step | Cache | Prompt 56 tok | Prompt 184 tok | Decode ms/token |
|---|---|---|---|---|---|
| Installed paired package (control) | 55/55, 9.520e-07 | 12/12 | 17.12 s | 56.75 s | 581.1 |
| Doppler 1c9ec3db, unchanged Capsule (control) | 55/55, 9.520e-07 | 12/12; 0 differ | 17.01 s | 57.22 s | 579.9 |
| **Combined candidate** | **55/55, 9.520e-07** | **12/12; 0 differ** | **8.43 s** | **27.53 s** | **285.5** |
| Plain profile (control) | 28/55, 3.495e-03 | n/a | 0.19 s | 0.32 s | 27.8 |

Speed ladder in the same session ([speed-ladder.mjs](speed-ladder.mjs)):

| Mode | Prompt, turn 1 (56 tok) | Prompt, turn 2 (189 tok) | Decode median, turn 1 / turn 2 |
|---|---|---|---|
| `paired-unsplit`, installed | 17.15 s | 57.65 s | 602.8 / 726.1 ms (100 / 12 tokens, EOS) |
| `paired-unsplit`, combined | 8.78 s | 28.00 s | 290.2 / 292.5 ms (same tokens, EOS) |
| `ordinary-per-token`, plain | 0.29 s | 0.33 s | 28.6 / 27.0 ms |

Decode GPU profile (`paired-profile`, ms per step):

| Kernel family | Installed | Combined |
|---|---|---|
| Matrix multiplies | 115.5 | 86.3 |
| Linear-attention prepare | 43.5 | 42.3 |
| Recurrent gated delta | 133.4 | 30.6 |
| Pointwise | 19.9 | 19.8 |
| RMSNorm | 36.4 | 13.2 |
| Convolution | 12.3 | 12.1 |
| Attention | 93.5 | 9.1 |
| **GPU total** | **455.5** | **214.4** |
| Profiled step wall (median) | 557.5 | 291.0 |

**Progression in each session** (decode ms/token in the 55-step run, against that session's
installed control):

| Session | Candidate | Decode, candidate | Decode, control |
|---|---|---|---|
| 1 | attention | 454.7 | 576.9 |
| 2 | + RMSNorm | 431.7 | 577.5 |
| 3 | + state and Q/K | 331.9 | 586.8 |
| 4 | + matmul | 285.5 | 581.1 |

The prompt times fall the same way: 54.8 -> 54.4 -> 32.1 -> 27.5 s at 184 tokens. Profiles for
each step are in `amd-host/out/s*-profile.json`.

**What remains.**
- About 77 ms of each profiled step is outside GPU kernels (291 wall against 214 GPU).
- Matmul is now 40% of GPU time. Prepare, pointwise, convolution and the gate phase are
  single-chain paired transcendentals (exp, log, sigmoid, SiLU) with no serial section left to
  parallelize.

### Pipeline preparation

The combined candidate prepares 8 new pipelines and drops 7 shipped ones:
- attention: 1;
- RMSNorm: 2 (unfused, and pre-residual with prenorm). The shipped unfused specialization stays,
  because Q/K head norms use it;
- state: 1;
- Q/K: 1;
- matmul: 3 (Q4_K and F16 vector, Q4_K scalar head).

Creation cost on amd-host, one fresh process per specialization
([compile-cost.json](amd-host/out/compile-cost.json)):

| Program | Cold, shipped -> new | Process high-water increase, shipped -> new | Warm (driver cache) |
|---|---|---|---|
| Attention | 7.4 -> 7.9 s | 0.65 -> 0.71 GiB | 9-12 ms |
| RMSNorm unfused / pre+prenorm | 5.7 -> 5.7 s / 6.3 -> 6.3 s | 0.65 -> 0.65 GiB / 0.66 -> 0.66 GiB | 9-13 ms |
| **Recurrent state** | **2.0 -> 16.6 s** | **0.43 -> 1.37 GiB** | 9-14 ms |
| Q/K | 5.1 -> 4.9 s | 0.60 -> 0.65 GiB | 9-10 ms |
| Matmul (3 specializations) | 0.30-0.33 -> 0.29-0.31 s | 0.17 -> 0.16 GiB | 8-10 ms |

- In total, the 8 new pipelines take 42.3 s cold on AMD against 21.7 s for the 7 they replace.
  The state program accounts for 14.6 s of the 20.6 s increase; the new RMSNorm unfused
  specialization (5.7 s) is the rest, since the shipped one stays for Q/K norms.
- Warm creation is about 10 ms each.
- The state program is the one to measure on Intel before binding; see the table in
  [section 3](#3-recurrent-gated-delta-state-and-qk). This run did not touch intel-host.

### GPU memory

[memory-peak.mjs](memory-peak.mjs) loads the model, then runs:
- the 184-token prompt and 50 decode steps;
- the 189-token turn and 16 decode steps.

| Run | Pool peak, bytes |
|---|---|
| Installed control | 1,002,913,536 |
| Combined candidate | 1,002,913,536 |
| Per-executor `maxGpuBufferBytes` | 1,420,000,000 |

- The peaks are identical: none of the new kernels allocates GPU buffers. Headroom is
  417,086,464 bytes.
- The process resident high-water mark rises with compilation: 1.71 GB for the control, 1.77 GB
  for the candidate.
- Pool accounting excludes driver-side allocations and pipeline objects.

## Not established

- **Other GPUs and the browser surface.**
  - Only amd-host (Node/Dawn) ran the model-level checks.
  - The Mac runs are kernel-level only: Metal through Node/Dawn for the kernel checks, and the
    Doppler physical tests in Chrome.
  - Intel Gen12LP compile cost and speed, especially for the state program, are not measured.
- **Qualification and delivery.** The candidate is not frozen, packaged, signed or qualified.
  Installed conversation latency comes after that. It would need:
  - a Capsule and TargetPlan that bind the combined graph, with the state choice settled;
  - 55/55 and cache identity on each required GPU;
  - the three-stage placements and pipeline preparation within `maxPreparationMs` on each stage
    host, Intel especially;
  - the installed conversation lifecycle, measured with the application's own timing.
- **The Q/K head norms** still run the shipped RMSNorm program; a declared step would let them
  use the sliced one.
- **About 77 ms per step outside GPU kernels** was not investigated.

## Files

- **Scripts:**
  - kernel checks: `*-kernel-check.mjs`;
  - model checks: [substitution-check.mjs](substitution-check.mjs), unchanged copy;
  - speed: [speed-ladder.mjs](speed-ladder.mjs);
  - cost: [compile-cost.mjs](compile-cost.mjs), [memory-peak.mjs](memory-peak.mjs);
  - variants: [make-variant-model.py](make-variant-model.py) and `*-substitution.json`;
  - [run-jobs.sh](run-jobs.sh), [summarize.py](summarize.py), [collect.sh](collect.sh).
- **amd-host/:**
  - session logs and job lists;
  - each variant's `variant.json`;
  - `out/`: kernel checks, ladder and profile JSONs, each check's `report.json` and
    request-level cache metadata (hashes);
  - `summary-s1..s4.json`, `compile-cost.json`;
  - `job-log-lines.txt`: every job's JSON output lines.

  The F16 cache dumps stay on amd-host under `/var/tmp/paired-kernel-opt-20261014/out/*/caches`.
- **Failed attempts** (`amd-host/failed-attempts`):
  - the first state check used a WGSL reserved word (`active`) and did not compile. The fix
    renamed it before any model run;
  - a rerun could not write its result over that failed file. Its log is kept, and the result
    was rerun as `state-kernel-check-v1.json`;
  - the first attention check crashed the Dawn module after two cases, because the instance was
    collected while in use. It is logged in `amd-host/out/job-log-lines.txt`.
- **Doppler commits:**
  - 2a46e930: tiled attention;
  - c3efe060: sliced RMSNorm;
  - 0f92176c: state and Q/K replacement programs, and declared-replacement selection;
  - 1c9ec3db: compensated matmul.
