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

## Strongest hosted alternative and component sizes (added 2026-10-15)

**Hosted API price, unverified against the provider.** A third-party aggregator
([anotherwrapper](https://anotherwrapper.com/llm-pricing/qwen3.8-flash-next)) lists
Qwen3.8-Flash-Next at $0.15 per million input tokens and $0.47 per million output
tokens, attributed to Qwen Cloud; the official page was not opened. If confirmed, a
100-token answer costs about $0.00005 in output tokens. This is the price to beat,
not a provider energy measurement.

**Illustrative electricity-only break-even (assumptions, nothing measured).** A host
drawing P watts at tariff T dollars/kWh and producing R output tokens/s at full
utilization spends P x T / (3.6 x R) dollars per million output tokens on
electricity alone. At an assumed 150 W and $0.15/kWh that is 6.25 / R, so matching
$0.47 needs about 13 tokens/s per host before hardware, idle residency, preparation,
networking, failures and compensation. The current partitioned 0.8B route decodes at
about 0.8 tokens/s.

**Where the bytes are (from the pinned `config.json` and safetensors index, 360.0 GB
bf16 total).** Routed experts: 48 layers x 512 experts x 3 matrices x 2560 x 640 =
120.8B parameters (about 242 GB bf16, about 60 GB at four bits); 10 experts per token
per layer, so roughly 2% of them are read per token. The n-gram embedding (layer 1
PLE, 128 shards; the model card's 51B parameters, about 102 GB bf16) is a row
lookup: a token reads kilobytes of it. The dense remainder (attention, shared
experts, embeddings, LM head, MTP) is about 16 GB bf16. Weights-only arithmetic; no
package exists.

**One large-memory host.** amd-host is a Strix Halo APU with 128 GB unified memory;
its GPU currently addresses a 0.5 GB VRAM carve-out plus 65.9 GB GTT. Four-bit
experts plus the dense part fit near that GTT limit if the n-gram table stays in
host memory, as NVIDIA's recipe does. Raising GTT needs administrator kernel
settings. Whether one such host serves Flash-Next alone, without collective memory,
is the first question to answer before claiming the collective-memory cell.

**License.** Qwen Community License 1.0, clause 2: a licensee conducting a Model as
a Service or AI Work Assistant business needs a separate Qwen license for commercial
use ([Doppler preparation notes](https://github.com/clocksmith/doppler/blob/main/artifacts/qwen38-flash-next-20261013/README.md)).
This applies to a Reploid service as much as to a hosted competitor.

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
