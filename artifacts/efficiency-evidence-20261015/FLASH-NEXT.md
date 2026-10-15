# Flash-Next economics hypothesis and Intel recovery observation

Checked 2026-10-15. This extends the evidence register; it is not a qualified
Flash-Next run or authorization to rent hardware or restart another service.

## Memory-heavy service: plausible opportunity, unproved economics

The [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next) lists a 125B
backbone, 6B activated parameters, 51B n-gram embeddings and 4B MTP parameters.
Uniform four-bit encoding of the rounded 180B total is 90 GB decimal of raw
parameter bits. This is conditional arithmetic, not an actual converted package
size, measured residency requirement, or GPU-memory minimum. Quantization metadata,
unquantized tensors and execution state add space; component placement matters.
The [NVIDIA deployment recipe](https://docs.nvidia.com/dynamo/dev/recipes/qwen-3-8-flash-next)
places the n-gram table in host RAM. Offload capability and speed in Doppler remain
separate qualification questions.

The [Lambda instance table](https://lambda.ai/instances), checked on this date,
lists these single-GPU candidates, before tax:

| Instance | GPU memory | Listed host RAM | Hourly | 24 billed hours |
|---|---:|---:|---:|---:|
| B200 | 180 GB | 360 GiB | $6.99 | $167.76 |
| GH200 | 96 GB | 432 GiB | $2.29 | $54.96 |
| A6000 | 48 GB | 100 GiB | $1.09 | $26.16 |

These are price/capacity observations, not proof of availability, model fit,
supported offload or acceptable speed. The $6.69 B200 price elsewhere on the page
is per GPU in its eight-GPU tier, not the single-GPU instance price. Compare
qualified host-memory/offload configurations, rented capacity shut down between
bursts, and shared APIs as well as continuously rented large GPUs.

Intermittent demand is an opportunity only if existing resources provide useful
readiness cheaply enough. It also makes idle residency harder to amortize.
Measure preparation versus keeping weights resident; do not assume every machine
should stay awake. Account for hardware allocation and contributor disruption.

For the illustrative 300 W mesh and 1,500 W alternative over the same interval,
the mesh uses less energy per satisfactory on-time answer only if its accepted
answer count exceeds one fifth of the alternative's. Both powers must cover the
same system boundary, including idle and failures. Neither is measured here.
Lower requester charges do not establish this energy inequality.

Required comparison: one qualified large-memory machine, a nearby qualified mesh,
and the strongest feasible rental/API alternatives on the same frozen arrival
trace, task quality, context, deadline and permission constraints. The current
0.8B result neither proves nor disproves Flash-Next economics.

## Intel incident and read-only recovery observation

The retained [incident report](../intel-reliability-20261015/README.md) and its oomd
journal record a 09:58:48 EDT pressure event. It killed two tmux scopes, Zero's
supervisor, Chromium's contributor scope and the experimental scope; another
service also restarted. The experiment reached about 10.2 GB with only three
of 21 pipelines prepared. This is a failure of workload containment, not simply
a failed benchmark. The report was another session's uncommitted evidence at the
time of this review; its files were not modified or staged here.

Read-only observation on intel-host at **2026-10-15T15:25:15Z**:

- `zero-supervisor.service`: active/running, PID 1895170, one restart; current
  process started at 09:58:53 EDT. Trading health was not inspected.
- Native contributor process PID 297260 present; application readiness untested.
- No process with the `scripts/run-mesh-contributor.js` argument found.
- Memory PSI some/full avg10, avg60 and avg300 all zero. This shows recent
  pressure was absent at observation time, not that a repeat is safe.

No process was restarted, stopped or reconfigured. Do not repeat the cold compile
under the failed containment arrangement. Establish parent-slice OOM behavior,
total host headroom and a bounded isolation test before GPU preparation. Raising
limits or disabling oomd alone is not evidence of isolation. Recovery must include
the browser contributor and the owner workloads, not just the experiment.

Count failed compilation, recovery and disrupted service in the cost record;
their monetary and energy amounts are unknown here. They cannot be silently zero.
