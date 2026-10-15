# Efficiency evidence calculations

Provisional breakdowns, not a new qualified runtime or controlled A/B benchmark. Percentages use means from matching steps, never sums of medians. Transfer includes delivery scheduling, not just network propagation.

| Probe / turn | Answer seconds | Mean decode ms | Transfer/delivery ms (%) | Execution boundary ms | Authorization ms | Serialization ms |
|---|---:|---:|---:|---:|---:|---:|
| breakdown-1 / first-answer | 123.8 | 1046.1 | 239.5 (22.9%) | 636.8 | 87.5 | 5.2 |
| breakdown-1 / follow-up | 81.2 | 1326.1 | 613.3 (46.2%) | 501.0 | 67.0 | 5.0 |
| breakdown-1 / longest-answer | 254.5 | 1370.1 | 544.3 (39.7%) | 615.1 | 90.7 | 5.2 |
| breakdown-2 / first-answer | 440.5 | 3436.2 | 2703.8 (78.7%) | 530.0 | 92.2 | 4.9 |
| breakdown-2 / follow-up | 101.9 | 1529.6 | 762.7 (49.9%) | 533.6 | 94.9 | 5.9 |
| breakdown-2 / longest-answer | 491.2 | 2478.9 | 1772.8 (71.5%) | 489.0 | 90.5 | 4.0 |

Probe 2 first-answer has one step error and no prompt breakdown. Its decode observations remain diagnostic; no complete prompt attribution is claimed. Native host subtimings can contain small negative residuals; do not interpret every fine-grained category as independently measured.

| Sequential control pair / turn | Baseline seconds | Instrumented seconds | Ratio |
|---|---:|---:|---:|
| 1 / first-answer | 103.9 | 123.8 | 1.19 |
| 1 / follow-up | 62.8 | 81.2 | 1.29 |
| 1 / longest-answer | 171.5 | 254.5 | 1.48 |
| 2 / first-answer | 163.3 | 440.5 | 2.70 |
| 2 / follow-up | 92.4 | 101.9 | 1.10 |
| 2 / longest-answer | 483.5 | 491.2 | 1.02 |

These differences prevent claiming an isolated tracing overhead or a performance improvement from this sequence. Stabilize workload/network conditions and use repeated controls.

Whole AMD paired-model arithmetic: 8.21 + 100 x 0.2865 = **36.86 s**. Installed placement C: 147.8 s. The ratio **4.01x** is a cross-path opportunity estimate, not an installed improvement.

Retained paired kernel controls show **1.99x decode** and **2.08x 56-token prefill** improvement with the unchanged correctness gate.

## Conditional competitive power budget

At the retained Together Qwen3.5 9B raw price, 56 input/100 output tokens cost $0.00003452. Only if task quality and deadlines are equivalent, and both paths have equal acceptance rates:

- At 147.8 seconds/attempt, route active power must be below **4.20 W** at $0.20/kWh to beat that bill on electricity alone.
- At the derived 36.86-second local time, the limit is **16.86 W**.
- Preparation, idle, verification, operations and failures can only tighten this energy-only bound. No hosted energy claim follows from its price.
- This is not a deployment target or a proven equivalent-model comparison. It makes clear why the illustrative $10/M benchmark is insufficient.
