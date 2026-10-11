# Reversed contributor recovery after document reuse

The focused physical run `2026-10-11T11-31-14-805Z` completed both contributor
interruption/rejoin/retry sequences and replacement of participant B. Its overall
verdict remains **failed**: the unaffected counting answer ends after 120 of the
required 200 lines. Numerical acceptance was not applicable to this 2B run.

Mac ran partition 0, layers 0–3; Linux ran partition 1, layers 4–23. The unchanged
Doppler 0.6.27 archive and browser identity are recorded in [review.json](review.json).
The command was `REPLOID_E2E_DOCUMENTS=1 node scripts/test-distributed.js --local
--recovery --reverse --model qwen-3-5-2b-q4k-ehaf16`, from Mac source `a883ebac`.
Served Linux browser assets remained fixed throughout this run; no secondary CDP
client attached. The later immutable-snapshot harness correction was not exercised.

[physical-run.tar.gz](physical-run.tar.gz) retains the complete original result,
Playwright report, logs, screenshots, acquisition, attempts, memory, and lifecycle
records. Its SHA-256 is `5c6c7a903ef465f45cc77d470d4b25ab7f95604c1219b8ced14cc5e51a77576f`.

Both interrupted contributors reopened, retried under new attempt identities,
and subsequently answered `YES`. The unchanged contributor kept its resident
weights and inventory; prior messages, attempts, and drafts survived. The original
seed stopped sharing before the replacement acquired 940,946,816 verified bytes
from retained peers. The replacement preserved participant A, changed participant
B, and completed a fresh attempt while retaining the interrupted partial answer.
Each retried counting request returned every integer 1 through 20 exactly. All 13
completed attempts report settled cleanup for both participants.
No requester weights, contributor origin requests, or runtime errors were observed.

Peak allocated bytes were 1,320,233,832 on Mac, 1,400,055,944 on the original Linux
executor, and 1,278,272,144 on the replacement, under the unchanged 1,420,000,000
ceiling. Immediate stop snapshots retain some deferred or reusable allocations;
they are not evidence of zero allocated bytes. Browser lifecycle capture recorded
only the five initial page navigations, with no extra navigation or crash.

The two document answers completed at EOS after 2,248 and 1,874 steps. Their exact
contents match the previous answers, so the retained
[source-grounded quality failures](../reverse-recovery-20261011/document-quality-review.json)
still apply. Completion is distinct from useful, accurate answers. Checklist 15
remains open because the unaffected counting answer is incomplete; this diagnosis
does not qualify both placements or the complete application.

[stage-timings.json](stage-timings.json) contains the 13 completed attempts'
bounded aggregates. During the concurrent counting/YES pair, lease waiting totals
were 640.2/395.7 ms and output callbacks 7.1/0.3 ms. Remote stage time dominated
local stage time in the document requests, but includes nested transport and
remote computation scopes. These instrumented observations do not demonstrate a
stage-overlap benefit or justify adding the nested durations together. No scheduler
change or latency improvement is claimed.

Component: verification evidence. Intent: preserved. Acceptance: the retained
physical command and JSON consistency checks for both new retry identities,
replacement identity, unchanged inventory, no origin access, exact document text,
and the single retained failing assertion. Boundary effects: none.
