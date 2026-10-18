# Conversation selection repair and latency attribution

The deployed workspace now persists its selected conversation. Reload restores
that thread and its exact model instead of silently starting a new thread with
the default model. A saved selection does not resume execution or authorize a
new request. Explicit new-thread selection, legacy history without a pointer,
and missing or closed selections restore to no selected thread.

Component: chat workspace, host/UI composition, verification. Intent preserved;
no boundary changes, model arithmetic, runtime package or model identity changes.
Base source: `3f03b9d7`; changed source and generated files are in this receipt's
owning commit. Hosting-only deployment serves bundle
`sha256:4cd485f72d88b2dec965a94a3e4701faee0589ff5ce0ce3fb31ce2b1e8aae714`
at https://replo.id. Native contributors were not restarted or stopped.

## Validation

- 50 focused tests passed across chat-workspace, chat-session and
  ordered-requester-history; library types and diff whitespace passed.
- [Four deployed reloads](reload-probe.json) preserved the selected thread,
  complete thread records and visible 2B selection (2480, 2496, 2540, 2002 ms).
  This seeds retained synthetic history into a fresh requester profile. It does
  not run model requests or prove a post-reload follow-up. Page errors: zero.
  Recorded `net::ERR_ABORTED` requests during reload remain in the receipt.
- The previous intermittent `reploidBootRetry` timeout did not reproduce. It
  remains open; these four successes do not establish its repair.
- [New live journey](journey.json.gz) failed on its first answer: an eligible
  exact-identity 2B contributor returned `3` to the Eiffel completion-year
  question although its retrieved National Geographic passage says March 1889.
  The harness now asserts exact model and thread continuity; subsequent journey
  stages did not execute. No complete-journey acceptance is claimed.
- [One exact-request replay on the owned Mac](failed-request-replay.json) also
  returned `3` with 801 prompt tokens. The same failure across two providers
  narrows the issue but does not rule out a shared runtime defect. Its
  `passed` flag means the diagnostic completed, not answer-quality acceptance.
  Both native diagnostic owners closed and GPU cleanup settled.

## Attribution, not a speedup comparison

[Retained request attribution](latency-attribution.json) separates retrieval,
prefill and decode using the existing attempt timestamps and runtime counters.
Residual time includes orchestration and must not be labeled pure network time.
The earlier report incorrectly described all four answers as 2B: only Eiffel
and Paris used 2B; Austen and Curie used 27B in a new thread after reload. That
report is corrected; its raw receipts remain frozen.

[Two exact replays](prefill-probe.json) of the original successful 1103-token
Eiffel request used the owned M3, pinned Doppler 0.6.32 and unchanged options.
Both returned `1889 [2]`. Opening the diagnostic owner took 2296 ms; pipeline
load was 1919 ms (the loader counter is nested, not additive). Repeated requests
reuse the opened model, not a saved prompt prefix.

| Counter | First request | Repeated request |
| --- | ---: | ---: |
| First token, ms | 8696 | 8434 |
| Prefill, ms | 8689 | 8427 |
| Prefill command recording, ms | 193 | 120 |
| Prefill submission/wait, ms | 7022 | 6863 |
| Decode, ms | 1615 | 1506 |
| Complete generation call, ms | 10317 | 9942 |

Submission/wait accounts for about 81% of observed prefill. These existing wall
counters include submission and completion waiting; they are not per-kernel GPU
timestamps or exhaustive attribution. Other participant/browser processes were
active on this shared machine. No isolated speedup, peak-memory measurement,
physical Vulkan result or individual slow kernel is established. The zero
`memoryUsageBytes` field is not evidence of zero memory usage. Decode counters
include speculative/batched work beyond the short visible output; do not infer
useful throughput from operation counts.

Exact model: `qwen-3-5-2b-q4k-ehaf16`,
`sha256:83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`.
Historical model hashes and the pinned runtime are unchanged.

## Reproduction and next gate

The scripts overwrite their adjacent diagnostic outputs; copy this directory to
a new two-level output directory before rerunning if retaining these receipts.
They use already-provisioned weights; no download is performed. The bounded
native probes run at most two and one requests respectively, 256 output tokens,
90-second per-request deadline, with cleanup in `finally`.

```sh
node artifacts/latency-reload-20261018/prefill-probe.mjs
node artifacts/latency-reload-20261018/failed-request-replay.mjs
node artifacts/latency-reload-20261018/reload-probe.mjs
node artifacts/latency-reload-20261018/journey.mjs
```

The live journey requires an available browser-search contributor and model
provider; it uses public synthetic questions. The reload probe requires neither
model execution nor an exact live provider. Native probes use the existing
local model path recorded in their source.

Next: independently reproduce the failed exact request before changing model
arithmetic; qualify any prompt/model candidate on separate unseen questions.
Complete the repaired exact-model journey after answer quality passes. Attribute
GPU prefill operations before another kernel or allocation experiment. Current
CI must be reported separately from focused local checks, preserving optional
skips. No general availability or full service acceptance is established here.

CI for `69d03ecc` passed in [run 39174629205](https://github.com/clocksmith/reploid/actions/runs/39174629205): 4,602 tests passed, 36 skipped across five optional files; installed-package smoke and all five browser boot checks passed. Optional skips remain unexecuted. [Independent answer controls](../search-answer-control-20261018/README.md) follow this checkpoint.
