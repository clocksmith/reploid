# Phase timing on the three-stage route: stopped at the first stop condition

Measurement only. This is not acceptance, qualification or a release claim. Machines are named
`mac-host`, `amd-host` and `intel-host`; no file here carries a private address or the room token.

The campaign stopped during its second rung. The Intel native's prefill of a 267-token prompt
hung the Intel GPU. i915 logged "Fence expiration", "Resetting rcs0 for preemption time out" and
"GPU HANG" for the owned native's process, and the native reported `VK_ERROR_DEVICE_LOST`.
Per the stop conditions, every owned scope was stopped and nothing else ran. Placement B never
ran, and no rung above 267 prompt tokens ran.

## Ladder and limits

The coordinator's correction fixed these. It arrived while the second answer was already in
flight, and no later answer was started.

- **Fixed ladder**, the same in each placement, nothing above 1588. The prompt token counts below
  are for the user text only; [`config/prompts.json`](config/prompts.json) comes from
  [`tools/prompts.py`](tools/prompts.py).
  - `short`: 12 user tokens; 24 measured input tokens.
  - `t256`: 255 user tokens; 267 input tokens.
  - `t1024`: 1022 user tokens.
  - `dr5-flattened`: 1592 user tokens. This is DR-5's long-prompt workload,
    `tests/fixtures/distributed-memory-requests.json` request 1 (fixture sha256 `79496033...`),
    flattened into one user message because the chat UI cannot author an assistant turn.

  Every rung ends with "In one short sentence, say what the text above is about." so decode stays
  short.
- **Per answer:**
  - at most 64 generated tokens;
  - a 20-minute wall cap;
  - bounded native scopes: 10 GiB high, 12 GiB max, zero swap, 75-minute runtime cap.

  The driver as run did not enforce the 64-token cap, and its configured answer deadline was
  30 minutes (`config/measure-*.json` `answerMs`). Neither mattered: the answers generated 8, 8
  and 0 tokens, and the longest attempt lasted 243 s.
- **Stop conditions:**
  - any new i915 "Fence expiration", "GPU HANG" or "Resetting" line on intel-host;
  - public contributors serving GPU work, which means pause and never touch them;
  - any stage over the existing 300 s stage limit (`executionChannel.timeoutMs` 300000);
  - any allocation above 1,420,000,000 bytes.

  The first condition fired on rung 2.

## Build under test

- **Browser:** export `/var/tmp/reploid-phase-timing-measure-20261014/app`, hosting bundle
  `sha256:40be63a8...`, verified at the loopback origin:
  [`preflight/served-bundle-verification.txt`](preflight/served-bundle-verification.txt). This is
  the final-5 export with `partition-summary.js` from Reploid `b0cb3b83`, so
  `stepSummary.phases` carries prompt and decode per stage.
- **Natives:** unchanged final-5 installs on amd-host and intel-host, model
  `/var/tmp/doppler-cold-compile-model-20261013`. They already returned their Doppler metrics.
- **Numerics:** the kernels use two-F32 compensated arithmetic with integer-based residual
  calculations, at f32 activations with an f16 KV cache.

## Ownership

| Host | What | Identity | Start (UTC) | Stop (UTC) |
|------|------|----------|-------------|------------|
| amd-host | native, placement A stage 1 (layers 8-15) | unit `ptm-a-amd-native-1`, PID 848534 | 12:14:20 | SIGTERM 12:25:55.9, inactive within 1 s; memory peak 1,142,833,152 B |
| intel-host | native, placement A stage 2 (layers 16-23, final norm, output head, sampling) | unit `ptm-a-intel-native-1`, PID 1377463 | 12:14:26 | SIGTERM 12:25:54.4, inactive within 1 s; memory peak 1,627,058,176 B |
| mac-host | app server 127.0.0.1:29670; reverse tunnels to both hosts | PIDs 1963, 2022, 2023 | 12:13 | SIGTERM after settlement |
| mac-host | stage 0 browser (CDP 127.0.0.1:29671, reused run-2 stage-0 profile) | PID 2136 | about 12:14:50 (ready 12:17:34) | stage0-stop: sharing off, `idle`, 0 unsettled owners, then Browser.close |
| mac-host | one fresh requester profile per answer | temporary directories, removed at close | per answer | per answer |

[`settlement/`](settlement/) compares the hosts against [`preflight/`](preflight/). Public
contributors were unchanged: AMD 4103868 and 4121371, Intel 297260 and 299769, same PIDs and
arguments, and none was touched. The room id, token file and stage files were removed from all
three machines after the run. During all three answers, another agent's single-machine Doppler
reproduction was running on the mac-host GPU, so mac-host stage 0 timings may include contention.

## 1. Where time goes per stage (placement A, measured)

Placement A ran Mac browser stage 0, then AMD native stage 1, then Intel native stage 2.
`answers/a-short-warm.json` is the second identical short answer (24 prompt tokens, 8 generated,
"Paris is the capital of France."). The first, `a-short.json`, agrees within about 15 %.
`python3 tools/summarize.py answers/<file>` prints the breakdown.

Transport here means coordinator stage elapsed minus the contributor's `executionMs`. That
includes activation transfer, grant checks and channel framing, which cannot be separated further.

**Decode, mean per step over 7 steps**

| Stage | Coordinator elapsed | Doppler execution | GPU wait (`submitWaitMs`) | Output head (`logitsMs`) | Logits readback | Activation readback | Sampling | Transport |
|------|------|------|------|------|------|------|------|------|
| 0 mac-host (layers 0-7) | 559 ms | 543 ms | 529 ms | - | - | 8.7 ms | - | 16 ms |
| 1 amd-host (layers 8-15) | 394 ms | 158 ms | 147 ms | - | - | 0.7 ms | - | 236 ms |
| 2 intel-host (layers 16-23 + head) | 2344 ms | 2138 ms | 1023 ms | 1094 ms | 0.6 ms | 0 | 5.1 ms | 206 ms |

One generated token costs about 3.3 s: 71 % in the Intel stage. Inside that stage, the output
head takes 1.09 s and the eight layers 1.02 s. The same eight-layer shape takes 0.15 s on AMD
and 0.53 s on the Mac.

**Prefill, step 0: the whole prompt in one chunk plus the first token**

| Stage | Elapsed | Execution | Layer loop (`encodeMs`) | Output head | Transport |
|------|------|------|------|------|------|
| 0 mac-host | 14,497 ms | 14,486 ms | 14,476 ms | - | 11 ms |
| 1 amd-host | 3,311 ms | 2,307 ms | 2,305 ms | - | 1,004 ms |
| 2 intel-host | 23,293 ms | 22,959 ms | 21,832 ms | 1,123 ms | 334 ms |

Prefill cost per prompt token is about the same as one decode step's layer cost: Intel 910 ms,
Mac 603 ms and AMD 96 ms per prompt token, against 1,023 / 529 / 147 ms per decode step. With a
single 24-token chunk this shows no batching gain at this prompt size. Prefill therefore grows
roughly linearly with prompt length.

Boundaries that cannot be separated:
- In prefill, `encodeMs` is the wall time of the layer loop, including GPU work waited on inside
  it. Encode and GPU cannot be split there.
- `submitWaitMs` covers all eight layers together. `gpuKernelsMs` is null because the GPU
  profiler is off, so there is no per-layer or per-kernel time.
- `logitsMs` is Doppler's final boundary as a whole: final norm plus output head.
- Publication cannot be separated. Ordered routes write ordinary history, which exposes no timing
  (timing record `persistence: not-observable`).

## 2. Placement A versus placement B

Not measured. Placement B (Mac stage 0, then Intel stage 1, then AMD stage 2 with the output
head) was never brought up, because the campaign stopped on placement A's second rung. The
measured split above shows what B would move: the 1.09 s Intel output head and Intel's position
in the route. B's cost is not inferred here.

## 3. Context bound reached

| Rung | Input tokens | Result |
|------|------|------|
| `short` (x2) | 24 | completed, 8 generated, `eos-token` |
| `t256` | 267 (derived; see below) | failed after 243 s: "Partition peer declined or failed request" |

How t256 failed:
- The Intel native's prefill hung the GPU. Kernel lines in
  [`logs/intel-host-kernel-i915.txt`](logs/intel-host-kernel-i915.txt), 12:25:10 to 12:25:30 UTC:
  "Fence expiration time out" twice, "Resetting rcs0 for preemption time out", "context reset due
  to GPU hang", "GPU HANG".
- The native then logged `VK_ERROR_DEVICE_LOST`
  ([`logs/intel-host-ptm-a-native-1.log.gz`](logs/intel-host-ptm-a-native-1.log.gz)).
- i915's preemption timeout on this host is 7,500 ms
  (`/sys/class/drm/card0/engine/rcs0/preempt_timeout_ms`), so a single non-preemptible dispatch
  ran past it.
- No i915 line followed after 12:25:30.

Where the 267 comes from: a failed attempt carries no phase summary. Each attempt's KV allocation
is its prompt length plus 1,024 positions. Intel logged `maxSeqLen=1048` for the 24-token answers
and `maxSeqLen=1291` for t256.

The measured bound on placement A, with Intel at stage 2 and the Capsule's 256-token prefill chunk: a 24-token
prompt completes, and a 267-token prompt fails at the Intel stage on the GPU preemption timeout,
before any stage reached the 300 s stage limit. Nothing between 24 and 267 was measured.

Resident GPU weights were 227 MB on Intel and 91 MB on AMD. No allocation came near
1,420,000,000 bytes.

## What this does not establish

- Placement B, or any placement with the output head off Intel.
- Prompts between 24 and 267 tokens; t1024 and the DR-5 rung never ran.
- Mac or AMD context bounds.
- Whether a smaller `inference.session.prefillTokenChunkSize` keeps Intel dispatches under the
  preemption timeout. Correction (coordinator, after the run): this build does chunk prefill. The
  signed Capsule's program load policy sets it to 256
  (`capsule.json` `targetPlans[0].initialExecutionIdentity.programLoadPolicy.runtimeConfig.inference.session`,
  Doppler `artifacts/kernel-completion-repair-20261013/signed-capsule/`), and the resident partition
  splits prefill only when the prompt exceeds it (`resolvePrefillTokenChunkSize`). So the 24-token
  prompt ran as one chunk and the 267-token prompt as chunks of 256 and 11. Which chunk was running
  when the engine reset is inferred, not observed: the 256-row chunk runs first and is the larger.
  The qualification campaign's longest Intel prefill, about 205 rows at the measured per-token rate,
  also fit in one chunk. A smaller chunk changes the Capsule's execution identity and needs its own
  qualification; it was not tried.
- Per-kernel GPU time or publication time.
- Numerical correctness or answer quality.
- Anything about the signed final-5 journey results, which are unchanged.

## Files

- **`answers/`**: one JSON per answer, holding:
  - the rung id and hash;
  - attempt status and error;
  - the answer text;
  - the coordinator's `stepSummary` with `phases`;
  - the journey harness's v2 timing record (`timing.mjs`).
- **`config/`**: stage assignments for both placements, driver configs and the prompt ladder.
- **`tools/`**:
  - `measure.mjs`, the per-answer driver;
  - `prompts.py` and `summarize.py`;
  - `native-launch.sh` and `native-stop.sh`;
  - the remaining tools (stage 0 setup and stop, app server, snapshots, redaction) are copied
    from journey run 6 with renamed units.
- **`logs/`**: redacted native logs, i915 kernel lines, launch outputs, the app server and
  tunnels.
- **`preflight/`, `settlement/`, `bringup/`**: host snapshots, the stop receipts and the stage 0
  setup receipt.
