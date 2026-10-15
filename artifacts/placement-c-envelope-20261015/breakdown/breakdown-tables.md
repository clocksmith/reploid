
**probe-1 / first-answer** (56 prompt tokens, 100 generated; answer 123.8 s; 99 decode steps; route steps 123.2 s; outside route steps 0.6 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 197.4 | 195.7 | 19% |
| Mac stage 0 execution: browser host | 16.7 | 14.8 | 2% |
| AMD stage 1 execution (Doppler) | 179.4 | 126.5 | 17% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 243.3 | 190.6 | 23% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 15.7 | 0.9 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 79.9 | 56.2 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 7.4 | 0.5 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 3.3 | 3.7 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 134.1 | 81.7 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 120.4 | 82.4 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 151.3 | 128.5 | 14% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 88.2 | 64.4 | 8% |
| Grant authorization checks (coordinator + both natives) | 87.5 | 57.9 | 8% |
| Activation serialization, validation and fingerprints | 7.2 | 7.0 | 1% |
| AMD native host time outside execution | 34.7 | 13.7 | 3% |
| Publication (durable requester commit, per token) | 30.7 | 28.5 | 3% |
| Coordinator waits and scheduling gaps | 9.7 | 9.3 | 1% |
| **Route step (sum of the above)** | **1046.1** | **1009.9** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**probe-1 / follow-up** (189 prompt tokens, 12 generated; answer 81.2 s; 11 decode steps; route steps 80.7 s; outside route steps 0.6 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 206.4 | 203.6 | 16% |
| Mac stage 0 execution: browser host | 16.9 | 15.0 | 1% |
| AMD stage 1 execution (Doppler) | 106.2 | 99.6 | 8% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 171.6 | 163.2 | 13% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 0.9 | 0.7 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 55.3 | 52.5 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 4.1 | 0.6 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 2.0 | 1.5 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 77.3 | 77.3 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 80.3 | 79.2 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 433.1 | 316.6 | 33% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 180.2 | 192.0 | 14% |
| Grant authorization checks (coordinator + both natives) | 67.0 | 44.7 | 5% |
| Activation serialization, validation and fingerprints | 6.7 | 6.6 | 1% |
| AMD native host time outside execution | 90.4 | 15.6 | 7% |
| Publication (durable requester commit, per token) | 38.7 | 38.1 | 3% |
| Coordinator waits and scheduling gaps | 8.9 | 8.6 | 1% |
| **Route step (sum of the above)** | **1326.1** | **1202.2** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**probe-1 / longest-answer** (31 prompt tokens, 171 generated; answer 254.5 s; 170 decode steps; route steps 253.7 s; outside route steps 0.8 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 206.6 | 206.0 | 15% |
| Mac stage 0 execution: browser host | 15.8 | 14.7 | 1% |
| AMD stage 1 execution (Doppler) | 166.3 | 127.1 | 12% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 226.5 | 183.7 | 17% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 12.6 | 1.2 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 73.8 | 56.7 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 6.7 | 0.5 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 3.0 | 3.2 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 123.6 | 82.5 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 112.7 | 80.3 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 342.1 | 288.6 | 25% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 202.3 | 154.5 | 15% |
| Grant authorization checks (coordinator + both natives) | 90.7 | 56.2 | 7% |
| Activation serialization, validation and fingerprints | 7.1 | 7.0 | 1% |
| AMD native host time outside execution | 68.4 | 15.0 | 5% |
| Publication (durable requester commit, per token) | 35.0 | 34.9 | 3% |
| Coordinator waits and scheduling gaps | 9.4 | 9.3 | 1% |
| **Route step (sum of the above)** | **1370.1** | **1328.5** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**probe-2 / first-answer** (56 prompt tokens, 100 generated; answer 440.5 s; 99 decode steps; route steps 340.2 s; admission 10.8 s, completion 1.4 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 236.4 | 217.9 | 7% |
| Mac stage 0 execution: browser host | 22.0 | 19.7 | 1% |
| AMD stage 1 execution (Doppler) | 102.3 | 93.8 | 3% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 169.2 | 142.8 | 5% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 0.7 | 0.6 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 58.8 | 48.8 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 3.0 | 0.3 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 1.3 | 1.2 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 83.0 | 74.7 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 87.6 | 74.4 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 1785.8 | 1018.9 | 52% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 918.0 | 383.0 | 27% |
| Grant authorization checks (coordinator + both natives) | 92.2 | 45.5 | 3% |
| Activation serialization, validation and fingerprints | 6.3 | 5.8 | 0% |
| AMD native host time outside execution | 53.0 | 12.2 | 2% |
| Publication (durable requester commit, per token) | 41.1 | 37.3 | 1% |
| Coordinator waits and scheduling gaps | 9.9 | 9.5 | 0% |
| **Route step (sum of the above)** | **3436.2** | **2233.6** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**probe-2 / follow-up** (189 prompt tokens, 12 generated; answer 101.9 s; 11 decode steps; route steps 100.5 s; admission 1.3 s, completion 0.1 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 236.9 | 232.0 | 15% |
| Mac stage 0 execution: browser host | 32.1 | 25.5 | 2% |
| AMD stage 1 execution (Doppler) | 94.8 | 94.6 | 6% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 169.9 | 147.0 | 11% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 0.7 | 0.6 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 72.0 | 49.0 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 0.5 | 0.3 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 1.4 | 1.2 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 76.8 | 76.6 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 75.9 | 76.1 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 529.9 | 350.6 | 35% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 232.8 | 202.5 | 15% |
| Grant authorization checks (coordinator + both natives) | 94.9 | 52.6 | 6% |
| Activation serialization, validation and fingerprints | 7.6 | 6.6 | 0% |
| AMD native host time outside execution | 39.6 | 7.7 | 3% |
| Publication (durable requester commit, per token) | 79.8 | 63.2 | 5% |
| Coordinator waits and scheduling gaps | 11.4 | 10.8 | 1% |
| **Route step (sum of the above)** | **1529.6** | **1388.9** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**probe-2 / longest-answer** (31 prompt tokens, 171 generated; answer 491.2 s; 170 decode steps; route steps 479.7 s; admission 11.3 s, completion 0.3 s)

| Component per decode token | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| Mac stage 0 execution: GPU wait | 204.6 | 203.0 | 8% |
| Mac stage 0 execution: browser host | 15.0 | 13.6 | 1% |
| AMD stage 1 execution (Doppler) | 109.4 | 94.0 | 4% |
| AMD stage 2 execution (Doppler, incl. logits and sampling) | 159.9 | 143.3 | 6% |
| &nbsp;&nbsp;Doppler metric: stage 1 activation readback | 0.8 | 0.6 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits (projection) | 52.1 | 48.9 | |
| &nbsp;&nbsp;Doppler metric: stage 2 logits readback | 0.4 | 0.3 | |
| &nbsp;&nbsp;Doppler metric: stage 2 sampling | 1.2 | 1.2 | |
| &nbsp;&nbsp;Doppler metric: stage 1 GPU submit wait | 89.9 | 74.9 | |
| &nbsp;&nbsp;Doppler metric: stage 2 GPU submit wait | 87.4 | 74.4 | |
| Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings) | 1135.9 | 380.8 | 46% |
| Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings) | 636.8 | 221.8 | 26% |
| Grant authorization checks (coordinator + both natives) | 90.5 | 40.8 | 4% |
| Activation serialization, validation and fingerprints | 5.3 | 5.1 | 0% |
| AMD native host time outside execution | 78.4 | 12.1 | 3% |
| Publication (durable requester commit, per token) | 34.7 | 31.2 | 1% |
| Coordinator waits and scheduling gaps | 8.2 | 7.6 | 0% |
| **Route step (sum of the above)** | **2478.9** | **1332.6** | 100% |

Largest difference between a step's wall time and its component sum: 0.000 ms.

**Prompt steps** (ms; everything else is grouped as "other")

| Probe / turn | Prompt tokens | Step total | Mac stage 0 execution (whole call) | AMD stage 1 execution (Doppler) | AMD stage 2 execution (Doppler) | Transfer, hop 1 (incl. bulk activation both ways) | Transfer, hop 2 (incl. bulk activation one way) | Other |
|---|---|---|---|---|---|---|---|---|
| probe-1 / first-answer | 56 | 19620 | 9048 | 4940 | 5001 | 348 | 122 | 161 |
| probe-1 / follow-up | 189 | 66085 | 29851 | 18921 | 15768 | 1072 | 276 | 197 |
| probe-1 / longest-answer | 31 | 20752 | 4993 | 7504 | 7299 | 650 | 206 | 99 |
| probe-2 / follow-up | 189 | 83674 | 37484 | 9948 | 10057 | 17850 | 8148 | 187 |
| probe-2 / longest-answer | 31 | 58240 | 6454 | 1664 | 1767 | 32315 | 15788 | 253 |
