# Intel recurrent-state compile cost: bounded side measurement (not a gate)

The measurement ran on intel-host (Mesa 24.2.8 ANV, Gen12LP) through Node/Dawn `webgpu` 0.4.0.

- **Tool:** `compile-cost.mjs`, unchanged from paired-kernel-optimization-20261014. It times shader-module
  plus compute-pipeline creation of one program, with the process high-water mark.
- **Bounds:** one bounded scope per job (10 GiB high, 12 GiB max, zero swap, 1,800 s cap, core dumps on).
- **Cache:** every job used a **private** Mesa cache (`MESA_SHADER_CACHE_DIR` under
  `/var/tmp/faster-candidate-20261015-intel`), never the shared one. An interrupted compile therefore could
  not leave a NIR-only entry in the shared cache (native-crash-20261014). Cold means a new empty private
  cache; warm means the same cache again.
- **Guard:** [guard.sh](guard.sh) polled the kernel journal every 5 s against the i915 baseline of 54. The
  count stayed at 54 throughout ([guard.log](guard.log)).

| Program | Cold | Warm | Process high-water increase |
|---|---|---|---|
| Shipped `gated_delta_state_paired` (WG 128) | 19.8 s | 0.018 s | +1.10 GiB cold |
| Sliced, unrolled `gated_delta_state_paired_sliced` (K_SLICES 16) | **did not finish** in 1,800 s (32 min CPU); the scope cap ended it, so `fc-intel-state-sliced-cold.scope` shows as failed (timeout) | not measured: the cold entry never completed. The "warm" job recompiled from scratch, reached 10.8 GB RSS (throttled at the 10 GiB limit) and was stopped at 957 s | n/a |
| Sliced, rolled `gated_delta_state_paired_sliced_rolled` (K_SLICES 16) | **38.6 s** | 0.046 s | +1.47 GiB cold |

The unrolled program cannot be prepared on this Intel host within a 30-minute bound; the rolled one can.
A whole Intel stage's preparation (21-23 pipelines) was not measured, and placement B was not run on this
candidate. Logs: `session-1.log`, `session-2.log`, `out-*.log`. The runners are [run-intel.sh](run-intel.sh)
and [run-intel-2.sh](run-intel-2.sh).
