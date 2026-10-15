# Calculated estimates

Generated from `inputs.json` by `calculate.py`. USD; all power and operating scenarios are assumptions, not measured economics.

| Per eight-hour route window | Low cost | Base | Stress |
|---|---:|---:|---:|
| Attempted answers | 154.79045 | 77.30064 | 20.67292 |
| Satisfactory, on-time answers (assumed rates) | 136.52518 | 47.73314 | 7.46809 |
| Incremental kWh | 0.51647 | 0.81635 | 1.11701 |
| Gross kWh | 0.75647 | 1.34435 | 2.11701 |
| Electricity / satisfactory answer, USD | 0.00045 | 0.00342 | 0.05235 |
| Complete resource cost / satisfactory answer before payment fees, USD | 0.00992 | 0.11802 | 3.45939 |
| Complete resource cost / satisfactory answer with modeled payment fees, USD | 0.01052 | 0.12509 | 3.67331 |
| Gross-energy-boundary resource cost before payment fees, USD/answer | 0.01013 | 0.12023 | 3.50625 |
| All-paid break-even / satisfactory answer, USD-equivalent | 0.01016 | 0.11988 | 3.62578 |
| Paid fraction (assumed) | 0.80000 | 0.50000 | 0.20000 |
| Break-even price / paid answer with mixed access, USD-equivalent | 0.01269 | 0.23977 | 18.12892 |
| Unfunded night at $0.10 / paid answer and mixed access, USD-equivalent | 0.00000 | 3.07229 | 23.99314 |
| Night reward, USD-equivalent service value | 0.07437 | 0.21845 | 0.70606 |
| Contributor surplus after hardware allocation, USD-equivalent | -0.05610 | -0.36313 | -1.70881 |
| Answers that night reward could buy at modeled break-even price | 7.32294 | 1.82219 | 0.19473 |
| One Brave search query add-on / satisfactory answer, USD | 0.00567 | 0.00810 | 0.01384 |
| Alternative SearXNG hosting-only add-on / satisfactory answer, USD | 0.00122 | 0.01397 | 0.22317 |

Search add-ons exclude extra context processing, page fetches and additional semantic checks. The short 56-token fixture does not qualify search workloads. No subsidy or free credit is deducted. Reward is service value, not cash or an approved credit conversion.

| Cost per night, USD | Low cost | Base | Stress |
|---|---:|---:|---:|
| electricity | 0.06198 | 0.16327 | 0.39095 |
| bandwidth | 0.00000 | 0.01877 | 0.19743 |
| hardware_allocation | 0.06849 | 0.39954 | 1.82648 |
| operator_labor | 0.20833 | 2.50000 | 16.66667 |
| platform | 1.00000 | 2.50000 | 6.66667 |
| automated_review | 0.01509 | 0.05195 | 0.08683 |

## API price references

Different models, untested quality/latency/permissions. These are raw token charges only, not equivalent-service proof.

| Model | Input USD/M | Output USD/M | 56 input + 100 output, USD |
|---|---:|---:|---:|
| Qwen3.5 9B | 0.17 | 0.25 | 0.00003452 |
| Qwen3.7-Plus | 0.32 | 1.28 | 0.00014592 |
| Qwen3.5-397B-A17B | 0.6 | 3.6 | 0.00039360 |

Source: [Together pricing](https://www.together.ai/pricing), checked 2026-10-15. Input, search and review costs must also be counted.

## Sensitivity around base

| Changed input only | Value | Complete cost / accepted answer, before payment fees (USD) |
|---|---:|---:|
| utilization | 0.1 | 0.46105 |
| utilization | 0.4 | 0.11802 |
| utilization | 0.8 | 0.06085 |
| utilization | 1 | 0.04942 |
| quality_pass_fraction | 0.425 | 0.18050 |
| quality_pass_fraction | 0.65 | 0.11802 |
| quality_pass_fraction | 0.9 | 0.08524 |
| quality_pass_fraction | 1 | 0.07671 |
| active_incremental_w | 80 | 0.11653 |
| active_incremental_w | 180 | 0.11802 |
| active_incremental_w | 300 | 0.11981 |
| operator_minutes_night | 0 | 0.06565 |
| operator_minutes_night | 3 | 0.11802 |
| operator_minutes_night | 10 | 0.24023 |

## Decode-only energy break-even

At $0.20/kWh, 100% busy decode and no prefill, failures, idle or other costs. Strictly exceed these rates to beat the price on electricity alone.

| Route watts | Alternative USD/M output tokens | Required output tokens/s |
|---|---:|---:|
| 80 | 0.25 | 17.778 |
| 80 | 1.28 | 3.472 |
| 80 | 3.6 | 1.235 |
| 80 | 10 | 0.444 |
| 180 | 0.25 | 40.000 |
| 180 | 1.28 | 7.812 |
| 180 | 3.6 | 2.778 |
| 180 | 10 | 1.000 |
| 300 | 0.25 | 66.667 |
| 300 | 1.28 | 13.021 |
| 300 | 3.6 | 4.630 |
| 300 | 10 | 1.667 |
| 450 | 0.25 | 100.000 |
| 450 | 1.28 | 19.531 |
| 450 | 3.6 | 6.944 |
| 450 | 10 | 2.500 |

AMD-only same-precision short-answer estimate: **36.86 seconds**, summing measured whole-model prefill and 100 decode steps. This is not an installed application measurement. Qualification of that service path remains necessary.

## Rental comparison

On-demand rates checked 2026-10-15. No cloud inference was benchmarked. Accepted-answer rates are sensitivity inputs, including idle, startup and failed work per billed hour. Instance availability and NVIDIA correctness remain unqualified.

| Instance | GPU GB | USD/hour | USD/8 hours | USD/730 hours |
|---|---:|---:|---:|---:|
| Lambda Quadro RTX 6000 | 24 | 0.6900 | 5.52 | 503.70 |
| Lambda A6000 | 48 | 1.0900 | 8.72 | 795.70 |
| Lambda A10 | 24 | 1.2900 | 10.32 | 941.70 |
| Google g2-standard-4 / L4 | 24 | 0.7068 | 5.65 | 515.99 |

[Lambda list prices](https://lambda.ai/instances); [Google accelerator pricing](https://cloud.google.com/products/compute/pricing/accelerator-optimized?hl=en). Google rate requires regional requote; disk/egress separate. Tax excluded.

Comparable service boundary: add the same base platform/labor allocation ($0.625/hour), the same assumed review cost per accepted answer, and an assumed $0.02/hour disk/network allowance. Excludes payment fees, search, tax and one-time setup on both sides. Does not add electricity or hardware depreciation on top of rental.

| Instance | At 6 accepted/hour | At 25 accepted/hour | At 100 accepted/hour | Accepted/hour needed to beat Reploid base |
|---|---:|---:|---:|---:|
| Lambda Quadro RTX 6000 | $0.2236 | $0.0545 | $0.0144 | 11.42 |
| Lambda A6000 | $0.2903 | $0.0705 | $0.0184 | 14.84 |
| Lambda A10 | $0.3236 | $0.0785 | $0.0204 | 16.55 |
| Google g2-standard-4 / L4 | $0.2264 | $0.0552 | $0.0146 | 11.56 |

Reploid base on this before-payment-fee boundary: $0.1180/accepted answer, at 5.97 accepted/hour. This is an estimate anchored to retained timings, not measured economic proof.

Read 25/hour as a condition to verify, not a cloud speed forecast. Higher GPU capacity does not guarantee demand. Startup, idle time, failed quality and deadlines must all be inside the observed accepted-per-billed-hour denominator. No Spot discount, utilization gain or automatic batching gain is assumed.
