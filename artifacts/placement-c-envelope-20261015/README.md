# Placement C: latency breakdown, workload envelope and network degradation (2026-10-15)

Component: Reploid physical qualification evidence for the faster candidate on placement C (mac-host browser
stage 0, layers 0-7; amd-host native stage 1, layers 8-15; amd-host native stage 2, layers 16-23 and the output
head). Intent preserved. Boundary effects: none. No product, runtime, catalog or release byte changed; every
instrument here is harness-side. Machines are `mac-host` and `amd-host`; `intel-host` was not used.

**Package (unchanged, final-10 pass 3 as installed):** runtime archive `3b132ee7…` (Doppler `77c5d9b2`), model
manifest `548e6559…`, Capsule `b1527013…`, test release sequence 9 `dd837996…` (expires
2026-10-16T04:35:38Z), browser bundle `sha256:da29387c…` (checked on the served descriptor at bring-up), native
delivery descriptor `a2ee0c63…` (checked by the launcher before every native start). The hosts held release
checkpoint 9 from run 8 and were not re-signed.

## Results at a glance

- **Per token, the route is about 1.0 s on a quiet link and up to 3.4 s during mac-host Wi-Fi episodes. The
  AMD stages' own compute is about 0.26-0.32 s of that.**
  - On a quiet link, the components of a decode step add up exactly to its wall time:
    - AMD stage execution: 317 ms median for both calls (Doppler's own `executionMs` metric 105 + 159 ms, with
      13.5 + 23 ms of resident wrapper the metric omits);
    - Mac GPU: 196 ms;
    - **transfer: 193 ms**, over 12 one-way crossings per token where 4 would do;
    - grant authorization checks: 58 ms;
    - publication of each token to the requester's durable history: 29 ms;
    - host and coordinator gaps: about 30 ms.
  - During link episodes, transfer grows to 79% of each step.
- **Workload envelope:**
  - Measured: all 15 cells at concurrency 1-2 completed. In the one concurrency-3 cell the third request was
    refused. 1,024-token answers were not run (by arithmetic).
  - The 1,588-token prompt is limited by the Mac prefill: 276-302 s against the 300 s stage-bound value. That
    bound is not enforced on stage 0, and both concurrent 1,588-token prefills ran past it.
  - Two concurrent 1,588-token requesters finished at 898.7 and 899.8 s with 63-token answers.
  - The proposed supported envelope, with at least 25% margin, is prompts up to 512 tokens with answers up to
    255 tokens at concurrency 1 or 2. At concurrency 1 it also covers 1,024-token prompts with 63-token answers.
  - The pilot targets (first token within 30 s, a short answer complete within 180 s) are met only at prompts of
    about 56 tokens.
- **Network degradation:**
  - 150 ± 50 ms of added one-way delay slows the answer about 1.8-2.7x, without failure.
  - A 46 s outage fails the attempt at the **transport** boundary after 17 s, as `CONNECTION_LOST` ("A computer
    disconnected. Retry this answer."). No deadline is involved.
  - The coordinator reports the lost stages' cleanup as unknown, never settled. The natives released their own
    reservations, and no slot or owner stayed held.
  - The explicit Retry completed, and the history keeps the partial text.

## 1. Where the per-token time goes

**Requests:** the journey's 56-token first question (100-token answer), its 189-token history-aware follow-up
(12 tokens) and the 31-token retry prompt (the 171-token longest answer), through the installed application,
one requester at a time ([tools/run-turns.mjs](tools/run-turns.mjs)).

**Instrument:** [tools/latency-probe.mjs](tools/latency-probe.mjs) attaches to the stage 0 coordinator page
(Chrome DevTools protocol, loopback) and to both natives' loopback inspectors (`node --inspect`, a launcher flag;
the installed files are unchanged). It sets 78 conditional breakpoints per process in
`partition-route-execution.js`, `partition-ordered-peer.js`, `partition-step-receiver.js`,
`partition-data-channel.js` and `bounded-channel-writer.js` (Reploid `5610260a` line numbers; the served and
installed copies are byte-identical). Each condition appends `[epoch ms, tag, values]` to an array and returns
false, so nothing pauses. All 78 resolved at the intended lines in all three processes
(`breakdown/probe-*/probe-manifest.json`). The probe removed every breakpoint and its array when stopped.

**Method:** [tools/breakdown.py](tools/breakdown.py) cuts every route step on the coordinator clock into
contiguous segments, so the components of each step sum exactly to its wall time (largest residual 0.000 ms over
all 565 instrumented steps). Each remote stage call is split into:

- coordinator processing (coordinator clock);
- native processing (that native's own clock, durations only): Doppler stage execution, grant authorization,
  fingerprints, frame serialization and validation, and other host time;
- **transfer**: the remainder, when neither side was processing that call. It is messages in flight, including
  their delivery through each side's event loop, and needs no clock alignment.

Answer latency = admission (attempt creation to the first route step) + the route steps + completion. Over the
three instrumented-1 turns the route steps cover all but 0.6-0.8 s of each answer.

### Decode, per generated token (instrumented run 1: 56-token first answer, 99 decode steps)

During this run the mac-host to amd-host round trip was 19 ms median (ICMP; WebRTC STUN 19 ms, p90 57 ms).

| Component | Mean ms | Median ms | Share of mean |
|---|---|---|---|
| AMD stage 2 execution (Doppler call, incl. logits and sampling) | 243.3 | 190.6 | 23% |
| Mac stage 0 execution: GPU (Doppler submit wait) | 197.4 | 195.7 | 19% |
| AMD stage 1 execution (Doppler call) | 179.4 | 126.5 | 17% |
| Transfer, hop 1: Mac to/from AMD stage 1 (8 one-way crossings) | 151.3 | 128.5 | 14% |
| Transfer, hop 2: Mac to/from AMD stage 2 (4 one-way crossings) | 88.2 | 64.4 | 8% |
| Grant authorization checks (coordinator 12.2, stage 1 38.0, stage 2 37.3 mean) | 87.5 | 57.9 | 8% |
| AMD native host time outside execution | 34.7 | 13.7 | 3% |
| Publication: the requester's durable commit of each token | 30.7 | 28.5 | 3% |
| Mac stage 0 execution: browser host (encode 2.8, readback 0.5, resident wrapper) | 16.7 | 14.8 | 2% |
| Coordinator waits and scheduling gaps (lease wait 0.6) | 9.7 | 9.3 | 1% |
| Activation serialization, validation and fingerprints (both sides) | 7.2 | 7.0 | 1% |
| **Route step (sum)** | **1,046.1** | **1,009.9** | 100% |

Inside the AMD execution rows, from Doppler's own metrics (medians): stage 1 GPU submit wait 81.7 ms and encode
11.2 ms; stage 2 GPU submit wait 82.4 ms, logits projection 56.2 ms, logits readback 0.5 ms, sampling 3.7 ms;
stage 1 activation readback 0.9 ms. Doppler's `executionMs` metric is 105.2 and 159.3 ms (median). The resident
wrapper around it adds 13.5 and 23.0 ms that the metric does not include.

**Dominant components (good network):**

1. **AMD stage execution, 317 ms median (423 mean).** It is spiky (stage 1 mean 179 ms against a 127 ms median).
   The spikes are in GPU submit wait (stage 1 mean 134 ms against an 82 ms median). The same GPU serves both
   stages and the public contributor.
2. **Transfer, 193 ms median (240 mean).** Each decode token makes **12 one-way crossings** between mac-host and
   amd-host. A route that sends activations through the coordinator needs 4: out and back to each AMD stage. The
   data channel protocol asks for a `ready` before every payload. Stage 1 returns its activation through a nested
   `stage-output` request with its own ready, payload and result. Measured one-way times, with the native clock
   offset estimated from minimum-delay exchanges (about +2.04 s, stable across runs):
   - the ~13 KB control frames: 23-27 ms median. Two of these carry the signed grants: the step request
     (13,132 bytes) and the stage-output request (13,228 bytes);
   - 8 KB activation payloads: 20-25 ms;
   - small `ready` and `result` frames: 4-10 ms.
3. **Mac GPU, 196 ms.** It is steady. A decode call takes 205-250 ms in every run, rising with context, so the Mac
   is not the source of the variance.
4. **Grant authorization, 58 ms median (88 mean).** Each stage call runs 6 (stage 2) or 9 (stage 1)
   authorization checks on its native. A check verifies up to four grant clauses (execution, token context,
   activation, output), and each clause clones the grant, derives the signer's peer ID, imports its key and calls
   `crypto.subtle.verify`. A check costs 1-8 ms on the natives and 0.1-0.3 ms in Chrome.
5. **Publication, 29 ms:** the requester's durable transactional commit of every token.

### The same requests on a degraded network

The route's time per token is set mostly by the mac-host Wi-Fi link. During this session the mac-host to
gateway ping rose to 14-25 ms while amd-host's stayed at 2-3 ms, and mac-host's WebRTC STUN round trip spiked
to 1-6 s. amd-host is also on Wi-Fi, at -37 dBm and 2.4 Gbit/s. Run in order:

| Run | ICMP RTT median / p90 (ms) | STUN RTT median / p90 (ms) | First answer (100 tokens) | Follow-up | Longest (171 tokens) |
|---|---|---|---|---|---|
| baseline 1 (no probe) | 13 / 34 | 14 / 38 | **103.9 s** (first token 16.6 s) | 62.8 s | **171.5 s** |
| instrumented 1 | 19 / 66 | 19 / 57 | 123.8 s (20.3 s) | 81.2 s | 254.5 s |
| baseline 2 (no probe) | 49 / 852 (5 timeouts) | 68 / 1,216 | 163.3 s (20.9 s) | 92.4 s | 483.5 s |
| instrumented 2 | 199 / 1,031 (6 timeouts) | 232 / 1,014 | 440.5 s (99.2 s) | 101.9 s | 491.2 s |

Instrumented run 2's first answer, per decode token: 3,436 ms mean (2,234 median). Transfer is 2,704 ms mean,
79% of the step (hop 1 1,786 ms, hop 2 918 ms). Mac GPU (236 ms), AMD execution (272 ms) and authorization (92 ms)
barely moved. Per-step tables for all six instrumented turns are in [breakdown/breakdown-tables.md](breakdown/breakdown-tables.md).

**What the "225 ms against 1,260 ms" was.** The 225 ms was Doppler's `executionMs` metric for the two AMD
stages (88 + 137 ms in run 8 c). Here it is 105 + 159 ms median. The rest of the route's time per token is:

- the Mac stage, about 210 ms;
- the resident wrapper, about 37 ms;
- 12 crossings of the mac-host to amd-host link: about 190 ms on a quiet link, and seconds during Wi-Fi episodes;
- grant verification, about 58 ms;
- publication, about 29 ms;
- native and coordinator host time, about 30 ms.

On the best link measured (baseline 1) decode was about 0.85 s per token (sum of stage elapsed 848 ms).

### Prompt steps (prefill plus the first sampled token)

| Turn (instrumented 1) | Prompt tokens | Step | Mac stage 0 call | AMD stage 1 | AMD stage 2 | Transfer hop 1 / hop 2 |
|---|---|---|---|---|---|---|
| first answer | 56 | 19.6 s | 9.05 s | 4.94 s | 5.00 s | 0.35 / 0.12 s |
| follow-up | 189 | 66.1 s | 29.85 s | 18.92 s | 15.77 s | 1.07 / 0.28 s |
| longest answer | 31 | 20.8 s | 4.99 s | 7.50 s | 7.30 s | 0.65 / 0.21 s |

- The three stages run their prefill in sequence, so first-token time is the sum of the three calls. The Mac
  prefill (about 0.16 s per prompt token) is the largest.
- The AMD prefill varies with GPU sharing: 1.66-1.77 s for the same 31-token prompt in instrumented run 2.
- In instrumented run 2 the bulk activation transfer of the 31-token prompt took 32.3 s on hop 1 and 15.8 s on
  hop 2, against 0.65 and 0.21 s in run 1.

### Probe overhead

The probe adds about 0.2 ms per breakpoint hit in Chrome and 0.09 ms on the natives. These are calibrated on
adjacent breakpoints with only a trivial statement between them, and 0.2 ms is Chrome's timer resolution.

- About 110 hits per decode step lie on the coordinator's critical path, and about 50 on each native. This bounds
  the probe at roughly 25-35 ms per token, about 3% of a 1.0 s step.
- The larger differences between the baseline and instrumented answers follow the network, not the probe:
  instrumented 1 was slower than baseline 1, while baseline 2, with no probe, was slower than instrumented 1.
- Doppler's own execution metrics, which no breakpoint touches, match across runs. Mac stage 0 is 198 ms in
  baseline 1 and 201 ms instrumented.

### Idle control traffic

Every peer sends `describe` requests to every other peer about every 2 s on the control channel. In the 474 s of
instrumented run 1, native 1 served 841 of them and sent 818, alongside the ordered channel. This is product behavior, measured and
not changed.

## 2. Workload envelope: prompt length × answer length × concurrency

**Cells:** [tools/run-cell.mjs](tools/run-cell.mjs) sends one prompt from N fresh requester profiles at the same
moment through the installed application and follows each attempt to its end. The harness waits 60 s past the
application's 900 s answer deadline, so the application ends every attempt itself. After each cell the runner
records the coordinator's per-stage cleanup receipts and active reservations. Every cell's file is in `matrix/`;
[tools/summarize-matrix.py](tools/summarize-matrix.py) writes [matrix/summary.json](matrix/summary.json) and
[matrix/summary.md](matrix/summary.md), adding the network and amd-host memory recorded during each cell.

**Answer length.** The conversation route has no per-request output limit. The caller token limit
(`generationRequest`) exists only on the API path. Answer length is therefore asked for by instruction and
measured, never assumed:

- **Prompts** ([tools/make-count-prompt.mjs](tools/make-count-prompt.mjs), [prompts/](prompts/)) have an exact
  chat-templated length (56, 256, 512, 1,024 or 1,588 tokens). They repeat the journey's own counting
  instruction, "Count from 1 to N in order, one integer per line. No commentary.", for N = 24, 88 or 283. The
  exact answers are 63, 255 and 1,024 tokens including the end token.
- **Screening:** before use, all 15 prompts were screened on amd-host with Doppler's ordinary pipeline, greedy,
  with the product's repetition penalty ([prompts/screen-ordinary.jsonl](prompts/screen-ordinary.jsonl)). Each
  produced exactly 63, 255 or 1,024 tokens. On the route, every completed cell produced exactly the requested
  count.
- **First design, failed and kept:** the context run's workload text followed by "Ignore the request above.
  Count …". The model interleaved invented contractor lines with the count. Both cells on the route ran to the
  deadline: `matrix/attempt-1-source/c1-p56-n24.json` (255 tokens, then "A contributor declined authorization
  for this request." at 900.95 s) and `c1-p56-n88.json` (570 tokens, then "Response timed out" at 900.16 s).
  The ordinary screen reproduces the overrun on all 15 of those prompts.

**Bounds, unchanged:** the 900 s answer deadline (`attemptTimeoutMs`), the 300 s per-stage bound
(`executionChannel.timeoutMs`), 2 concurrent attempts (`limits.maxConcurrentAttempts`).

### Measured cells

Network during the matrix: WebRTC STUN round trip 22-45 ms median, p90 34-211 ms, per cell. All of these are
better than the instrumented-2 episode in section 1.

| Cell | Prompt | Answer | Req. | Outcome | First token (s) | Decode s/token | Complete answer (s) | Mac prefill call (s) | Deadline used | Stage bound used |
|---|---|---|---|---|---|---|---|---|---|---|
| c1-p56-n24 | 56 | 63 | 1 | completed | 22.0 | 2.16 | 155.8 | 9.0 | 17% | 3% |
| c1-p56-n88 | 56 | 255 | 1 | completed | 18.6 | 1.31 | 351.9 | 8.9 | 39% | 3% |
| c1-p256-n24 | 256 | 63 | 1 | completed | 97.0 | 1.37 | 181.9 | 40.8 | 20% | 14% |
| c1-p256-n88 | 256 | 255 | 1 | completed | 85.7 | 1.13 | 372.5 | 40.7 | 41% | 14% |
| c1-p512-n24 | 512 | 63 | 1 | completed | 153.4 | 1.16 | 225.6 | 82.5 | 25% | 28% |
| c1-p512-n88 | 512 | 255 | 1 | completed | 157.9 | 1.24 | 473.8 | 82.4 | 53% | 27% |
| c1-p1024-n24 | 1,024 | 63 | 1 | completed | 339.4 | 1.42 | 427.4 | 184.4 | 47% | 61% |
| c1-p1024-n88 | 1,024 | 255 | 1 | completed | 339.3 | 1.46 | 710.7 | 197.9 | 79% | 66% |
| c1-p1588-n24 | 1,588 | 63 | 1 | completed | 487.6 | 1.28 | 566.8 | 282.1 | 63% | **94%** |
| c1-p1588-n88 | 1,588 | 255 | 1 | completed | 488.0 | 1.33 | 825.4 | 275.6 | **92%** | **92%** |
| c2-p56-n24 | 56 | 63 | 2 | both completed | 24.6 / 33.6 | 1.38 / 1.25 | 110.3 / 111.2 | 9.0 / 8.9 | 12% | 3% |
| c2-p56-n88 | 56 | 255 | 2 | both completed | 18.7 / 27.5 | 1.54 / 1.51 | 410.7 / 410.9 | 9.3 / 9.1 | 46% | 3% |
| c2-p256-n24 | 256 | 63 | 2 | both completed | 80.0 / 121.2 | 2.10 / 1.44 | 210.0 / 210.3 | 41.1 / 40.3 | 23% | 14% |
| c2-p512-n88 | 512 | 255 | 2 | both completed | 150.3 / 235.9 | 1.57 / 1.24 | 549.6 / 550.0 | 81.4 / 89.1 | 61% | 30% |
| **c2-p1588-n24** | 1,588 | 63 | 2 | **both completed, at the deadline** | 502.2 / 813.7 | 6.40 / 1.39 | **898.7 / 899.8** | **301.9 / 300.9** | **99.9%** | **101%** |
| c3-p56-n24 | 56 | 63 | 3 | 2 completed; **third refused** | 23.7 / 33.0 / - | 1.35 / 1.20 / - | 107.2 / 107.3 / failed at 6.5 | 9.0 / 8.9 / - | 12% | 3% |

- **Decode:** answer time minus first-token time, divided by the tokens after the first.
- **Concurrent cells** list each requester, in the order of the cell file.
- **Settlement:** every completed attempt settled on all three stages, with 0 active reservations after each
  cell.
- **Memory never binds:**
  - amd-host native scopes reached at most 2.02 GB combined and 1.07 GB for the largest scope (warm-prepared
    natives), against 10 GiB high each;
  - GTT reached at most 2.61 GB;
  - MemAvailable stayed at or above 41.4 GB;
  - user-slice memory pressure stayed at 0.00 before every cell.

### Not run, with the reason

- **Every 1,024-token answer** (n283 at every prompt length and concurrency), by arithmetic. The best decode rate
  measured in this session is 0.88 s/token (baseline 1 on a quiet link). The 1,023 decode steps alone then take
  900 s, before the first token's 19-488 s. At the matrix's measured concurrency-1 rates of 1.13-1.46 s/token,
  they take 1,156-1,494 s.
- **c2-p256-n88, c2-p512-n24, c2-p1024-n24, c2-p1024-n88, c2-p1588-n88 and c3-p512-n24:** dropped when the parent
  session trimmed the campaign to the decisive cells. The following were kept:
  - c2-p1588-n24, the previously failing concurrent long-prompt workload;
  - c2-p512-n88;
  - c3-p56-n24, for queueing behavior.

  c2-p1588-n88 is bounded by c2-p1588-n24: the shorter answers already end within 1.3 s of the deadline.

### What binds, per region

1. **Mac prefill serialization and the per-stage bound, for long prompts.**
   - The Mac stage 0 prefill takes 0.16-0.19 s per prompt token: 9 s at 56, 41 s at 256, 82 s at 512,
     184-198 s at 1,024 and 276-302 s at 1,588. It is slower here than in run 8 (263.6 s at 1,588).
   - At 1,588 tokens it uses 92-101% of the 300 s stage-bound value.
   - **The 300 s bound is not enforced on stage 0.** Both c2-p1588-n24 Mac prefill calls ran past it (301.9 and
     300.9 s) and continued. The bound is enforced by the data channel's request timer
     (`executionChannel.timeoutMs`), and stage 0 runs inside the coordinator without a channel.
2. **The answer deadline, for concurrency at long prompts.**
   - Same-stage execution is serialized, so the second requester's Mac prefill waits for the first's. Its first
     token came at 813.7 s, against 502.2 s for the first requester.
   - The first requester's decode then waited behind that second prefill: 6.4 s per token on average.
   - Both answers, 63 tokens each, ended at 898.7 and 899.8 s, within 1.3 s of the deadline. This is the same
     workload class that timed out in the context run. It completed here only because the answers were short.
3. **The answer deadline, for long answers.**
   - At concurrency 1, decode costs 1.13-1.46 s per token on these links, so the deadline allows roughly
     620-800 tokens, less the first-token time.
   - In the instrumented-2 episode, decode cost 2.2-3.4 s per token, which allows about 250 tokens.
4. **Admission, for concurrency 3.** The third simultaneous request is refused 6.5 s after Send with "Partition
   peer declined or failed request". There is no queue. The other two complete normally (107 s) and settle.
5. **The deadline's first failure surface can be grant expiry, not the deadline timer.** The attempt-1 cell that
   ran to the deadline ended with "A contributor declined authorization for this request." at 900.95 s. This is
   consistent with the ordered grant's 900 s lifetime (`grantMs` 900,000) running out at a stage before the
   requester's own timer fired. The other overrun ended with "Response timed out" at 900.16 s. Both settled on
   all three stages. The person sees the same deadline as two different messages.

### Proposed supported envelope (not product copy)

The rule is at least a 25% margin on both bounds at the networks measured here (STUN median at most 45 ms, p90
at most 211 ms):

| Concurrency | Supported | Worst measured: answer / deadline used / Mac prefill / stage bound used |
|---|---|---|
| 1 | prompt ≤ 512 tokens with answers ≤ 255 tokens | 473.8 s / 53% / 82.5 s / 28% |
| 1 | prompt ≤ 1,024 tokens with answers ≤ 63 tokens | 427.4 s / 47% / 184.4 s / 61% |
| 2 | prompt ≤ 512 tokens with answers ≤ 255 tokens per requester | 550.0 s / 61% / 89.1 s / 30% |
| 3 or more | not supported: the third concurrent request is refused | |

Outside the envelope:

- **Fits, but below the margin:**
  - 1,024-token prompts with 255-token answers at concurrency 1 (79% of the deadline);
  - any 1,588-token prompt at concurrency 1 (92-94% of the stage bound).
- **Not supported:**
  - 1,588-token prompts at concurrency 2 (at the deadline, and past the stage-bound value on the Mac);
  - any 1,024-token answer.

**Against the pilot targets** (first token within 30 s; a short answer complete within 180 s):

- Only prompts of about 56 tokens meet them.
- At concurrency 1, c1-p56-n24 gave a first token at 22.0 s and completed in 155.8 s.
- At concurrency 2, the first tokens came at 24.6 and 33.6 s and both answers completed in 110-111 s, so the
  second requester missed 30 s.
- At 256 prompt tokens the first token takes 80-121 s, and the 63-token answer takes 181.9 s alone and
  210 s with two requesters.
- The first-token time grows by about 0.31 s per prompt token.

**The envelope depends on the mac-host link.** On the degraded link of section 1 (STUN median 232 ms, p90
1,014 ms), decode took 2.2-3.4 s per token. At 3.4 s per token, c1-p512-n88 would need about 1,000 s.

## 3. Deliberate degradation of the mac-host to amd-host link

**Mechanism.** amd-host gives no privileges for `tc netem` (sudo requires a password), and mac-host has no
passwordless sudo either.

- **Userspace shaper:** [tools/netshape.c](tools/netshape.c) (`netshape.so`, sha256 `899336ca…`, source
  `cb54d9bb…`) is an `LD_PRELOAD` shim loaded only into the two owned native processes (launcher argument
  `shape`).
  - It intercepts `sendto`, `sendmsg`, `recvfrom` and `recvmsg` on their non-loopback UDP sockets: the WebRTC
    path to mac-host, and the two natives' own peer connection to each other.
  - It does not touch TCP, loopback or any other process.
  - A control file sets: one-way delay with uniform jitter on outgoing datagrams (first in, first out, no
    reordering), loss in each direction, or an outage that drops everything in both directions. Without the file
    it passes everything through. It was checked before use against a local UDP echo: 200 ± 50 ms gave 151-248
    ms, and 30% loss dropped 3 of 20 datagrams.
- **Signaling during the outage:** the owned mac-host end of the ssh tunnel that carries the natives' signaling
  was stopped (SIGSTOP) and continued (SIGCONT).
- **Restored and verified:**
  - after each condition the control file was removed and its absence checked (`degradation/run-log.txt`);
  - the shaper logged "control removed: pass-through" (`logs/amd-host/*.netshape.log.gz`);
  - the shaped natives were stopped at settlement;
  - nothing on either host retains any shaping.
- **Runner:** [tools/run-degradation.mjs](tools/run-degradation.mjs) sends the matrix's p56-n24 prompt (56
  tokens, 63-token answer) from a fresh requester profile, applies the condition and follows the attempt. On a
  failure it presses the application's own Retry once and follows that attempt, then records the shown failure,
  the coordinator's receipts, both natives' reservation records and the thread history.
- **Conditions:** the parent session trimmed the set to two: one added-latency case and one stall case.

### d1: 150 ms ± 50 ms added one-way delay (amd-host to mac-host) for the whole answer

Result file: `degradation/d1-delay-150-jitter-50.json`.

- **Outcome: completed**, 63 tokens, first token 24.1 s, complete in **284.3 s**. The same cell took 107-156 s
  undelayed. No failure, so no retry was needed.
- **Per-token stage elapsed:** hop 1 2,602 ms (execution 98), hop 2 1,324 ms (execution 143), against about
  600 and 400 ms undelayed. Decode averaged 4.2 s per token.
- **Amplification:** the delay adds 150 ms to each amd-host-to-mac-host crossing, 4 on hop 1 and 2 on hop 2, so
  0.9 s per token expected. The measured cost was about 2.9 s. Every message on these channels waits on its
  predecessor's reply, and the 13 KB control frames take several packets.
- **Settled:** all three stages settled, with 0 active reservations, 0 unsettled owners and transactional
  history.
- **Failing boundary:** none within the answer. At 4.2 s per token the next limit is the 900 s answer deadline,
  at about 200 tokens.

### d2: 46 s outage of the link and of the signaling tunnel, mid-answer

Result file: `degradation/d2-outage-45s.json`.

- **Timeline:**
  - **Applied** once 10 characters had streamed (17:45:19.3).
  - **Disconnect:** both mac-host to amd-host peer connections reported `disconnected` within 8 s.
  - **Attempt failed 17.2 s in:** "A contributor disconnected. The attempt was interrupted; remote cleanup is not
    confirmed." (`CONNECTION_LOST`). The person saw **"A computer disconnected. Retry this answer."** The 11
    published tokens of partial text were kept.
  - **Restored:** the tunnel continued after 45.0 s and the shaper was released 46.1 s in, when its control file
    was removed. The intended 45 s window ran by control removal, not by its timestamp: amd-host's `date`
    printed nanoseconds for `%3N`, which put the timestamp far in the future. The window as applied is recorded
    in the shaper log.
- **Failing boundary: transport.** The WebRTC peer connections lost consent and their data channels closed.
  - No deadline was involved: the 300 s stage timer and the 900 s answer deadline were far off.
  - The coordinator's handling worked as designed: lost stages are reported as lost, not as a timeout or a
    cleanup failure.
  - The signaling stall was not the failure itself. Both natives reconnected to signaling when the tunnel
    continued (two `/swarm` upgrades at 17:46:04).
- **Settlement after the failure:**
  - **Coordinator:** stage 0 is `settled`; stages 1 and 2 are `unknown` with `CONNECTION_LOST`. The attempt
    stays in `unknownAttempts` with phase `cleanup-failed`, never reported as settled.
  - **Holds released:** 0 active reservations, 2 of 2 slots available, 0 unsettled owners.
  - **Natives:** both released their own reservation for the lost attempt during the outage. Their records show
    `settled` about 15 s after the outage began. Coordinator "unknown" means only that the coordinator could not
    confirm it.
  - **No orphan:** nothing kept a slot or an owner.
- **Explicit retry: completed.** One Retry press on the failed answer created exactly one new attempt (`retryOf`
  the failed one). It produced the full 63 tokens in 97.7 s (first token 19.6 s) and settled on all three stages.
  - **Thread history (transactional):** the failed attempt with its 11-character partial text, then the
    completed retry.
  - **Not captured:** when capacity returned. The runner's own 3-minute settlement poll of the lost attempt ran
    before it pressed Retry. The capacity was back by then (17:49:09), but the moment it returned within that
    window was not recorded.
- **Instrument side effect, recorded:** when the coordinator's peer connections dropped, the WebRTC sampler
  re-queried the page's peer connection objects, which paused the coordinator page for 712 ms at 17:45:32,
  inside the outage.

### Natural degradation (section 1)

The mac-host Wi-Fi episodes during the breakdown runs were a third, unplanned condition: STUN round trips of
1-6 s and ICMP timeouts. The route did not fail; it slowed. The first answer took 440.5 s instead of
103.9 s. Transfer was 79% of each decode step, the transport recovered every time, and every attempt completed
and settled. Under such episodes the binding boundary for longer answers is the 900 s deadline, not the
transport.

**Not run** (trimmed by the parent session): packet loss, delay without jitter at several levels, and a short
(about 10 s) outage. The question whether a short outage is ridden out is therefore open. The 46 s outage fails
at about 17 s, so the transport's tolerance is at most about 17 s.

## Bring-up, bounds and tools

- **Bring-up:**
  - the run-7 loopback app server on mac-host, serving the final-10 pass 3 export (bundle `da29387c…`
    verified on the served descriptor);
  - an owned ssh tunnel: a reverse forward of port 29670 for the natives' signaling, and local forwards of the
    natives' inspector ports 29991 and 29992;
  - run 8's stage 0 Chrome profile on CDP 29671, set up with the unchanged run-7 `stage0-setup.mjs`
    ([bringup/](bringup/));
  - the two amd-host natives from [tools/native-launch.sh](tools/native-launch.sh), run 8's launcher with the
    `fc-env-` prefix, an optional inspector port and an optional shaper. They reuse run 8's room files, stage
    configurations and native state directories (read only), so the stage peer identities and release checkpoint
    9 are the installed ones. The stage 0 peer ID is new for this browser session; the route is otherwise
    identical.
- **Bounds:**
  - every amd-host process ran in its own `systemd-run --user --scope` with MemoryHigh 10 GiB, MemoryMax 12 GiB,
    MemorySwapMax 0 and a runtime cap: 2 h for the natives, 15-20 min for the screening runs and 16 h for the
    sampler;
  - the native launchers set `ulimit -c unlimited`;
  - the room token reaches the natives only through run 8's mode-0600 token file. After every launch, zero
    token hits were found in argv and in the user journal (`matrix/restarts.log`);
  - the matrix runner checks the user-slice memory pressure and the largest native scope before every cell, and
    stops at more than 20% `avg10` or 9 GiB. No check triggered; the maximum is in the matrix table.
- **Samplers:**
  - [tools/amd-sampler.py](tools/amd-sampler.py): both native scopes, GTT, MemAvailable, every 2 s;
  - [tools/mac-health.sh](tools/mac-health.sh): ICMP RTT over the tailnet name, every 10 s;
  - [tools/webrtc-stats.mjs](tools/webrtc-stats.mjs): the stage 0 page's selected ICE pairs through
    `RTCPeerConnection.getStats()`, every 5 s. The pairs were host/UDP on the LAN.
  - Raw logs are in `logs/`, with addresses reduced to classes.
- **Public contributors** amd-host 4103868 and 4121371 were present throughout and never addressed. Contributor
  4103868 uses about 1.2 CPU continuously, as do these natives when idle (2 h 24-26 min of CPU per 2 h scope).

## Settlement (2026-10-15, 17:55 UTC)

- **Release checkpoints after the campaign** ([settlement/](settlement/)): both amd-host native states and the
  mac-host stage 0 profile still hold sequence 9 `dd837996…`. Nothing was re-signed. Every run finished before
  the sequence's 2026-10-16T04:35:38Z expiry, so the renewed sequence 10 was not needed or delivered.
- **Natives:**
  - the last pair, `fc-env-native-*-4` (shaped), stopped by SIGTERM in 1 s each, with last state `idle` and
    0 unsettled owners ([settlement/native-stop.jsonl](settlement/native-stop.jsonl));
  - pair 2 was stopped the same way by the matrix runner ([matrix/restarts.log](matrix/restarts.log)), and pair 3
    when the shaped natives replaced it ([degradation/restarts.log](degradation/restarts.log));
  - pair 1 reached its 2-hour scope cap idle and unloaded ("Device lost: device was destroyed", the normal
    unload).
- **Stage 0:** settled to `idle` with 0 unsettled owners through the application's own contribution control, then
  its browser closed ([settlement/stage0-stop.json](settlement/stage0-stop.json)).
- **Stopped:** the app server, the ssh tunnel, the Mac health sampler, the WebRTC sampler and the amd-host
  sampler. Failed `fc-env-*` units were reset. Afterwards there were no `fc-env-*` units on amd-host and no owned
  listening ports in 29670-29999 on either host.
- **Shaping:** the control file is absent on amd-host, and no shaped process remains.
- **Health:**
  - the amdgpu error count is unchanged at 50;
  - `journalctl | grep -i oomd` on amd-host shows 0 lines today;
  - user-slice memory pressure was 0.00 before every cell;
  - mac-host free memory stayed at or above 34% during the matrix, and its swap grew from 2.1 GB to 6.3 GB over
    the session. Other sessions also run on mac-host, so that growth is not attributed.
- **Public contributors** amd-host 4103868 and 4121371 were running before and after, untouched.
- **intel-host** was not used.
- **Logs:**
  - amd-host native, shaper and sampler logs, gzipped: [logs/amd-host/](logs/amd-host/);
  - mac-host health, WebRTC, app-server request and runner logs: [logs/mac-host/](logs/mac-host/);
  - the stage 0 Chrome log is not retained, because it contains LAN addresses;
  - no retained file contains a machine address, a login or the room token.

## Files

| Path | What |
|---|---|
| `breakdown/turns-*.json` | baseline and instrumented runs of the three requests (application timing records, answers) |
| `breakdown/probe-*/` | probe manifests (every breakpoint and resolved location) and raw rows (gzipped JSONL) |
| `breakdown/breakdown-*.json`, `.out`, `breakdown-tables.md` | per-step breakdowns and tables |
| `matrix/c*.json`, `summary.json`, `summary.md`, `run-log.txt`, `cells*.txt`, `restarts.log` | envelope cells |
| `matrix/attempt-1-source/` | the failed first prompt design, kept |
| `prompts/` | the 15 repeat-design prompts, their build log, the ordinary-pipeline screen, and the failed first design |
| `degradation/` | the two conditions, runner log and native restart log |
| `settlement/` | release checkpoints and stop receipts after the campaign |
| `tools/` | every harness tool used here |
