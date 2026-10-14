# Intel GPU engine reset during a Doppler bench (2026-10-14)

Component: physical-host evidence. Intent preserved. Boundary effects: one owned diagnostic
process on `intel-host` lost its GPU device; the i915 driver reset the render engine.

## What ran

While investigating why the ordered route's Intel stage takes about 2.7 s per generated token,
the coordinator ran `doppler bench` (installed `doppler-gpu` 0.6.28 from the final-5 native
package, Dawn `webgpu` 0.4.0 provider) four times on `intel-host` against the qualified model
directory `/var/tmp/doppler-cold-compile-model-20261013`. Each run was a bounded user scope
(`dis-bench-full-1` to `dis-bench-full-4`: 10 GiB high, 12 GiB max, zero swap, runtime cap).

| Run | Runtime config | Outcome |
|-----|----------------|---------|
| 1 | none | `createPipeline` refused: paired attention requires its declared component and KV representation |
| 2 | `intermediatePrecision: two-f32` | refused: paired execution also requires two-F32 recurrent state |
| 3 | plus `linearRecurrentStatePrecision: two-f32` | pipeline created; harness refused for want of a prompt |
| 4 | plus a one-sentence prompt, `maxTokens` 32, temperature 0 | the GPU work timed out, the engine was reset and the device was lost |

Files: `bench-full-N.json` (command result), `bench-full-N.err` (stderr; run 4 compressed),
`kernel-journal.txt` (every i915 kernel line from 07:50 to 08:10 local time, plus the engine's
`preempt_timeout_ms` 7500 and `heartbeat_interval_ms` 2500, kernel and device).

## What happened

From 08:03:08 the kernel logged repeated `Fence expiration time out` for the bench process. At
08:03:56 it logged `Resetting rcs0 for preemption time out` and `context reset due to GPU hang`,
followed by `GPU HANG: ecode 12:1:85dcfffb`. The bench reported `Batch decode failed, falling back
to single-token: Device not initialized` and then `GPU device not available`. Run 4 used the bench
harness's batched decode path (manifest `decodeLoop.batchSize` 4), not the resident partition path
the application uses.

No i915 fence timeout or reset appears for the journey runs' native processes (runs 5 and 6), and
none appeared after 08:04 when checked at 08:21.

## Shared-machine effect

`rcs0` is the render engine every GPU context on the machine uses, so an engine reset can disturb
other contexts with work in flight. Two public contributors run on `intel-host` (a native
participant and a browser contributor). The coordinator did not touch them. Their logs' most recent
state lines read `ready` with no error, but the logs carry no timestamps. They therefore neither
confirm nor exclude an effect at 08:03:56. Before the runs, the GPU's actual frequency read 0 MHz
(idle) in five one-second samples.

## Consequence

No further full-model bench runs on `intel-host`. Physical measurement there uses predefined
prompt, duration and memory bounds and stops on any new i915 fence timeout, hang or reset.
The kernels involved use two-F32 compensated arithmetic with integer-based residual calculations.
The cause of the long-running GPU work (which submission exceeded the 7.5 s preemption timeout)
is not established here.
