# Precision recovery: the narrowest correction under the unchanged gate (2026-10-15)

Component: Launch 1 numerical evidence (Reploid artifacts only). Intent preserved. Boundary effects: none.
No Doppler source, kernel, package, manifest in either repository, Capsule, catalog, signature or install
changed. Machines: `amd-host` for every GPU and CPU run here; `mac-host` only for editing and analysis (its
GPU was not used: another session's Reploid application was running on it).

**Measurement scope for every speed number below:** one GPU (`amd-host`, Radeon 8060S, RDNA3, RADV),
Node v22 with the `webgpu` 0.4.0 Dawn module, the whole model in one process, teacher-forced requests, no
network. The public contributor processes kept running (100-170% of one CPU), so these are matched
controls, not an exclusive benchmark.

**Question.** Can a narrow precision correction pass the unchanged gate while keeping most of the plain
path's speed? The candidates are the accurate-K lead (accurate K, and if needed V, production at the
full-attention layers, everything else plain), F32 K/V storage at the full-attention layers, and
compensated accumulation only where the divergence arises.

## Answer

**No tested correction keeps most of the plain path's speed.** Every correction confined to K/V
production or storage fails, by measurement:

| Candidate | How measured | Result |
|---|---|---|
| F32 K/V storage, everything else plain | GPU, full gate, computed in the runtime | **Fails, worse than plain:** 0/55, max 4.80e-3 (plain 28/55, 3.50e-3) |
| Accurate K/V production from the plain path's own inputs (a compensated K/V projection, K norm and RoPE can do no better) | CPU upper bound: exact F64 producer on the installed plain run's captured inputs | **Cannot pass:** at layer 3 it removes 75 of 343 K and 44 of 311 V stored differences and adds 43 and 49 new ones; 99% remain at layers 11-23 |
| Compensated accumulation where the divergence arises | Built and measured earlier (Doppler `artifacts/source-prefix-correction-20261012`), not rerun | **Fails:** best 5/55 failing on AMD (2.22e-3), 12/55 on the Mac |

**The cheapest passing configuration measured** runs layers 0-19 paired with the faster kernels and layers
20-23 plus the head plain (`split20`). It passes 55/55 at max 1.715e-4 (82.8% margin), computed entirely in
the runtime from the deployed weights and inputs. Its cost:

| | Plain | **split20** | Paired (frozen faster candidate) |
|---|---|---|---|
| Decode, ms/token (median) | 27.6-27.8 | **204.6-204.7** (7.4x plain) | 282.4-282.6 |
| 56-token prompt | 0.16-0.18 s | **6.97-7.22 s** | 8.23-8.56 s |
| 184-token prompt | 0.32-0.34 s | **23.0-23.1 s** | 26.9-27.3 s |

It is a harness composition of two partitions with a host-side boundary narrowing, not yet a Doppler program.

**What still requires compensation:** every operation of layers 0-19, carried at better than F32 precision.
That covers all norms (with the source recurrent RMS epsilon), projections, the recurrent gated delta
(prepare, conv, state), attention, pointwise gates and residual adds that feed the layer 3-19 K/V stores.
After the layer-19 store, the operations (layers 20-23, final norm, LM head) can be plain within the gate.
The causal operation stays the F16 K/V store. A store rounds like the F64 reference only if its input is
accurate well below F32 rounding, and that input depends on every upstream operation.

**One previously passing configuration now fails, and is unstable.** Paired layers 0-15 with a plain tail
(`split16`) passed at 6.60e-4 with the 0.6.28 kernels. With the faster kernels it fails at 1.075e-3, although
those kernels reproduce every logit maximum and stored K/V value of the whole paired model. The change is
inferred, not measured, to come from paired intermediate values that differ below the gate's resolution. Under
seeded F32-level boundary perturbations split16 passes once in three. Split20 passes every variant, the worst
at 1.994e-4 (80.1% margin).

## Standard (unchanged)

- **Gate.** The approved F64 reference (`approved-reference.json`, sha256 `ad26dfbc...`), all 55 required
  prefixes. Every one of the 248,320 logits must be within 0.001 at every step, and every argmax must equal
  the reference token. The comparison block is the unchanged one from `substitution-check.mjs`
  (plain-profile-reference-20261014). Margin is reported as 1 - max/0.001.
- **K/V identity, a separate regression result.** After all 51 request-2 prefixes, the 12 full-attention cache
  hashes are compared with the [approved identities](approved-cache-identities.json). Stored values are also
  compared one by one with the paired control's bytes, which equal the approved identities. An F32 cache has
  no F16 identity, so its values are rounded to nearest F16 (ties to even) for that comparison, and the
  rounding is labelled.
- Weights (the same 18 Q4_K shards), prompts, the three frozen request contracts and greedy teacher-forced
  sampling are unchanged. Every failure, including refused configurations, is recorded.
- **Deployability.** A candidate counts only if the runtime computes everything from the deployed weights and
  inputs. Nothing from the reference is injected. Each row says so. The F64 K/V substitutions of
  plain-profile-reference-20261014 (for example K-only, 9.89e-4) injected reference values. They locate a
  boundary and are diagnostics, not fixes. The producer bound here is a CPU diagnostic.

## Setup

- **Runtime:** the frozen faster-candidate archive `3b132ee7ff984c80...` (Doppler `77c5d9b2`, 0.6.28,
  1,999 members verified after extraction; [setup-amd.sh](setup-amd.sh)). The same runtime ran every row.
- **Models,** each symlinking the same shards and tokenizer:
  - plain: the reference's own manifest `edeb69dd...` (ordinary F32, F16 K/V);
  - paired: the frozen candidate's Capsule manifest `548e6559...` with its TargetPlan runtime config
    (`paired-final.json`, sha256 `17adc85c...`);
  - F32 K/V: variant `5de90500...` of `edeb69dd` ([make-kvf32-model.py](make-kvf32-model.py),
    [variant.json](amd-host/variant.json)).
- **Harness:** [precision-check.mjs](precision-check.mjs). It is the unchanged `substitution-check.mjs`
  with record-only additions:
  - opening and first-use timing;
  - each pipeline's matched capability policy, lane integrity, applied transforms and K/V dtype and bytes;
  - buffer-pool peak and VmHWM;
  - cache dumps for splits and F32 caches;
  - a perturbation diagnostic that is off unless a configuration names it.

  Sessions p1, p1b and p1c ran [precision-check-p1.mjs](precision-check-p1.mjs) (`38abf673...`, without the
  perturbation code). Sessions p2 and p3 ran `7497c4b6...`. [diff](#files).
- **Runs:** [run-jobs.sh](run-jobs.sh). Each GPU process ran in its own systemd user scope (MemoryHigh
  14 GiB, MemoryMax 16 GiB, no swap, at most 1,500 s). Before each job the runner checked the amdgpu error
  count (baseline 50), MemAvailable and `user.slice` memory pressure. A watchdog sampled every scope every
  2 s and would kill it at 90% of MemoryHigh, on any `memory.events high` event, or on scope pressure above
  10.
  - **Health over all 28 GPU jobs and the one CPU job:**
    - amdgpu error count 50 before and after every job;
    - 0 systemd-oomd journal lines;
    - `user.slice` memory pressure `some avg10` 0.00 before every job;
    - no watchdog stop;
    - largest scope peak 8.52 GB (cold paired compile);
    - public contributor processes 4103868 and 4121371 were not touched.

  Another session changed both public contributors during session p3. This work sent neither any command:
  no script here signals any process except the watchdog's kill of this work's own scope, which never fired.
  - At 19:29:40 UTC a transient `reploid-native-contributor.service` ("current main", new PID) replaced the
    native contributor 4103868. This followed two SSH logins not from this work.
  - At 19:45:15 UTC the browser of the compute contributor 4121371 ended. Neither change overlapped p1 or p2,
    so every timing above predates them.

  See the [session logs](amd-host).
- **Cold and warm:** session p1 gave each configuration a new private Mesa shader cache, so its first use is
  a cold compile. Session p2 reran the same configurations in reverse order on those caches (warm first use).
  Every accuracy result is identical between p1 and p2. Agreement between the sessions:

  | Measure | p1 against p2 |
  |---|---|
  | Decode medians | within 1.5% |
  | 184-token prompts | within 8% |
  | 56-token prompts | within 18% (split12 4.73 against 3.99 s; plain 0.16 against 0.18 s) |
- **Job lists:** [p1](jobs-p1.txt), [p1b](jobs-p1b.txt), [p1c](jobs-p1c.txt), [p2](jobs-p2.txt),
  [p3](jobs-p3.txt). Configurations come from [make-configs.py](make-configs.py); each report records its
  configuration's sha256. Summaries come from [summarize.py](summarize.py).

## Results

Both sessions are shown where they differ: p1 (cold first use) / p2 (warm first use). The full rows are in
[summary-p12.json](amd-host/out/summary-p12.json).

| Configuration | Computed in the runtime, nothing injected | 55-step | Max error (margin) | Logits over 0.001 | K/V identities (values differing from approved) | Prompt 56 / 184 tok | Decode ms/token |
|---|---|---|---|---|---|---|---|
| Plain control | yes | 28/55 | 3.495e-3 (fails) | 25,151 | 0/12 (111,693) | 0.16-0.18 / 0.32-0.34 s | 27.6-27.8 |
| Paired control | yes | **55/55** | 9.520e-7 (99.9%) | 0 | 12/12 (0) | 8.23-8.56 / 26.9-27.3 s | 282.4-282.6 |
| F32 K/V (explicit lane) | yes | 0/55 | 4.795e-3 (fails) | 924,531 | n/a, F32 (335,003 by nearest F16) | 0.28-0.32 / 0.78-0.84 s | 66.2-67.2 |
| Paired 0-11, plain 12-23 + head | yes; host boundary narrowing | 54/55 | 1.043e-3 (fails) | 4 | 6/12 (8,202) | 3.99-4.73 / 13.7 s | 135.6-136.2 |
| Paired 0-15, plain 16-23 + head | yes; host boundary narrowing | 54/55 | 1.075e-3 (fails) | 3 | 8/12 (4,447) | 5.59-5.91 / 18.3-18.6 s | 170.8-171.1 |
| **Paired 0-19, plain 20-23 + head** | **yes; host boundary narrowing** | **55/55** | **1.715e-4 (82.8%)** | 0 | 10/12 (605, layer 23 only) | **6.97-7.22 / 23.0-23.1 s** | **204.6-204.7** |
| Paired 0-22, plain 23 + head | yes; host boundary narrowing | **55/55** | 2.119e-4 (78.8%) | 0 | 10/12 (357, layer 23 only) | 8.09-8.20 / 26.7-26.8 s | 230.8-230.9 |

Per-request maxima (requests of 19, 21 and 184 prompt tokens):

| Configuration | Request 0 | Request 1 | Request 2 |
|---|---|---|---|
| plain | 5.49e-4 | 6.22e-4 | 3.50e-3 (27 failing steps) |
| F32 K/V | 4.16e-3 (2) | 2.45e-3 (2) | 4.80e-3 (51) |
| split12 | 2.88e-4 | 2.38e-4 | 1.04e-3 (1) |
| split16 | 6.18e-5 | 4.82e-4 | 1.08e-3 (1) |
| split20 | 1.54e-5 | 1.58e-4 | 1.72e-4 |
| split23 | 3.35e-5 | 2.12e-4 | 1.59e-4 |
| paired | 8.40e-7 | 8.90e-7 | 9.52e-7 |

Tokens match the reference at all 55 steps in every row. Decode in the table is the 56-token turn's
median. In the request-2 check (longer context) the F32 K/V decode median is 115 ms, against 28 ms plain.

### 1. F32 K/V storage at the full-attention layers

**Computed in the runtime**, with no injection. Two single-sided attempts were refused, each by Doppler's
attention precision contract:

- `p1-kvf32`: the unchanged manifest plus runtime `kvcache.kvDtype: "f32"`. The manifest's attention
  programs declare `kvDtype: "f16"`.
- `p1b-kvf32m`: the F32-KV manifest variant alone. The runtime session still resolved an F16 cache.

Both failed fast at layer 3 ([log](amd-host/out/p1-kvf32.log), [log](amd-host/out/p1b-kvf32m.log)), as
the lane-mismatch guard requires.

The candidate is the explicit lane:

- the manifest variant: the three F16-KV attention programs replaced by the registered F32-KV
  `attention_streaming.wgsl#main`, and the session `kvDtype` set to `f32`;
- runtime `kvcache.kvDtype: "f32"`.

The receipt records:

- capability rule `runtime-session-compatibility` (`dtypeEffect: full-f32`, "Runtime KV cache resolved
  f32");
- transform `widenToF32CorrectnessFallback`;
- lane integrity `matches`.

That transform also swapped the embedding gather to its F32 variant and the unused F16 head GEMV. Every
matmul selection is the same as plain (`KernelSelect` lines in the logs). The embedding widening is F16 to
F32, exact by construction, but it is not separately verified here.

- **Result: 0/55, max 4.795e-3, 924,531 logits over the tolerance.** It fails on all three requests,
  including the two short ones that plain passes. The reference stores the nearest F16 of its F64 values,
  and attention reads those values. F32 storage removes that rounding, so every stored value departs from
  the reference by up to half an F16 step. The F16 flips that plain gets wrong affect 0.4-14% of values.
- **Memory cost:** 100,663,296 bytes of K/V at maxSeqLen 4,096, against 50,331,648 for F16 (+48 MiB, 2x). The
  pool peak is unchanged at 1,087,412,992 bytes.
- **Speed:** decode 66-67 ms per token on the 56-token turn and 115 ms in the longer request-2 check,
  against 28 ms. The registered F32-KV streaming attention is slower than the F16-KV online kernels.

### 2. Accurate K/V production from the plain path's own inputs (the accurate-K lead)

The question is whether a compensated K (or V) projection, K norm or RoPE could fix the stored values while
the rest stays plain. [producer-bound.py](producer-bound.py) computes the best possible case on CPU. It takes
the installed plain run's captured request-2 prefill (184 tokens, plain-profile-reference-20261014) and, at
each full-attention layer, recomputes the complete producer exactly in F64:

- `K = RoPE(k_norm(x Wk^T))` and `V = x Wv^T`;
- `x` is the plain run's own captured `post_input_norm`;
- the functions are the approved evaluator's own (digest `90376dde...`);
- the weights are dequantized from the same shards.

A second variant also recomputes the input normalization exactly from the previous layer's captured output.
It ran on amd-host's CPU in its own bounded scope (2 BLAS threads, `nice 19`), during the sensitivity session.
**Validation:** fed the reference-accurate inputs of the paired probe-fix capture (layers 3 and 7), the same
code reproduces the reference K and V bits exactly (0 differing).

Result: [producer-bound.json](amd-host/out/producer-bound.json). Counts are stored values that differ from
the reference. "Exact producer" is the F64 producer on the plain inputs; the last column also makes the input
normalization exact.

| Layer | K: plain | K: exact producer (removed / new) | V: plain | V: exact producer (removed / new) | Exact norm + producer, K / V |
|---|---|---|---|---|---|
| 3 | 343 | 311 (75 / 43) | 311 | 316 (44 / 49) | 319 / 301 |
| 7 | 3,775 | 3,751 (63 / 39) | 3,995 | 3,998 (27 / 30) | 3,758 / 3,995 |
| 11 | 11,734 | 11,732 (33 / 31) | 13,064 | 13,055 (28 / 19) | 11,733 / 13,060 |
| 15 | 10,385 | 10,390 (34 / 39) | 10,553 | 10,552 (28 / 27) | 10,388 / 10,550 |
| 19 | 7,956 | 7,954 (41 / 39) | 8,720 | 8,728 (32 / 40) | 7,953 / 8,727 |
| 23 | 6,931 | 6,921 (36 / 26) | 5,021 | 5,019 (19 / 17) | 6,925 / 5,020 |

**An exact K/V producer leaves most of the plain path's stored differences in place:** 78% of K and 86% of V
at layer 3, 98-99% at layer 7, and 99.5-99.8% at layers 11-23. The net count barely moves. The flips are
inherited from the residual stream. Plain's layer-3 input already deviates by 4.8e-7 relative RMS, about 8
times the F32 unit roundoff, accumulated over layers 0-2. The K projection's output deviation (4.6e-7) is no
larger than its input's
([compare-plain-vs-paired.json](../plain-profile-reference-20261014/amd-host-divergence/out/compare-plain-vs-paired.json)).

This table counts prefill stores against the plain run's own inputs, with no downstream replay. It bounds
any producer-only correction. A full gate run of such a correction cannot beat it, because the inputs that
cause the layer-3 flips are unchanged. Earlier evidence agrees: a same-input producer replay on an earlier
plain archive (Doppler `artifacts/source-prefix-correction-20261012`) attributed 274 of 352 K and 281 of
329 V layer-3 differences to inherited inputs.

K-only reference substitution passes at 9.89e-4. It passes only because the injected K carries the
reference's upstream accuracy, which the runtime can produce only by computing every upstream layer
accurately. That is the split configurations below, not a K-only correction.

### 3. Compensated accumulation where the divergence arises

This was not rerun. The divergence arises in every operation from layer 0 on. In the installed plain capture,
the layer-0 relative deviations are:

| Layer-0 output | Relative deviation |
|---|---|
| input norm | 4.5e-8 |
| QKV projection | 1.0e-7 |
| recurrent core | 2.3e-7 |
| attention output | 2.8e-7 |
| FFN output | 5.3e-7 |

The layer outputs then deviate by 3.4e-7, 4.5e-7 and 4.9e-7 after layers 0, 1 and 2.

Two earlier measurements already cover this candidate:

- **Doppler CPU counterfactual** (`artifacts/selective-materialization-20261012`). With exact F64 arithmetic
  and only each intermediate buffer stored as F32, 24/51 request-2 prefixes fail (3.09e-3). Narrowing the
  correction to normalization and projection stores, with the source recurrent epsilon, still fails 10/51
  (2.50e-3). Compensated arithmetic cannot remove a storage rounding, wherever it is placed.
- **The realized candidate** (Doppler `artifacts/source-prefix-correction-20261012`). It combined compensated
  Q4 prefill accumulation, accurate normalization and compensated decode accumulation, all with F32 storage,
  in archive `10704208...`. Its best result fails 5/55 on AMD (2.22e-3) and 12/55 on the Mac (2.62e-3).

### 4. Paired front, plain tail: the cheapest passing configurations

These rows are **computed in the runtime**. Doppler's own partition execution runs layers 0..N-1 (with the
embedding) in the paired program and the rest in the plain program, over the same 18 shards.

The only harness step is at the boundary. The paired activation (`hi`, `lo`) is narrowed to its nearest F32
(`Math.fround(hi + lo)`) on the host every step, from the run's own values. That host round trip is inside
the timings. A Doppler program would do it with an in-program cast step, which does not exist yet.

Correctness against the same splits with the 0.6.28 kernels (plain-profile-reference-20261014, s20-s25):

| Split | 0.6.28 kernels | Faster kernels (this run) |
|---|---|---|
| Paired 0-11 | 54/55, 1.0429018e-3 | 54/55, 1.0429018e-3 (identical) |
| Paired 0-15 | **55/55, 6.600391e-4** | **54/55, 1.0752810e-3** |
| Paired 0-19 | 55/55, 1.7151970e-4 | 55/55, 1.7151970e-4 (identical) |
| Paired 0-22 | 55/55, 2.1192534e-4 | 55/55, 2.1192534e-4 (identical) |

The faster kernels reproduce the whole paired model's logit maxima and every stored K/V value. The plain tail's
programs behave identically: the plain control and three of the four splits reproduce bit for bit. The
split16 change is therefore inferred, not measured, to come from paired intermediate values. The compensated
matmul, for one, is more accurate than the shipped kernel, and its differences can survive narrowing to F32
at the layer-16 boundary. With layers 16-23 plain, that is enough to move the result across the tolerance.

**K/V regression (separate):** for split20 and split23, all ten paired-partition identities (layers 3-19)
equal the approved identities. Only layer 23, produced by the plain tail, differs: 360 K and 245 V values for
split20, 204 K and 153 V for split23.

### 5. Sensitivity of the split margins (diagnostic)

**Diagnostic, not a candidate.** Session p3 reran each split with a seeded perturbation: a fraction of the
narrowed F32 boundary values moves by one F32 step, up or down, every step (`perturbBoundary` in the
harness). With probability 1e-4 that is 65-71 of 716,800 boundary values over a run; with 1e-3 it is
661-707. This is the size of difference a kernel change upstream of the boundary makes, as with split16
above. The other source of variation, a GPU whose plain tail rounds differently, is not sampled. Results:
[summary-p3.json](amd-host/out/summary-p3.json).

| Split | Unperturbed (0.6.28 kernels / faster kernels) | p = 1e-4, seeds 1, 2, 3 | p = 1e-3, seeds 1, 2, 3 |
|---|---|---|---|
| Paired 0-15 | 6.600e-4 pass / 1.075e-3 **fail** | 1.042e-3 **fail**, 1.077e-3 **fail**, 6.163e-4 pass | |
| **Paired 0-19** | 1.715e-4 / 1.715e-4 | 1.700e-4, 1.702e-4, 1.728e-4 | 1.671e-4, 1.994e-4, 1.949e-4 |
| Paired 0-22 | 2.119e-4 / 2.119e-4 | 2.119e-4, 2.119e-4, 2.119e-4 | |

- **split16 is not a stable passing configuration.** Five F32-level variants of it give two passes (6.2e-4,
  6.6e-4) and three failures (1.04-1.08e-3). Its result depends on which stored values in the plain layers
  19 and 23 change F16 step, and that dependence is effectively chaotic at this distance from the tolerance.
- **split20 holds:** every variant passes, the worst at 1.994e-4 (80.1% margin), including the
  perturbations ten times stronger. split23 does not move.
- 55/55 tokens in every run.

### Preparation and memory

| Configuration | Cold first use: opening + first 56-token prompt | Warm first use | Scope peak, cold / warm | Buffer-pool peak | Process VmHWM, cold / warm |
|---|---|---|---|---|---|
| plain | 0.7 + 0.9 s | 0.9 + 0.3 s | 0.90 / 0.81 GB | 1,087,412,992 | 1.01 / 0.92 GB |
| F32 K/V | 0.7 + 0.9 s | 0.7 + 0.4 s | 1.03 / 0.81 GB | 1,087,412,992 | 1.15 / 0.92 GB |
| paired | 30.4 + 77.9 s | 1.0 + 8.9 s | 7.87 / 1.86 GB | 1,001,799,424 | 7.95 / 1.51 GB |
| split12 | 28.9 + 74.7 s | 0.9 + 4.7 s | 7.89 / 2.00 GB | 1,098,604,288 | 7.97 / 1.84 GB |
| split16 | 31.7 + 76.2 s | 0.9 + 6.0 s | 8.34 / 1.11 GB | 1,101,946,624 | 8.42 / 1.21 GB |
| **split20** | **31.4 + 77.0 s** | **0.9 + 7.8 s** | **8.52 / 1.69 GB** | **1,104,797,440** | **8.60 / 1.78 GB** |
| split23 | 30.0 + 77.2 s | 0.9 + 8.7 s | 7.87 / 1.35 GB | 1,022,420,480 | 7.95 / 1.45 GB |

- **Splits prepare like the paired model.** The paired pipeline set is the same however many layers run
  paired. On this host cold compilation costs about 100 s and about 6-7 GB of transient compiler memory,
  which Mesa keeps after a cold compile. The warm first prompt is the steady-state prompt time.
- **Pool peaks:** the splits hold both partitions' buffers in one process. All are under the
  1,420,000,000-byte per-executor ceiling. The pool excludes driver-side allocations and pipeline objects.

## Cost of the cheapest passing configuration, and where it goes

- **split20 against the controls:**

  | Compared with | Decode | Prompts |
  |---|---|---|
  | Plain | 7.4x | 39-45x (56 tokens), 68-72x (184 tokens) |
  | Paired | 72% | 81-88% (56 tokens), 85% (184 tokens) |

- **Cost per paired layer.** Moving the boundary by four layers (three linear-attention layers and one
  full-attention layer) costs 33.5-35.2 ms of decode per token, about 8.5 ms per layer paired instead of
  plain.
- **Paired head (derived, not measured).** Extrapolating the splits to all 24 layers paired with a plain head
  gives about 239 ms, against 282 ms for the paired model. The paired final norm and head therefore cost
  about 43 ms per token. They lie downstream of every K/V store, so running them plain cannot cause a stored
  flip. Measuring this needs a declared plain head after paired layers; an ordered partition plan cannot
  express it, because it allows only interior split layers.

## Not established

- **Other GPUs and surfaces.** Only amd-host ran. The Mac (Chrome/Metal or Node/Metal) is untested. Its
  plain kernels round differently, so a split's plain-tail result can move, as split16's did; section 5
  samples that sensitivity. Intel is untested.
- **A Doppler program for any split.** Paired admission requires every layer paired today. The boundary cast
  is done in the harness.
- **Installed lifecycle, placements and network:** none were run.
- **Kernel-level speedups of the paired path** were not attempted here. The paired decode profile of the frozen
  candidate is in qk-norm-graph-20261015.

## What a split20 package would need (not built here)

1. **Doppler: a declared mixed-precision execution.** Either an ordered partition plan whose partitions carry
   different `intermediatePrecision`, or one execution graph with per-layer precision ranges. It needs an
   explicit paired-to-F32 cast step at layer 20, so that the precision change is declared, not silent. It
   needs admission and Rig signing rules for mixed closures, and a fail-closed lane-mismatch guard for a
   manifest/profile disagreement. The capability-policy rule kind would be `explicit-lane`.
2. **Manifest, Capsule and TargetPlan:**
   - the paired programs of `548e6559` for layers 0-19;
   - the plain programs of `edeb69dd` for layers 20-23 and the head;
   - a new program bundle and closure, initial execution identity, Rig signing and release event.
3. **Qualification on every stage GPU:**
   - 55/55 at 0.001, with the K/V regression recorded separately;
   - placement captures;
   - preparation within `maxPreparationMs`;
   - memory within 1,420,000,000 per executor;
   - the installed conversation lifecycle;
   - the margin on the Mac.

The decode gain is 282 to 205 ms per token on this GPU, before network and coordination costs.

## Files

- **Scripts:**
  - [precision-check.mjs](precision-check.mjs) and [precision-check-p1.mjs](precision-check-p1.mjs);
    `diff precision-check-p1.mjs precision-check.mjs` shows only the perturbation diagnostic;
  - [run-jobs.sh](run-jobs.sh), [run-sessions.sh](run-sessions.sh), [setup-amd.sh](setup-amd.sh);
  - [make-configs.py](make-configs.py), [make-kvf32-model.py](make-kvf32-model.py);
  - [producer-bound.py](producer-bound.py) (uses `divergence-compare.py` from plain-profile-reference-20261014);
  - [summarize.py](summarize.py);
  - job lists `jobs-p*.txt`.
- **amd-host/:**
  - session logs `session-*.log`;
  - [configs/](amd-host/configs);
  - the variant record;
  - `out/<run>/report.json` (every step's maximum, timing, receipts) and `out/<run>.log`;
  - the cache metadata `out/<run>/caches/request-*.json`;
  - [summary-p12.json](amd-host/out/summary-p12.json), [summary-p3.json](amd-host/out/summary-p3.json),
    [producer-bound.json](amd-host/out/producer-bound.json).

  The raw cache bytes stay on amd-host under `/var/tmp/precision-recovery-20261015/out/*/caches`, with
  their hashes in the metadata.
- **Failed and refused attempts,** all retained:
  - `p1-kvf32` and `p1b-kvf32m`, refused by the precision contract;
  - split16 and split12, which fail the gate.
