# Efficiency evidence, 2026-10-15

Economics remain unproved. This investigation identifies measured improvements,
diagnostic bottlenecks and conditional opportunities. It does not change the
runtime, qualify a release, authorize a purchase or establish commercial rates.

[Flash-Next follow-up](FLASH-NEXT.md) records the model-memory distinction,
alternative rental candidates and a read-only Intel recovery observation.

## Findings and useful next experiments

| Opportunity | Evidence | Proof still needed |
|---|---|---|
| Keep the faster paired kernels | Retained AMD full-model decode fell from 570.4 to 286.5 ms/token; 56-token prefill fell from 17.04 to 8.21 seconds. Approximately 2x, with the unchanged numerical gate. | Preserve this gain in each installed configuration; source speed alone is not service throughput. |
| Execute the small model entirely on AMD when eligible | Its paired full-model timings imply 8.21 + 100 x 0.2865 = 36.86 seconds, versus the retained 147.8-second installed answer. | Same installed request, permissions, precision, prompt and output on the whole-model path; repeat with preparation and concurrent demand included. The 4.01x ratio is an opportunity estimate, not a measured installed gain. |
| Avoid sending intermediate results back through the Mac between stages on the same AMD machine | The diagnostic protocol has eight one-way message crossings for the intermediate AMD stage and four for the final stage. Transfer/delivery occupies 23–79% of mean decode across the six diagnostic turns. | Compare a contiguous AMD partition or authorized local forwarding with the current coordinator path. Preserve recipient authorization, ownership, cancellation and settlement. Transfer includes event-loop delivery; it is not exclusively wire latency. |
| Reuse preparation when demand justifies it | Retained saved-state variant opening takes roughly 155–159 seconds cold versus 5–17 seconds warm on AMD; pipeline creation alone is about 97 seconds cold versus 0.19 warm. | Meter complete preparation and residency. Keeping a stage warm wins only when avoided preparation exceeds its idle cost over the idle interval. Otherwise let it sleep. |
| Admit workloads that can finish; measure wasted attempts | Long workloads have exhausted installed deadlines. Their execution consumes resources without producing an on-time answer. | Predict admission from prompt, output cap, queue and measured route envelope; record rejection separately from service availability. Do not inflate success by silently excluding difficult demand. |
| Improve satisfactory answers per attempt | Token throughput does not account for incorrect additions or unsupported citations. | Freeze separate automated whole-answer policies for questions, summaries and retrieval; record reviewer errors and costs. Human experience review remains deferred. |

Serialization is only 4–6 ms per decode step in these traces, under 1% of total
time. Eliminating it cannot deliver a large improvement. Authorization occupies
67–95 ms; any reuse must remain bound to the authorized scope and revocation
semantics. Removing authorization is not an optimization candidate.

Whole-model remote service and the larger-than-one-device partitioned proof are
separate objectives. Prefer the cheapest qualified eligible route for a request;
do not require unnecessary sharding to demonstrate the network product.

## What was actually measured here

[component-power.json](component-power.json) contains five fresh read-only AMD
sensor samples, 50.062–55.028 W, with UTC timestamps. The workload was uncontrolled.
These are component readings, not wall power, idle-subtracted power or energy
attributable to Reploid. The two exposed channels overlap and must not be added.
The [Linux hwmon ABI](https://www.kernel.org/doc/html/v5.17/hwmon/sysfs-interface.html)
specifies microwatts. [read-component-power.py](read-component-power.py) reproduces
the read without launching workloads or changing hardware controls.

No cloud instance was rented, no GPU benchmark was launched, and no existing
campaign was stopped. No measured wall-power baseline is available in this packet.
The power assumptions in the estimate register (moved to the private economics register)
remain assumptions.

## Latency evidence and limits

[ANALYSIS.md](ANALYSIS.md) and [analysis.json](analysis.json) contain the calculated
breakdowns. [trace-extract.json](trace-extract.json) retains compact numeric inputs
and hashes of the originating files; it contains no conversation text or host
addresses. The originating placement-envelope diagnostics belonged to another
session and were uncommitted when extracted. They are provisional diagnostics,
not a new acceptance receipt. The originals were not modified or staged here.

The grouping uses means from the same steps, which reconcile to mean total time.
Execution boundaries include host work and waits, not exclusively GPU execution.
Small negative native residuals limit fine-grained interpretation. Probe 2's first
answer lacks prompt attribution and has one step error. Those limitations remain
in the extract. Sequential baseline/instrumented comparisons vary by 1.02–2.70x;
uncontrolled conditions prevent attributing that variation to tracing alone.

Committed controls: [faster-candidate results](../faster-candidate-20261015/README.md)
and [variant comparison](../faster-candidate-20261015/variant-choice/README.md).
The installed 147.8-second answer is historical, not a fresh control collected
alongside these diagnostics. No 4x speed or cost improvement is claimed.

## Correct economic proof obligation

For each declared workload and deadline, use:

`complete resource cost / satisfactory on-time answers`

Count electricity, hardware allocation, networking, cooling, validation and
operations once across all attempts, including preparation, idle periods,
failures and retries. A separate failure surcharge must not duplicate resources
already charged. Contributor rewards are expenses in the operator account and
income in the contributor account; internal payments cancel in consolidated
resource accounts. Keep service-credit liabilities and funded redemption distinct
from cash payments. With zero satisfactory answers, no finite favorable unit cost
can be claimed.

The illustrative 3,000 tokens/hour ignores prefill, preparation, idle demand and
failures. Placement C uses **two physical machines**, not three: the two AMD
stages share a host. Neither process count nor GPU TDP establishes wall power.

Compare both the actual paid service bill and the full resource accounts against
feasible alternatives. The rental comparison (private economics register)
records current Lambda/Google prices with hypothetical throughput clearly marked.
Measure accepted answers per **billed hour**, including unused rented time.
No cloud throughput has been measured for this exact workload and precision.

The $10/M-output-token illustration is not evidence of the best alternative.
The retained [Together price](https://www.together.ai/pricing) for Qwen3.5 9B gives
$0.00003452 for 56 input and 100 output tokens. If quality/deadlines and acceptance
rates were equal, electricity alone at $0.20/kWh would need active power below
4.20 W at 147.8 seconds, or 16.86 W at the derived 36.86 seconds. This is a
conditional necessary bound, not proven task equivalence or a prediction of
provider energy. Other costs tighten it. Recheck prices before a purchasing or
release decision.

## Controlled measurement contract

1. Freeze checkpoint, representation, precision, prompt/output workloads,
   sampling, context, permissions, deadlines and automated quality policy.
   Preserve all 55 numerical checks at 0.001. Report F16 cache identity separately.
2. Compare the installed whole-AMD path, current placement C and an eligible
   consolidated AMD partition. Keep unsupported configurations explicitly absent;
   do not substitute standalone timings for installed acceptance.
3. Use repeated interleaved controls and record foreground load, concurrency,
   network conditions, cold/warm cache state, preparation, prefill, decode,
   complete-answer latency, completion rate and all failures. Verify that timing
   instrumentation does not materially change the result.
4. Obtain synchronized Mac/AMD wall-meter readings and an explicit no-Reploid
   baseline. Integrate gross and incremental energy through preparation, active
   service, idle residency and cleanup. Report network/cooling coverage separately.
5. Replay a fixed arrival schedule, including overnight low demand. Divide costs
   by accepted on-time answers, not available token capacity. Model warm residency
   versus sleep from measured preparation energy and idle power.
6. Run the same workload on a feasible rented GPU only under an explicit spend
   budget; benchmark equivalent precision and separately assess task-equivalent
   alternatives. Include startup, disk, transfer, idle billing and verification.
7. Replace estimate inputs only with attributable observations. Record remaining
   assumptions and uncertainty. Demonstrate the earn/redeem loop without treating
   subsidies or issued credits as evidence of resource efficiency.

These obligations are REP-14 measurement work, not new release thresholds or an
independent roadmap. Human judging is not a dependency for these technical runs.

## Reproduction

`python3 artifacts/efficiency-evidence-20261015/analyze.py --check` verifies the
calculations against the committed compact extract without needing the original
large diagnostic files. `extract.py` is retained for provenance; rerunning it
requires those original files and may replace the extract with newer evidence.

Component: REP-14 economics evidence. Intent: preserved. Acceptance evidence:
offline calculation checks and the named retained artifacts; no new physical
qualification. Boundary effects: none on execution, accounting or permissions.
