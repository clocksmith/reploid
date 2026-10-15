# Q/K head normalization as declared execution-graph steps (2026-10-15)

Component: Doppler runtime source (`inference.pipelines.text`, `gpu.kernels`, `config`); evidence only in
Reploid. Intent preserved. Boundary effects: none here. No package, Capsule, catalog, signature or install
changed. Machines are `mac-host` and `amd-host`.

**Defect.** The paired runtime ran the Q/K head norms with `rmsnorm_paired.wgsl` outside the execution
graph. No graph step declared them, so the graph could not select another program. When the faster
candidate's norm steps named the sliced program, `rmsnorm_paired.wgsl` left the signed closure, and the
installed stage refused it during preparation (Capsule 1, manifest `64d74719`). Capsules 2 and 3 declared it
as mechanism kernel `paired_qk_head_norm` as a workaround (see
[faster-candidate-20261015](../faster-candidate-20261015/README.md#open-failures-and-defects-found)).

**Change (Doppler `36b73ec8`).**

- **Graph.** New execution-v1 ops `q_norm` and `k_norm`, declared like the other norm roles, for example
  `["q_norm", "norm"]` and `["k_norm", "norm"]` after `v_proj`. The step's registry program runs the head
  norm for its role, phase and layer. A step naming `rmsnorm_paired_sliced.wgsl` selects
  `rmsnorm/paired_sliced`. Nothing outside the graph chooses the program; without a graph the head-norm
  dispatch fails.
- **Preparation coverage.** It derives the `q_norm`/`k_norm` pipelines from the same resolver the dispatch
  calls, per phase. The unpinned special case is removed. The prepared-equals-bound test covers the
  deployed chunked-prefill graph and the deployed faster-candidate graph (`548e6559`), both without steps,
  and that graph with steps declaring either program.
- **Interim, so existing Capsules still validate.** A graph without the steps runs `rmsnorm/paired`. Run
  admission and Rig signing require its closure to declare that program, as a step kernel (`6b2cb026`) or
  as the `paired_qk_head_norm` mechanism kernel (`548e6559`). Remove the interim branch when every
  supported manifest declares the steps. A `64d74719`-shaped graph is now refused at admission and signing.

## Standard (unchanged)

- **Gate.** The approved F64 reference (`ad26dfbc`) over all 55 required prefixes. Every one of the 248,320
  logits must be within 0.001 at every step, and every token must match. The comparison is the unchanged
  [substitution-check.mjs](substitution-check.mjs) (byte-identical to the earlier sessions' copy).
- **Regression check, reported separately.** After all 51 request-2 prefixes, the 12 full-attention F16 K/V
  cache hashes must equal the [approved identities](approved-cache-identities.json). Stored values are also
  compared one by one with the control's. [summarize.py](summarize.py) is unchanged.

## Setup (amd-host, session q1 and q2)

- **Packages** ([setup-amd.sh](setup-amd.sh); every archive member verified after extraction):
  - control: the frozen candidate archive `3b132ee7` (Doppler `77c5d9b2`);
  - new: `11e6b010...`, packed from tree `85a44e96` (Doppler `36b73ec8`) by `git archive` and
    `npm pack --ignore-scripts`. It differs from the control only in 12 JavaScript and JSON source files.
    No WGSL changed. The archive was built from the local commit before its message was amended, and
    rebuilding from `36b73ec8` reproduces it byte for byte.
- **Models** ([make-qk-model.py](make-qk-model.py), [variant records](amd-host/models)). Shards and tokenizer
  are symlinked from the unchanged base:

  | Model | Manifest | Head-norm program |
  |---|---|---|
  | `legacy` | `548e6559` unchanged | interim `rmsnorm/paired` (mechanism kernel) |
  | `shipped` | `b696fb91` | steps naming `paired_qk_head_norm` (`rmsnorm_paired.wgsl`) |
  | `sliced` | `69dfcc4a` ([manifest](amd-host/models/model-sliced/manifest-69dfcc4a.json)) | steps naming `norm` (`rmsnorm_paired_sliced.wgsl`); `rmsnorm_paired.wgsl` removed from the closure |

- **Runs.** Each GPU process ran in its own bounded systemd scope ([run-jobs.sh](run-jobs.sh): 10 GiB high,
  12 GiB max, no swap, at most 900 s). The amdgpu error count was 50 before and after every job
  ([q1](amd-host/session-q1.log), [q2](amd-host/session-q2.log)).
  - **Concurrent load.** Another agent's placement C measurement ran throughout: two `fc-env-*` native
    stages and its sampler, which were not touched. GPU busy was 81-98% ([load](amd-host/concurrent-load.log)).
    The public contributors were present and untouched.
- **Dry run first** (mac-host, CPU only). The new runtime admitted all three manifests and resolved
  `paired`/`paired`/`paired_sliced` for both roles on every full-attention layer and phase.
  - The frozen runtime `3b132ee7` also admits the stepped manifests: unknown ops only warn. It would run
    `rmsnorm/paired` for the head norms regardless of the step.

## Kernel level: head-norm shape ([qk-norm-kernel-check.mjs](qk-norm-kernel-check.mjs), [result](amd-host/out/q1-kernel.json))

Both unchanged programs ran on identical inputs:

- **Shape.** Head 256; 8 Q and 2 K heads per token; 1, 3 and 16 tokens.
- **Weights.** The model's F16 `q_norm`/`k_norm` weights of all six full-attention layers with the
  `(1 + w)` offset, plus synthetic F32 weights.
- **Inputs.** Uniform, log-uniform 2^-20..2^10, a few dominant channels, and rows near epsilon.

The reordered reduction is 64 lanes of 4 squares against 256 lanes of 1.

| | `rmsnorm/paired` | `rmsnorm/paired_sliced` |
|---|---|---|
| Max error vs F64 (relative to max(2^-40, \|ref\|)) | 8.11e-15 | 7.71e-15 |
| Max error vs F64 (relative to max(1, \|ref\|)) | 6.85e-15 | 6.85e-15 |

- **Agreement.** 152 cases, 1,368,064 values. 94.7% of paired outputs are bit-identical between the two
  programs (64 cases entirely). The rest differ by at most 1.06e-14 relative.
- **F16 rounding.** No value's nearest F16 value differs. This is a pre-RoPE proxy for the K cache.
- **Single-dispatch wall time.** About 0.24 ms falls to about 0.15 ms. This is submit-dominated.

## Model level: 55 steps and K/V ([summary](amd-host/out/summary-q1.json))

| Run | Runtime + manifest | 55-step gate | Tokens | Max error | Per-step maxima vs control | K/V identities | Stored values differing from control |
|---|---|---|---|---|---|---|---|
| `q1-ctl` | control + `548e6559` | 55/55 | 55/55 | 9.520e-07 | (control) | 12/12 | (control) |
| `q1-legacy` | new + `548e6559` (interim path) | 55/55 | 55/55 | 9.520e-07 | equal at 55/55 | 12/12 | 0 |
| `q1-shipped` | new + `b696fb91` | 55/55 | 55/55 | 9.520e-07 | equal at 55/55 | 12/12 | 0 |
| `q1-sliced` | new + `69dfcc4a` | 55/55 | 55/55 | 9.520e-07 | equal at 55/55 | 12/12 | 0 |
| `q1-sliced2` | new + `69dfcc4a` | 55/55 | 55/55 | 9.520e-07 | equal at 55/55 | 12/12 | 0 |
| `q1-ctl2` | control + `548e6559` | 55/55 | 55/55 | 9.520e-07 | equal at 55/55 | 12/12 | 0 |

- Per-request maxima are 8.40e-07, 8.90e-07 and 9.52e-07 in every run, the shipped package's own.
- K/V identity did not change, so no regression-check failure was recorded.

## Speed

**GPU time per decode step** ([profiles](amd-host/out/summary-q2.json); speed-ladder `paired-profile`, 16
decode steps after turn 1, alternating). The ladder is the earlier copy with one change: it accepts the
inserted `q_norm`/`k_norm` steps and records them ([speed-ladder.mjs](speed-ladder.mjs)).

| | Control (`q2-ctl`, `q2-ctl2`) | Sliced head norms (`q2-sliced`, `q2-sliced2`) |
|---|---|---|
| All kernels | 215.1 / 215.7 ms | 212.1 / 213.0 ms |
| `rmsnorm` label | 13.40 / 13.39 ms | 11.61 / 11.55 ms |
| Every other label | mean difference at most 0.47 ms (single runs up to 0.74 ms) | |

The other norm roles run the sliced program in both, so the `rmsnorm` difference is the 12 head-norm
dispatches per decode step. It also shows physically that the step selected another program.

**Wall clock, full model** (from the 55-step checks, in run order):

| Run | 56-token prompt | 184-token prompt | Decode median | Decode min |
|---|---|---|---|---|
| `q1-ctl` | 10.74 s | 33.68 s | 354.4 ms | 282.0 ms |
| `q1-sliced` | 10.24 s | 38.87 s | 354.7 ms | 281.4 ms |
| `q1-legacy` | 9.38 s | 30.26 s | 351.7 ms | 279.2 ms |
| `q1-shipped` | 9.89 s | 26.35 s | 298.3 ms | 284.1 ms |
| `q1-sliced2` | 9.08 s | 30.51 s | 290.9 ms | 278.1 ms |
| `q1-ctl2` | 12.41 s | 30.72 s | 310.2 ms | 280.1 ms |

The frozen candidate's earlier session (no concurrent stages) measured 8.21 / 26.43 s and 286.5 ms.

**Answer: the sliced program helps decode slightly.** The head norms take about 1.8 ms less GPU time per
decode step: the `rmsnorm` label, 0.8% of the step. Total GPU time falls 2.9 ms (1.3%), but 1.1 ms of that is
in labels whose programs did not change, so it is run-to-run spread. The concurrent placement C stages
made repeats of the same configuration differ by 15-25% in wall-clock prompt and decode time. That spread
exceeds the expected effect, so these wall-clock rows neither confirm nor refute it. Decode minima are equal
within 1%. Prefill head-norm GPU time was not profiled.

## What a new package needs (not done here)

- **Runtime.** An archive built from Doppler `36b73ec8` or later.
  - Earlier runtimes (`3b132ee7`, `2df37d88`) ignore `q_norm`/`k_norm` with a warning and run
    `rmsnorm/paired` regardless.
  - A Capsule whose closure lacks `rmsnorm_paired.wgsl` would then be refused at preparation on those
    runtimes. The release policy must bind the new archive.
- **Manifest and Capsule.** The chosen manifest (`69dfcc4a` for the sliced head norms, or `b696fb91`)
  needs:
  - a new program bundle, with a closure without `rmsnorm_paired.wgsl` for `69dfcc4a`;
  - a new initial execution identity (the steps change the graph);
  - Rig signing, which now checks the head-norm declaration itself;
  - a new release event.
- **Qualification on every GPU that serves a stage.**
  - Not run here: the mac-host browser (Chrome/Metal), placement captures, preparation timing and
    installed journeys.
  - Doppler's Metal physical test `tests/kernels/paired-attention-physical.js` was updated to pass a
    declaring graph but not run, because the Mac GPU was in use by the placement C measurement.
- **Doppler checks failing before this change (unchanged by it).**
  - `public:boundaries:check`: npm package file budget 1999 > 1998, since the rolled state program (`77c5d9b2`).
  - `source:dependencies:check`: the dependency view is stale by one line in
    `tests/kernels/paired-linear-physical.js`.
  - Both need fixing before packaging.

The F16 cache dumps and scratch packages stay on amd-host under `/var/tmp/qk-norm-graph-20261015`.
