# Recurrent-state variant choice (2026-10-15)

**Question.** The combined paired kernels include a sliced recurrent-state program. Two forms exist:

- **unrolled (U):** `gated_delta_state_paired_sliced.wgsl`, pushed in Doppler `0f92176c`, with the
  eight per-lane state rows fully unrolled;
- **rolled (R):** the saved prototype `paired-kernel-optimization-20261014/prototypes/gated_delta_state_paired_sliced_rolled.wgsl`.
  It has the same arithmetic, dispatch and bindings, but its row loops run to a uniform row count. Doppler
  `77c5d9b2` adds it as a declared alternative: registry variant `paired_state_sliced_rolled`, and a
  manifest selects it through `mechanismKernels`.

The choice is made from full-model measurements on the preferred route's devices, with correctness
unchanged. Kernel-level timings are not used.

**Packages compared**, both with the Q/K head-norm declaration (manifest generation 2 or 3):

| Variant | Runtime archive | Manifest |
|---|---|---|
| U | `21d054ee...` (Doppler `1c9ec3db`) | `c6220c6a...` |
| R | `3b132ee7...` (Doppler `77c5d9b2`) | `548e6559...` (`c6220c6a` with `paired_state_sliced` replaced by `paired_state_sliced_rolled`) |

## Results

### Correctness (the gate), whole model

Both variants pass on both devices: 55/55 within 0.001, tokens 55/55, maximum 9.520e-07, and per-step
maxima identical. Stored F16 K/V, reported separately, is 12/12 identities equal to the approved F64
identities on both devices. Between the variants, 0 of 1,437,696 stored values differ.

- amd-host: [amd-host-whole-model/out/summary-v1.json](amd-host-whole-model/out/summary-v1.json)
- mac-host Chrome/Metal: [mac-host-whole-model/summary-v1.json](mac-host-whole-model/summary-v1.json)

### Prefill and decode, whole model, one session per device

| Device | Variant | Prompt 56 tok | Prompt 184 tok | Decode ms/token (median) | Ladder: 56 / 189 tok prompt, decode |
|---|---|---|---|---|---|
| amd-host (Node/Dawn) | U | 7.92 s | 26.40 s | 290.1 | 9.50 / 27.41 s, 296.2 ms |
| amd-host (Node/Dawn) | R | 8.21 s | 26.43 s | 286.5 | 9.46 / 26.75 s, 291.1 ms |
| mac-host (Chrome, Metal) | U | 26.77 s | 90.13 s | 738.4 | |
| mac-host (Chrome, Metal) | R | 26.60 s | 86.90 s | 732.5 | |

The differences are within run-to-run variation. Earlier U sessions measured 8.43-8.81 s, 26.97-27.51 s
and 284.7-285.8 ms on amd-host, and 26.48-27.35 s, 85.07-110.41 s and 736-746 ms on the Mac. Neither
variant is faster on any route device.

### Pipeline preparation, real resident opening path

Measured with `limits.maxPreparationMs` 1,200,000, the placement C policy. [prepare-measure.mjs](../placement-c/prepare-measure.mjs)
makes one load-only opening per stage with no token. On amd-host both stage processes ran **together**,
as in placement C ([measure-amd.sh](measure-amd.sh)):

- **cold:** a new empty private Mesa cache per native;
- **warm:** the same caches, in new processes.

On mac-host ([measure-mac.sh](measure-mac.sh)), stage 0 opened in a new persistent Chrome profile (cold),
then again in the same profile (warm).

| Stage | Variant | Cold preparation | Warm preparation | Cold scope memory peak | Warm scope memory peak | Device allocation peak |
|---|---|---|---|---|---|---|
| amd stage 1 (21 pipelines) | U | 111.5 s | 0.19 s | 5.94 GB | 0.80 GB | 113,881,408 |
| amd stage 1 | R | **97.3 s** | 0.19 s | 7.10 GB | 0.80 GB | 113,881,408 |
| amd stage 2 (23 pipelines) | U | 110.8 s | 0.16 s | 6.53 GB | 0.80 GB | 256,948,544 |
| amd stage 2 | R | **97.1 s** | 0.19 s | 7.18 GB | 0.48 GB | 256,948,544 |
| mac stage 0 (23 pipelines) | U | 0.10 s | 0.03 s | Chrome 1.87 GB RSS | 2.06 GB | 622,440,768 |
| mac stage 0 | R | 0.08 s | 0.02 s | Chrome 1.82 GB RSS | 2.21 GB | 622,440,768 |

Reading the table:

- **Memory peaks** are cgroup `memory.peak` for the natives, including the private shader cache's page
  cache, and the summed RSS of the profile's Chrome processes on the Mac. The peaks stayed under the 10 GiB
  scope pressure limit. The R cold peaks are about 1.2 GB higher, from the overlap of concurrent pipeline
  compiles, and are not lower as the state program alone suggested.
- **Opening wall time** (load plus preparation): amd 170 s cold for both U and R stages, 155-159 s for R;
  5-17 s warm; Mac 5.0-5.4 s.
- **The Mac's "cold"** means a new Chrome profile. Chrome's own pipeline creation returned in under 0.1 s
  in every case, and the macOS Metal system cache is not controlled here.
- **Intel** is not on the preferred route; its side measurement is in [../intel-compile/](../intel-compile/).
  It used a private Mesa cache under the i915 guard, and the i915 count stayed at 54.
  - U's state program alone did not finish a cold compile within the 1,800 s scope cap (32 min CPU). A second
    run against the same private cache was stopped at 957 s, and the shared cache was never used.
  - R's took 38.6 s cold and 0.05 s warm.
  - The shipped state program took 19.8 s cold.

## Choice: rolled (R)

- **Answer latency:** equal within measured variation on both route devices, for prefill and decode.
- **Preparation:** R is no worse anywhere and better cold.
  - On amd-host, a cold stage prepares in 97 s instead of 111 s, both stages together.
  - Warm preparation is equal at about 0.2 s.
  - On Intel, U cannot be prepared cold within a 30-minute bound at all; R can.
- **Correctness:** identical. Both pass the gate (55/55), and the stored K/V is bit-identical.

**No weighting.** The choice does not depend on an assumed reuse or replacement frequency. R is no worse
on latency or warm preparation and better on cold preparation, so it is preferred whether stages are
reused for days or replaced every few minutes. More frequent replacement only enlarges R's advantage:
about 14 s per cold AMD stage, and Intel becomes usable at all.

**The one measured cost** is the higher transient cold-preparation memory, about 1.2 GB per native. It is
inside the bounds, and the host had about 50 GB available ([../placement-c/README.md](../placement-c/README.md)).

## Consequence

The package changes, so the delivery was rebuilt and every affected step rerun on the exact bytes:

1. the runtime archive `3b132ee7...` and manifest `548e6559...`;
2. placement C qualification `c4`;
3. Capsule generation 3 at release sequence 9;
4. final-10 pass 3 with its install;
5. the installed journeys and performance on that delivery.

The U evidence is retained: numerical sessions n1/n2/m1/m2, placement C `c3`, Capsule generation 2 at
sequence 8, final-10 pass 2 and run-8 attempt b.
