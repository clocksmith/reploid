# Numerical gate on every GPU that serves a stage (whole model)

**The gate (unchanged).** All 55 required prefixes are compared against the approved independent F64
reference (`approved-reference.json` `ad26dfbc...`, evaluator `90376dde...`). Every one of the 248,320
logits must be within 0.001 at every step, and every argmax must equal the reference token. The comparison
is copied unchanged from `substitution-check.mjs`.

**The regression check, reported separately.** After all 51 request-2 prefixes, the 12 full-attention
F16 K/V cache hashes must equal the approved identities ([approved-cache-identities.json](approved-cache-identities.json)).
Stored values are also compared one by one with the control.

**Where it ran.** On amd-host with [substitution-check.mjs](substitution-check.mjs) through Node/Dawn on
Vulkan, using the exact archive bytes extracted into a scratch package root ([setup-amd.sh](setup-amd.sh),
every member verified). On the mac-host browser with Chrome 155 on WebGPU/Metal, through
[browser-check.mjs](browser-check.mjs) and [browser-check-page.js](browser-check-page.js), the same
paired paths and comparison loop run in an owned headless Chrome page. Each check is one process with the
Capsule TargetPlan runtime configuration (`configs/paired-final.json`, identical to
`paired-control.json`). [summarize.py](summarize.py) is unchanged from the kernel work.

| Package (manifest) | GPU | 55-step gate | Max error | K/V identities | Stored values differing from the control | 56 / 184-tok prompt | Decode ms/token |
|---|---|---|---|---|---|---|---|
| Installed 0.6.28 `2df37d88` (Capsule `6b2cb026`), control | amd-host | 55/55, tokens 55/55 | 9.520e-07 | 12/12 | (control) | 17.04 / 56.82 s | 570.4 |
| Installed 0.6.28, control | mac-host Chrome/Metal | 55/55 | 9.520e-07 | 12/12 | (control) | 40.80 / 138.85 s | 1299.2 |
| `21d054ee` + `64d74719` (gen 1) | amd-host | 55/55 | 9.520e-07 | 12/12 | 0 | 8.81 / 27.51 s | 284.7 |
| `21d054ee` + `64d74719` (gen 1) | mac-host | 55/55 | 9.520e-07 | 12/12 | 0 | 27.35 / 85.07 s | 746.1 |
| `21d054ee` + `c6220c6a` (gen 2) | amd-host | 55/55 | 9.520e-07 | 12/12 | 0 | 8.43 / 26.97 s | 285.8 |
| `21d054ee` + `c6220c6a` (gen 2) | mac-host | 55/55 | 9.520e-07 | 12/12 | 0 | 26.48 / 110.41 s | 736.2 |
| **`3b132ee7` + `548e6559` (gen 3, frozen)** | **amd-host** | **55/55** | **9.520e-07** | **12/12** | **0** | 8.21 / 26.43 s | 286.5 |
| **`3b132ee7` + `548e6559` (gen 3, frozen)** | **mac-host** | **55/55** | **9.520e-07** | **12/12** | **0** | 26.60 / 86.90 s | 732.5 |

Notes on the table:

- **Per-request maxima** are identical in every row: 8.40e-07, 8.90e-07 and 9.52e-07. Per-step maxima
  equal the installed control's at every step.
- **Generation 3 rows** are session v1 in [../variant-choice](../variant-choice/README.md), beside the
  generation-2 rerun in the same session.
- **Other measurements on amd-host,** in the same sessions as the checks: the speed ladder
  (`out/*-unsplit.json`), the GPU profile (`out/*-profile.json`) and the GPU pool peak (`out/*-memory.json`).
  - The 56- and 189-token turns took 8.73 / 28.03 s against 17.14 / 57.94 s.
  - Decode took 288.6 ms against 601.9 ms per token.
  - GPU time per decode step was 215.5 ms against 453.4 ms.
  - The pool peak was 1,002,913,536 bytes in every case.

Sessions: amd-host `amd-host/session-n1.log`, `session-n2.log`, plus `../variant-choice/amd-host-whole-model`.
The amdgpu error count stayed at 50 before and after every job. Mac reports are in `mac-host/`. The F16
dumps stay on the hosts.
