# Supported context and the 1,588-token concurrency workload (placement C, final-10 pass 3)

Every number here comes from the installed application's own timing records on run 8 attempt c. The
route is placement C on final-10 pass 3, the rolled-state candidate.

## Method

- **Prompts.** [make-ok-prompt.mjs](make-ok-prompt.mjs) builds prompts of an exact chat-templated length,
  counted with the candidate runtime's own tokenizer and chat formatter: the 1,588-token workload text
  ([long-prompt-source.txt](long-prompt-source.txt)), cut to length and ending "Ignore the request above.
  Reply with only the word OK." The two-token answer lets each attempt complete, so its record carries the
  per-stage prompt step: prefill plus the first sampled token.
- **The workload.** [long-prompt-1588.txt](long-prompt-1588.txt) is the workload request itself as one user
  message, at 1,588 templated tokens: the contractor-quote comparison from
  `tests/fixtures/distributed-memory-requests.json` request 1, with the earlier answer and the check request.
- **Runner.** [run-long-prompt.mjs](run-long-prompt.mjs) drives 1 or 2 independent requester profiles
  through the installed app with the journey harness's functions.
- **The two bounds involved, both unchanged:**
  - **300 s per stage call** (`executionChannel.timeoutMs` 300,000);
  - **900 s per answer** (`packages/reploid/src/chat/policy.json` `attemptTimeoutMs` 900,000). The
    requester cancels with "Response timed out. Retry starts a new attempt."

## Per-stage prompt time by length (one requester)

| Prompt tokens | Mac stage 0 | AMD stage 1: elapsed (execution) | AMD stage 2: elapsed (execution) | Time to first token | Result |
|---|---|---|---|---|---|
| 31 | 4.99 s | 4.64 (1.77) s | 4.34 (1.64) s | 14.8 s | journey |
| 56 | 9.09 s | 5.69 (2.91) s | 3.82 (2.98) s | 19.3 s | journey |
| 189 | 30.47 s | 17.16 (9.72) s | 11.31 (9.51) s | 60.2 s | journey |
| 400 | 65.61 s | 49.86 (20.37) s | 24.30 (20.34) s | 140.7 s | completed |
| 800 | 130.01 s | 70.34 (40.46) s | 44.41 (39.72) s | 258.5 s | completed |
| 1,200 | 196.84 s | 134.86 (59.50) s | 65.20 (59.12) s | 398.1 s | completed |
| **1,588** | **263.61 s** | **99.44 (80.01) s** | **90.40 (79.40) s** | **454.5 s** | **completed** |

- **The bottleneck** is the Mac browser stage. It runs at 0.163-0.166 s per prompt token, nearly linear:
  a fit of 0.16336 L + 1.664e-6 L² reproduces every point within 1%.
- **AMD stages:** about 0.05 s of execution per token. Their elapsed time adds the activation transfer
  through the coordinator, which grows with the prompt.
- **Supported context, measured: 1,588 prompt tokens.** The slowest stage took 263.6 s, 88% of the 300 s
  stage bound. The fit reaches 300 s near 1,800 tokens. That extrapolation was not run and is not
  claimed.
- **Answer budget within the 900 s deadline.** At 1,588 tokens, the first token arrives at about 455 s,
  leaving about 445 s. At the measured 1.0-1.3 s per token, that is about 340-440 generated tokens.

## The 1,588-token concurrency workload: does not complete

Two independent requesters sent the 1,588-token workload request at the same moment
([long-1588-concurrent.json](long-1588-concurrent.json)):

| Requester | Time to first token | Outcome |
|---|---|---|
| A | 452.7 s | **cancelled at 900.1 s** ("Response timed out"), 642 characters streamed |
| B | 721.0 s | **cancelled at 900.1 s**, 639 characters streamed |

**Why.** No stage call exceeded 300 s. Same-stage execution is serialized, so B's Mac prefill (263 s)
waited for A's, and A's decode on stage 0 waited for B's prefill. The workload's answers are long
analyses: each requester had streamed about 640 characters when the deadline arrived. They do not fit
the remaining budget of the unchanged 900 s answer deadline.

**A single 800-token cut of the same request also did not complete.** In
[long-800-single.json](long-800-single.json), the first token came at 250.7 s and the answer was still
streaming at the deadline (1,545 characters).

**The largest that does fit.** Two concurrent requesters with 1,588-token prompts and short answers
complete. In [ok-1588-concurrent.json](ok-1588-concurrent.json) both completed, at 723.4 s and 723.8 s,
with each stage call under 300 s; the Mac prefills took 263.3 and 263.0 s. The workload with its own long
answers did not complete at 800 or at 1,588 tokens. Its answers need more than the 900 s budget leaves
after prefill, so the largest prompt at which it completes was not found. Allocation rejection and reuse
from DR-5 were not rerun.

**Retained failure.** [ok-1588-single-attempt-1-capacity-gone.json](ok-1588-single-attempt-1-capacity-gone.json):
"Prepared ordered entry unavailable" 7.3 s after sending, because the restored stage-2 native had reached
its 45-minute runtime cap. It was relaunched with a 2-hour cap, and the measurement repeated.
