# Economics estimate register, 2026-10-15

**Decision supported:** what must be measured and improved to make the service economical.
**Decision not supported:** that Reploid is economical, that a tariff/reward is approved,
or that these scenarios predict demand. Human review remains deferred; automated
assessment and instrumented technical experiments can proceed now.

Component: REP-13/REP-14 service economics. Intent preserved. Evidence: retained
installed timing, dated vendor price observations, explicit planning assumptions,
and offline accounting checks. Boundary effects: none on runtime, provider accounts,
funding authority, production prices or public release.

## Read and reproduce

- [Calculated tables](RESULTS.md): costs, contributor redemption, sensitivity and break-even rates.
- [Inputs](inputs.json): exact values, scenario names, price sources, dates and package identity.
- [Results](results.json): unrounded calculations, input SHA-256 and all sensitivity outputs.
- [Evidence manifest](evidence.json): hashes of the retained local reports used here.
- [Calculator](calculate.py) and [accounting checks](test_calculate.py).

From the Reploid root:

```sh
python3 artifacts/economics-estimate-20261015/calculate.py
python3 artifacts/economics-estimate-20261015/calculate.py --check
python3 artifacts/economics-estimate-20261015/test_calculate.py
```

Edit inputs, regenerate and commit the report together. Recheck vendor tariffs before
any pricing/funding decision, and replace assumptions after every relevant measured
campaign. No background process, paid request, GPU run or recurring task was started.

## What is measured

Final-10 pass 3, archive `3b132ee7…`, Qwen3.5-0.8B Q4K, placement C:

| Input | Retained observation | Scope |
|---|---:|---|
| Physical computers | 2 | Mac browser plus two AMD processes on one AMD GPU |
| Short request | 56 input, 100 output tokens | One fixture, not a representative task population |
| Complete answer | 147.8 s | Includes prompt, execution and route overhead |
| First token | 19.3 s | Same installed answer |
| Decode | 1.262 s/token | Not complete-service throughput |
| Browser full-model peer acquisition | 887 s | Separate seeding journey; not native-stage acquisition |
| Parallel AMD cold preparation | 90.7 s elapsed | Do not add both processes' overlapping times |
| AMD whole-model paired prefill/decode | 8.21 s / 286.5 ms | Separate same-precision local control |

Sources: [candidate](../faster-candidate-20261015/README.md),
[installed journey](../faster-candidate-20261015/journeys/README.md).
No route wall-power measurement, utilization distribution, production failure rate,
representative quality rate, actual hardware cost or operator-cost receipt is available
in these reports. The older `public-costs.json` records latency, not dollars or energy.

The user's $20/M at 300 W and $30/M at 450 W are arithmetically correct for
continuous decode at 1.2 s/token and $0.20/kWh. They are hypothetical power cases,
not measurements. Placement C has two physical machines, not three. A repeated
147.8-second/100-token answer produces at most about 2,436 output tokens per busy
hour before startup, idle time and failed answers, versus 3,000 for decode alone.
Do not multiply this capacity by two merely because two conversations are allowed.

## Planning inputs and replacement obligations

These are transparent budgeting envelopes, not confidence intervals or statistically
fitted forecasts. The base case is a working hypothesis. Low cost combines favorable
conditions; stress combines adverse conditions and is not a predicted bill.
All watts apply to the combined two-host route, excluding the separate network allowance.

| Input | Low / base / stress | Rationale and measurement needed | Owner |
|---|---|---|---|
| Active incremental power | 80 / 180 / 300 W | Broad two-host sensitivity; synchronized wall meters with/without service under matched foreground load. TDP is not wall power. | Runtime measurement |
| Idle incremental power | 10 / 25 / 50 W | Prepared residency above the no-service baseline; measure sleep versus retained readiness. | Native host |
| No-service baseline power | 30 / 60 / 100 W | Assumed combined baseline; gross energy adds this once. Meter actual counterfactual. | Runtime measurement |
| Network increment | 2 / 5 / 10 W | Allocated networking estimate; WAN energy coverage remains unknown. | Transport measurement |
| Cooling multiplier | 1.00 / 1.10 / 1.25 | Explicit extra overhead; replace with measured allocation. Baseline cooling uses same approximation. | Fleet operator |
| Electricity | $0.12 / $0.20 / $0.35 per kWh | Tariff sensitivity, not either host's bill. EIA 2025 US residential reference is $0.173. Obtain marginal all-in local tariff. | Fleet operator |
| Busy fraction after startup | 75% / 40% / 15% | Demand assumption, not measured saturation; record idle and admission/rejection windows. | Scheduling |
| On-time completion | 98% / 95% / 85% | Assumed fraction of attempts; retain timeouts, loss and retries. | Chat execution |
| Quality among on-time answers | 90% / 65% / 42.5% | Assumed automated pass fraction. 42.5% echoes the diagnostic 17/40 only, not a population estimate. Calibrate on frozen tasks. | Automated evaluation |
| Unsuccessful attempt duration | 0.5x / 1x / 1.5x retained answer | Some fail early, others time out. Measure all attempts; this can exceed the range. | Chat execution |
| Additional opening overhead | 5 / 20 / 60 s per night | Acquisition excluded; opening cost outside the retained compiler timing is unmeasured. | Host preparation |
| Full acquisition / reuse | 0 / 887 / 1,774 s, reused 30 / 7 / 1 nights | Cache hit / retained browser-seeding duration / twice that duration for 1.16 GB, amortized; a budgeting proxy, not measured native acquisition; real bounded-piece and full-seeding paths differ. Measure bytes, verification, retries and cache hits. | Custody |
| Transfer per attempt | 2 / 10 / 50 MB | Budget allowance for activations, control and settlement; replace with byte counters, including retries. | Transport |
| Egress charge | $0 / $0.02 / $0.09 per GB | Planning rates, not actual household/server bills; zero means unmetered marginal dollars, not zero resources. | Fleet/operator |
| Hardware value allocated | $1,500 / $3,500 / $6,000 combined | Sensitivity, not a quote or purchase recommendation; inventory purchase/current-use value. | Fleet operator |
| Useful life / service share | 5 / 4 / 3 years; 25% / 50% / 100% | Straight-line calendar allocation over 8 hours. Record opportunity cost; sunk purchase cost does not imply free replacement. | Economics |
| Platform per month | $30 / $75 / $200 | One nightly route pays all fixed costs across 30 nights. Includes auth/DB/hosting budget; not proof this covers traffic. Actual bills replace it. | Service operator |
| Recurring operation time | 0.5 / 3 / 10 min per night | Maintenance time, not human answer judging or an engineering timeline. Record actual interventions. | Service operator |
| Operation labor rate | $25 / $50 / $100 per hour | Explicit opportunity-cost assumption, not a wage quote. | Economics |
| Automated review | 500/50, 1,500/150, 4,000/500 input/output tokens | One paid check per attempt using the three sourced API tiers; validate reviewer accuracy and token use. Local checking also consumes capacity. | Evaluation |
| Paid share of satisfactory answers | 80% / 50% / 20% | Earned and Community answers generate no new cash on redemption. Demand/mix unmeasured. | Economics |
| Refund/dispute/abuse reserve | 0.5% / 2% / 5% of gross revenue | Planning reserve, not observed losses; avoid counting the same actual refund twice. | Ledger/payment |
| Reward | Marginal contributor cost + 20% | Sensitivity only, not approved offer or conversion. Includes contracted readiness only if validly requested and proven. | Reward policy |
| Alternative SearXNG hosting | $5 / $20 / $50 monthly | Additional planning budget instead of Brave query fees, not a provider quote. Measure hosting, blocking/retries and maintenance; avoid adding it twice to platform bills. | Search integration |
| Credit-to-service conversion | Unset | Report USD-equivalent service value, not credit counts or cash redemption. Requires explicit policy. | Product owner |

Changing one base input at a time is recorded in RESULTS.md; combined scenarios
must not be mistaken for identifying a single causal factor.

## Accounting model

Let H be the eight-hour window, S startup hours, u the busy fraction, t the
complete-answer time, p the product of on-time fraction and conditional quality
pass fraction, and f the unsuccessful-attempt duration ratio:

```
attempts = (H - S) * u * 3600 / (t * (p + (1-p)*f))
A = attempts * p
E_incremental = cooling * ((busy+S)*P_active + idle*P_idle + H*P_network) / 1000
E_gross = E_incremental + cooling * H*P_baseline / 1000
C_resource = (electricity + bandwidth + hardware allocation
              + platform + operating labor + evaluation) / A
```

The main cost view uses incremental electricity; the results also show the
gross-energy boundary to expose baseline allocation sensitivity. Neither is
measured power, and shared-machine baselines require careful allocation.

A is an expected fractional count for a repeated scenario, not a claim that a
fraction of an answer was delivered. Failed work is already inside attempt time,
energy, bandwidth and review. Do not add an extra F for those same costs.
Zero satisfactory answers makes unit cost undefined, never zero.

Three accounts must reconcile:

- **Contributor:** incremental energy/bandwidth and separately allocated hardware
  cost; reward is received service value. No contributor profit or redemption is
  proven merely by issuing credits.
- **Operator:** reward obligation plus operator-owned hosting, review and labor.
  Do not add contributor electricity again if reward already compensates it.
- **Consolidated service:** underlying contributor and operator costs. Internal
  reward transfers cancel. Payment fees paid outside the service remain a cost.

The all-paid price divides operator obligations by accepted answers and by
`1 - payment_fee_fraction - loss_reserve_fraction`. The mixed-access price also
divides by the paid share. At a $10 US domestic-card top-up, Stripe's standard
fee is $0.59, or 5.9%; this is spread across the top-up's redemptions, not charged
once per answer. The separate loss reserve is not automatically a realized cost.

Operator figures are **USD-equivalent funding requirements**, not a cash-flow
forecast: actual rewards are noncash service obligations. Track cash expenses,
unredeemed balances, future redemption capacity and realized consumption separately.
The displayed reward/redemption ratio uses the all-paid unit-price reference;
it is not a steady-state proof that earning customers can all redeem tomorrow.
If earned/community traffic replaces paying demand, use the mixed-access result
and prove the funding source. The displayed $0.10 price is hypothetical, not policy.

The overnight figures cover the **whole route**, not one participant's personal
reward. Allocation among the Mac owner, AMD owner and any storage/delivery
providers is unmeasured and must not be inferred from stage count.

## External prices and alternative paths

Prices checked 2026-10-15, retained as numeric facts in inputs.json:

- [Brave Search](https://brave.com/search/api/): $5/1,000 queries and $5 monthly
  credit. One query costs $0.005 before fetching, larger prompts or semantic checks.
  Do not subtract the limited credit when claiming recurring advantage.
- [Supabase](https://supabase.com/pricing): Pro starts at $25/month; not the entire
  service infrastructure budget. Existing-account marginal charges may differ.
- [Stripe](https://stripe.com/pricing): US standard domestic-card charges above;
  international/FX/disputes can add charges. No payment was made.
- [Together](https://www.together.ai/pricing): Qwen3.5 9B $0.17/$0.25,
  Qwen3.7-Plus $0.32/$1.28, Qwen3.5-397B-A17B $0.60/$3.60 per million uncached
  input/output tokens. None has been tested here for equivalent task quality,
  deadline or disclosure terms. API price says nothing about provider energy.
- [EIA](https://www.eia.gov/energyexplained/electricity/prices-and-factors-affecting-prices.php):
  2025 US residential average 17.30 cents/kWh, used only as a sanity reference.

The cheapest listed token bill for 56 input/100 output tokens is $0.00003452.
That is a serious price comparator to test, not proof that it is the best
acceptable service. Match whole-answer quality, latency, availability and permissions,
include API input/search/review charges, and retain unfavorable comparisons.
No matching public hosted price for this exact Q4K runtime is established.

A same-precision **whole model on AMD** is an important local control: measured
8.21-second prefill plus 100 x 286.5-ms decode implies about 36.86 seconds.
It is an extrapolated source-control answer, not an installed service receipt.
Measure its actual whole-answer latency, power and costs alongside the partitioned
route. A model that fits one host need not be partitioned for ordinary service;
this control does not replace the separate large-model distributed proof.

SearXNG stays an alternative: the table models a $5/$20/$50 monthly additional
hosting allowance, not a quoted service price. It excludes search maintenance,
rate-limit failures and extra checking, so it is a hosting-only floor. A Node
adapter is a way to access a permitted source, not itself a free search index;
its hosting, upstream terms and fetch costs still need measurement. No-paid-API
search is not assumed to have zero cost or the same reliability as Brave.

Search, larger-model service and long contexts cannot inherit the short fixture's
cost estimate. The 1,588-token concurrency workload failed; its costs count but
it contributes no on-time answer under that workload's deadline.

## Four earning categories

| Category | Estimate basis now | What must be measured before setting a reward |
|---|---|---|
| Demanded computation | Route-window scenarios above | Per-device cost allocation, accepted work, reliable redemption capacity |
| Useful delivery | $0/$0.02/$0.09 per marginal GB scenario, plus verification/CPU cost currently unmeasured | Requested unique bytes, acquirer receipts, retries, actual egress and energy |
| Contracted storage | No defensible absolute rate yet | GB-hours, disk capacity/value/life, incremental keep-awake power, custody challenges, demand and delivery obligations |
| Prepared readiness | Base route idle increment alone: 25 W x $0.20/kWh = $0.005/hour before cooling/network/hardware | Real reserved slots, admission probes, idle baselines, preparation amortization, opportunity cost and utilization |

Do not promise income for capacity without demand or explicitly funded contracts.
Storage and delivery cannot automatically inherit inference reward rates. Input
unknowns remain marked unknown rather than invented tariff points.

## What these estimates currently imply

For a repeated short-answer pilot, the base case produces about 48 satisfactory
on-time answers in eight hours. Electricity is about $0.0034 per accepted answer;
resource cost with modeled payment fees is about $0.125. At 50% paid redemptions,
operator obligations imply about $0.240 per paid answer without subsidy. These are
conditional calculations, not pricing recommendations.

The marginal-cost-plus-20% reward gives the whole route about $0.218 of service
value, enough for about 1.82 answers at the all-paid reference price. It does not
cover the assumed hardware allocation. This is a warning to measure contributor
value, not an instruction to raise rewards: higher rewards also raise service
obligations and require funded demand or a lower underlying resource cost.

Low/base/stress resource cost spans roughly $0.011/$0.125/$3.67 per accepted
answer with modeled payment fees. The wide span reflects unknown utilization,
quality and operation costs. These numbers are not confidence bounds. No scenario
establishes a competitive advantage or a viable marketplace.

Next evidence under REP-13/REP-14:

1. Record actual hardware values/tariffs and simultaneous gross/baseline wall power
   for preparation, idle, successful work, failed work and networking coverage.
2. Run a frozen representative short workload with automated quality checks,
   deadlines, all-attempt timestamps, acquisition/network bytes and sustained demand.
3. Measure the whole-model AMD control and acceptable hosted alternatives on the
   same tasks; report unknown provider energy and mismatched permissions explicitly.
4. Join costs to validated work, funded rewards, durable balances and next-day
   redemption. Record paid/community/earned mix, outstanding liabilities and subsidy.
5. Replace assumptions, regenerate this register, and decide whether the measured
   advantage and contributor benefit justify expansion. Human experience review follows
   the working technical loop; no human judging blocks these measurements.

One-time development cost, taxes, detailed financing, jurisdiction-specific payment
charges, WAN provider energy, tail losses and demand elasticity are not quantified.
The results cover the listed recurring cost boundary only; they are not total
business profitability. Add observed costs rather than silently treating unknowns as zero.

## Verification retained

Four offline checks pass: the original $20/$30 illustration and 2.5-token/s
threshold; cancellation of internal rewards and reconciliation of fees/reserves;
zero-success and missed-deadline behavior; and failure-duration/paid-share sensitivity.
`calculate.py --check` reproduces the committed results from the input hash.
No application, GPU, provider or human-review acceptance is asserted.
