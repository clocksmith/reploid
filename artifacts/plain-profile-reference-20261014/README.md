# Plain profile against the approved F64 reference (2026-10-14)

**Question.** Does the ordinary f32 execution profile meet Launch 1's correctness standard on its
own? The standard is the approved independent F64 reference over all 55 required prefixes, at the
unchanged 0.001 tolerance. Its weights, prompts and sampling are the same as the qualified paired
package's. The [speed isolation](../speed-isolation-20261014/README.md) measured the plain profile
at 21x faster per decode token on the same GPU.

**Setup.**
- **GPU:** `amd-host` (RDNA3).
- **Runtime:** the installed final-9 Doppler 0.6.28 package (runtime archive `2df37d88...`) on
  Node/Dawn.
- **Model:** the reference's own model identity, manifest `edeb69dd...`. It is ordinary f32
  execution with an f16 KV cache, no paired kernels, and the same 18 Q4_K shards as the Capsule.
- **Inputs:**
  - reference `approved-reference.json` (sha256 `ad26dfbc...`), checked with the same
    comparison as `tests/fixtures/ordered-partition-reference.js`;
  - the three frozen request contracts (`ba2a4668...`, `3cc051de...`, `8b21b154...`). Each
    rendered prompt equals its frozen token prefix.
- **Execution:** whole model on one machine, teacher-forced along the reference tokens.
- **Check per step:** every one of the 248,320 f32 logits must be within 0.001 of the F64 values,
  and the argmax token must equal the reference token.
- **Recording:** unlike the qualification harness, this check records every step instead of
  stopping at the first failure.
- **Scope:** a bounded systemd scope; the amdgpu error count was unchanged.
- **Script:** [plain-reference-check.mjs](plain-reference-check.mjs).

## Results

| Run | Request 0 (19 tokens, 2 steps) | Request 1 (21 tokens, 2 steps) | Request 2 (184 tokens, 51 steps) | Steps within 0.001 | Tokens equal |
|---|---|---|---|---|---|
| Plain, manifest defaults ([check-plain.json](check-plain.json)) | max 5.49e-4 | max 6.22e-4 | max 3.50e-3; 27 steps over | 28 / 55 | 55 / 55 |
| Plain with a two-F32 linear-attention recurrent state (`linearRecurrentStatePrecision: "two-f32"`, [check-recurrent-two-f32.json](check-recurrent-two-f32.json)) | max 6.70e-4 | max 5.38e-4 | max 2.88e-3; 18 steps over | 37 / 55 | 55 / 55 |
| Paired package, for comparison ([campaign 3](../completion-qualification-3-20261014/README.md)) | | | max 9.52e-7 | 55 / 55 | 55 / 55 |

**The plain profile fails the unchanged standard,** with every failure on the 184-token request.
The error is already 7.05e-4 on that request's first step, the prefill of the long prompt. It then
stays between about 6e-4 and 3.5e-3 without growing across the decode steps. Every selected token
still equals the reference token.

**Keeping only the recurrent state in two-F32 reduces the error but does not pass.** That rules
out the recurrent state as the sole cause, but not as one contributor.

## Next

The first divergent operation is not yet identified. The next step is to compare per-operator
outputs of the plain run on the 184-token prefill with an F64 forward of the same model at the
same points. Then test the narrowest correction that brings every step within 0.001 while
keeping most of the plain path's speed. If broader paired execution remains necessary, the
measured paired bottlenecks get optimized instead, under the same reference and tolerance. Any
passing configuration then needs its own qualification across placements and the installed
conversation lifecycle; it does not inherit acceptance from the paired package.

## First divergence and controlled substitutions (2026-10-14, later)

**Questions.**
- Which operation turns small, expected F32 rounding differences into the unacceptable final error?
- Which precision correction is necessary to pass?
- Can a narrowly scoped correction pass while keeping most of the plain path's speed?

**The standard is unchanged:** the same approved F64 reference, all 55 steps within 0.001, and the
same weights, prompts and sampling. A run passes only if all 55 steps are within 0.001; matching
tokens alone never count.

**Setup.**
- **Machine:** `amd-host` only, with the same installed 0.6.28 package and model files as above.
- **Bounds:** every GPU process ran in its own bounded systemd scope. The amdgpu error count stayed at
  50 throughout (`amd-host-divergence/batch-*.log`).
- **Scratch root:** `/var/tmp/plain-divergence-20261014` on amd-host. Raw captures there are hash-bound
  in [raw-index.json](amd-host-divergence/out/raw-index.json).
- **Scripts:**
  - [divergence-capture.mjs](divergence-capture.mjs): request 2, teacher-forced. It writes full
    operator captures for the whole prefill and for decode step 15, plus the physical F16 KV cache
    bytes of all six full-attention layers.
  - [divergence-compare.py](divergence-compare.py): compares two captures, operator by operator.
  - [substitution-check.mjs](substitution-check.mjs): one configuration per process. It runs the
    55-step comparison copied unchanged from `plain-reference-check.mjs`, plus timing that uses the
    speed harness's per-token loop:
    - the 56-token answer-cause prompt, then 64 decode tokens, run twice with the warm second
      pass reported;
    - the 184-token prompt, timed warm after the check.
  - [summarize-substitutions.py](summarize-substitutions.py): collects the runs into
    [substitution-results.json](amd-host-divergence/out/substitution-results.json).

**The paired package is the F64 proxy.** After all 51 request-2 prefixes, its six F16 KV caches
hash-match the approved F64 evaluator's cache identities, bit for bit. Those identities are retained
in Doppler `artifacts/selective-materialization-20261012/cache-coordinate-result-summary.json`.
Its logits are within 9.52e-7 of the approved vectors. Every plain cache differs.

### First rounding difference, and the operation that makes it unacceptable

Comparisons of the request-2 prefill ([compare-plain-vs-paired.json](amd-host-divergence/out/compare-plain-vs-paired.json),
[…-probefix.json](amd-host-divergence/out/compare-plain-vs-paired-probefix.json)):

- **First rounding difference: the layer-0 input RMSNorm.** Its relative RMS deviation is 4.5e-8,
  with a maximum of 5.0e-7. The embedding is exact. F32 rounding then grows slowly: layer outputs
  at 3.4e-7, 4.5e-7 and 4.9e-7 relative RMS after layers 0-2. This is expected and is not the cause.
- **Causal operation: the F16 K/V cache store of the full-attention layers, first at layer 3.**
  - Before the store, the plain K and V deviate by only 5.3e-7 and 4.8e-7 relative RMS.
  - Each side stores the nearest F16 of its own value. All 94,208 values agree with this, so the
    store itself is exact.
  - Even so, 343 K and 311 V values (0.36% and 0.33%) round to a different F16 than the reference.
    Their pre-store deviation is a median of 4.3% and 3.5% of one F16 spacing. The count of
    differing nearest-F16 values equals the count of differing stored bits exactly.
  - Attention reads these one-step F16 differences. Its core output deviation jumps from about
    5e-7 to 6.8e-6, and the layer-3 output goes to 8.0e-6, 16x the layer-2 level.
- **Amplification at each later full-attention layer:**

  | Full-attention layer | 3 | 7 | 11 | 15 | 19 | 23 |
  |---|---|---|---|---|---|---|
  | Differing stored K / V after the prefill | 343 / 311 | 3,775 / 3,995 | 11,734 / 13,064 | 10,385 / 10,553 | 7,956 / 8,720 | 6,931 / 5,021 |
  | Layer-output deviation, relative RMS | 8.0e-6 | 4.2e-5 | 3.9e-5 | 2.6e-5 | 1.9e-5 | 2.8e-5 |

  At layer 7, the inherited pre-store deviation is already 9.1e-6.

The final logits differ by 7.0e-4 at step 0 and by up to 3.5e-3 during decode.

### Controlled substitutions

Each table row changes one thing relative to the plain control. Prompt times are in seconds;
decode is the median ms per token. Each session ran the plain and paired controls through the same
harness alongside its candidates.

| Session | Runs |
|---|---|
| 1 | `s01`-`s14` |
| 2 | `s15`-`s18` |
| 3 | `s20`-`s23` |
| 4 | `s24`-`s27` |

**Controls.** The control errors were identical in every session:

| Control | Max final error | Steps within 0.001 | Prompt, 56 tokens | Prompt, 184 tokens | Decode ms/token |
|---|---|---|---|---|---|
| Plain (5 runs) | 3.495e-3 | 28 / 55 | 0.16-0.20 | 0.32-0.35 | 27.4-27.9 |
| Paired (5 runs) | 9.52e-7 | 55 / 55 | 16.87-17.32 | 56.34-58.12 | 575-585 |

**Existing session knobs.** Neither passes:

| Substitution | Max final error | Steps within 0.001 | Prompt, 56 tokens | Prompt, 184 tokens | Decode ms/token |
|---|---|---|---|---|---|
| Two-F32 recurrent state | 2.879e-3 | 37 | 2.40 | 7.63 | 71.8 |
| Paired prefill chunking (16 tokens, 1 layer per recorder) | 2.426e-3 | 27 | 0.20 | 0.48 | 27.4 |

**F64-backed F16 K/V at every store.** These are diagnostics, not implementable corrections. The
listed caches are overwritten with the approved values inside the same command stream, before
attention reads them, and every stored position is substituted (276 per layer). Everything else
stays plain:

| Substitution | Max final error | Steps within 0.001 |
|---|---|---|
| All six layers, K and V | 2.26e-5 | 55 |
| All six layers, K and V, plus two-F32 recurrent state | 2.30e-5 | 55 |
| K only | 9.89e-4 | 55, with a 1% margin |
| V only | 2.122e-3 | 49 |
| Layer 3 only | 1.528e-3 | 48 |
| Layers 3, 7, 11 | 1.051e-3 | 53 |
| Layers 3-19, with layer 23 plain | 6.00e-4 | 55 |

**Implementable precision placements.** Each is composed in the harness from the installed package:

| Placement | Max final error | Steps within 0.001 | Prompt, 56 tokens | Prompt, 184 tokens | Decode ms/token |
|---|---|---|---|---|---|
| Paired prompt processing, plain decode | 2.530e-3 | 40 | 17.48 | 59.08 | 28.5 |
| Same, with two-F32 recurrent state in decode | 1.686e-3 | 44 | 17.63 | 58.70 | 68.8 |
| Paired layers 0-11, plain layers 12-23 and head | 1.043e-3 | 54 | 8.78 | 29.25 | 275 |
| **Paired layers 0-15, plain layers 16-23 and head** | **6.60e-4** | **55** | **11.93** | **38.30** | **356** |
| Paired layers 0-19, plain layers 20-23 and head | 1.72e-4 | 55 | 14.59 | 48.84 | 442 |
| Paired layers 0-22, plain layer 23 and head | 2.12e-4 | 55 | 16.96 | 56.32 | 488 |

**Mechanism controls.** Both reproduce the plain control exactly: the same maxima and the same
25,151 logits over 0.001.
- `s05`: a plain prefill handed to the plain decode through the snapshot transfer.
- `s19`: a plain/plain partition split at layer 20.

**How the placements were composed.**
- **Paired prompt processing:** the prompt runs in a paired pipeline. Its F16 KV cache and
  linear-attention states are then handed to the plain pipeline, with the conv state narrowed to
  its nearest F32.
- **Paired layers 0..k-1:** a two-partition plan. The front partition runs with the Capsule
  TargetPlan configuration and the tail with the plain manifest. The boundary activation is
  narrowed to its nearest F32 in the harness every step. That host round trip is included in these
  timings; an in-program cast would remove it.

### What this establishes

1. **The operation that must be corrected is the F16 K/V cache store.** Its inputs must already
   carry better-than-F32 accuracy, because a flip is caused by an input deviation of about 4% of one
   F16 spacing.
   - Making only the stored K/V values equal the F64 values brings the otherwise unchanged plain
     path from 3.495e-3 to 2.26e-5.
   - Every narrower K/V substitution fails or barely passes: V only, layer 3 only, layers 3/7/11, and
     K only at a 1% margin.
   - All other plain F32 error, including the recurrent state and the LM head, stays below 2.3e-5 once
     the caches are exact.
2. **Bit-exact stored values need upstream values accurate enough to round identically.** The
   stored F16 values are a rounding of values that depend on every earlier layer; passing the
   0.001 logits gate may need less than bit-exactness (the K-only and layers 3-19 substitutions
   pass), so cheaper ways to produce sufficiently accurate K/V are not ruled out by these runs.
   - Every correction tested that is local to the plain path failed: the two-F32 recurrent state,
     prefill chunking, and a paired prompt with plain decode. Prior CPU counterfactuals agree: even F64 arithmetic
     with nearest-F32 storage of each global intermediate buffer and two-F32 recurrent state fails
     24 of 51 request-2 prefixes (Doppler `artifacts/selective-materialization-20261012`).
   - **The cheapest passing configuration tested is paired arithmetic for layers 0-15**, with layers
     16-23 and the LM head plain. Its 6.60e-4 maximum is a thin margin on one GPU. Paired layers
     0-19 pass with 1.72e-4.
3. **No tested correction keeps most of the plain path's speed.** The cheapest passing configuration
   tested costs:
   - decode: 356 ms per token, against 27.9 plain (12.8x) and 575-585 paired (61% of paired);
   - 56-token prompt: 11.9 s, against 0.17 plain and 17.1 paired;
   - 184-token prompt: 38.3 s, against 0.33 plain and 57 paired.
4. **Paired bottlenecks on the tested passing configurations.** Every paired kernel family remains
   on the critical path inside the paired region:
   - the recurrent gated delta (12 of 18 linear layers);
   - matrix multiplies (about 44% of decode weight volume);
   - attention (layers 3, 7, 11 and 15);
   - linear-attention prepare;
   - RMSNorm, pointwise and convolution.

   Estimated by scaling the [speed-isolation](../speed-isolation-20261014/README.md) per-family
   decode profile to layers 0-15, these account for about 275 of the 454 ms paired GPU time. The LM
   head and the last 8 layers can stay plain.

### Not established

- **The split placement is a harness composition, not a Doppler program.** Shipping it needs:
  - a declared mixed-precision execution graph, or a mixed-precision ordered partition plan, with
    an explicit paired-to-F32 cast step at the boundary (today paired admission requires every
    layer paired);
  - a Capsule and TargetPlan that bind it;
  - its own qualification: all 55 prefixes on each required GPU, the physical placements, the
    installed conversation lifecycle and the memory budget.

  Only `amd-host` ran here, and the 0-15 margin is thin.
- **Paired kernel optimization is not done here.** The attention kernel's serial lane-0 softmax and
  the recurrent, RMSNorm and prepare kernels are the measured targets. Their WGSL is pinned by
  digest, so each needs new kernels and requalification against the same reference.

**Doppler observation fix.** The paired full-attention probes passed only the component dtype, so
paired Q/K/V, RoPE and attention-core captures were read as scalar F32 words covering half of each
chunk. Doppler `02be322d` now passes each tensor's declared representation (`tensorProbeOptions`
in `probes.js`), with a focused regression test. A paired capture with that change, run from a scratch copy of the installed package,
records layers 2, 3 and 7 as `two-f32` over all 184 tokens. Its logits and cache identities are
unchanged.

The earlier compare file's layer-3 internals use only the half-chunk rows that the old probes read
correctly; the `-probefix` comparison covers every token.

**Failed attempts** are in `amd-host-divergence/failed-attempts/`:
- the first capture indexed the sparse KV cache by allocation rather than by model layer;
- a smoke run of the handoff mechanism;
- the first probe-fix capture exceeded the default V8 heap before the op filter was added.
