# Whole-model service and movie-task evidence, 2026-10-17

**The shared-service lifecycle passed. The movie workload failed: 5/12 exact answers.** This model/task pair is not ready for recruitment. No people were contacted; repeat usage, preference, complete cost and competitive application value remain unmeasured. Earlier failed and skipped [CI checks remain open](../connection-journey-20261017/README.md#ci-failures-remain-open).

## Exact scope

Qwen3.5 2B `qwen-3-5-2b-q4k-ehaf16`, manifest `83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`: Q4_K weights/output head, f16 embeddings/KV, f32 computation. The whole-model Node 22.20.0 contributor and Chrome 155.0.8059.80 requesters ran on Apple M3 with 24 GiB unified memory. Both campaigns used application `ca228707`, native host `721cd862`, and Doppler candidate archive SHA-256 `6b057b0e526a7a18afcefd655cb2fc4acb96e958962eee5a67b3caee231be1f9` from source `8b211c3f`. The isolated catalog used repetition penalty 1.0; public catalog policy was unchanged. [Runtime archive and physical qualification](https://github.com/clocksmith/doppler/tree/main/reports/qwen-service-qualification-20261017).

The [movie contract](contract.json) froze six conversations, twelve turns, a 240-second bound and exact expected answers before inference. [Shared-journey contract](shared-journey-contract.json) bounds concurrent requesters to two. Both used a private room and owned contributor; existing public contributors were untouched. This is local physical evidence, not deployment or independent adoption. The automatic stage-assignment changes described below were tested separately and were not used by these whole-model campaigns.

## Shared service

[Receipt](shared-journey.json) and [test log](shared-journey.log.gz) record nine attempts. Two fresh browser contexts approved network answering; each attempt binds exact model and recipient. That standing permission is broader than a manual per-provider chooser. Neither requester downloaded model shards/tokenizer; neither reported page errors. Histories survived reloads.

| Request | First visible output ms | Terminal ms | Outcome |
|---|---:|---:|---|
| Arithmetic | 2131 | 5049 | 42 |
| Contextual follow-up | 1749 | 4074 | 40 |
| Count 1 through 20 | 1993 | 7515 | All twenty numbers |
| Independent movie choice, overlapping count | 7073 | 9527 | Cedar; both completed without cancellation |
| Longer count | 3277 | 3558 | Cancelled while another request waited |
| Independent arithmetic | 5524 | 8079 | 63; unaffected by the other cancellation |
| Reuse after cancellation | 3368 | 5961 | 42 |
| Contributor killed during output | 3583 | 20653 | Failed; partial answer retained |
| Explicit retry after reconnect | 3426 | 27981 | Completed; fresh attempt linked to failure |

Times start at send/retry and include application/transport/waiting overhead. These single observations are neither cold startup measurements nor kernel decode rates. The overlapping request waited; the result proves progress for this bounded pair, not fairness under sustained arrivals. Reconnection kept the same contributor identity with a new transport. It does not prove replacement by another participant or inference-state migration. The unrelated conversation remained intact. Transport failure was not asserted as confirmed cleanup.

The first expanded run typed before asynchronous thread selection finished after reload. Its [failed receipt](shared-journey-before-selection-wait.json) and [log](shared-journey-before-selection-wait.log.gz) remain available. The harness now waits for the selected thread's visible `aria-current` state before typing; the succeeding run retains all history and lifecycle assertions.

## Movie workload failed

The [frozen catalog and prompts](../../tests/fixtures/movie-service-tasks.json) use fictional metadata, avoiding external availability guesses. [Every answer and bound execution request](service-tasks.json) is retained. All twelve receipt prompts match their actual request's last user message. Six reload/history checks passed, with one explicit network-answer permission and no requester weights or page errors. Median first visible output was 2709 ms (2394–2894); median complete latency was 4169 ms (3883–5565). These are application observations on an already prepared provider, not isolated prefill timing.

| Conversation | First turn | Follow-up |
|---|---|---|
| Change format, retain time/audio constraints | Cedar: pass | Clover instead of Pine: fail |
| Group constraints | `None` instead of `NONE`: format failure | Explanation containing Harbor instead of title only: format failure |
| Subtitles and duration | Clover: pass | Clover instead of NONE: fail |
| Shortest, then exclude | Cedar instead of Pine: fail | Clover instead of Cedar: fail |
| Unknown streaming availability | Invented Cedar instead of UNKNOWN: fail | Supplied available titles: Cedar, pass |
| Distinguish audio from subtitles | Meadow: pass | Pine: pass |

Two failing turns conveyed the intended semantic answer but broke the frozen output contract. Five failed task constraints; follow-up outcomes can inherit earlier mistakes, so they are not independent samples. Even if the two formatting failures were accepted, 7/12 would still fail the frozen 12/12 gate. No expected answer, prompt or acceptance threshold was relaxed after seeing outputs. Movie picking remains a plausible recurring task to investigate, not a validated use case for this candidate. No live streaming catalog, search integration or human preference has been tested.

### Request history audit

The [offline audit](history-audit.json) checks the original suite digest, all twelve
request message sequences, distinct attempts, per-conversation thread identity,
model identity and completion reasons. Each sequence contains its supplied catalog
and question followed by the actual preceding answer and next question. All twelve
match, including all six follow-ups after reload. All terminate at a stop token.
The audit hashes the unchanged suite and receipt; it performs no model execution.

The first observable task failure is `format-followup/2`: the request retains the
under-90-minute constraint and changes the format to animated, but the answer is
Clover (96 minutes), rather than Pine (81). The requester did not drop that
constraint. The recorded `ca228707` workspace constructs completed history; its
resident provider clones those messages, and its provider resets generation state
before passing them to Doppler. The receipt does not retain provider-side input
token IDs, so this audit cannot distinguish model limitations, prompt/template
effects and numerical execution errors. No production repair is established.

`rank-and-exclude/2` also has a dependent oracle: the frozen expected Cedar assumes
the first answer was Pine. The actual first answer was Cedar, so "exclude that one"
refers to Cedar in the delivered conversation. The returned Clover still is not
the shortest eligible comedy, but this turn cannot be counted as an independent
clean exclusion test. Preserve the 5/12 rejection. Future isolated exclusion tests
must name the excluded title or score against the actual preceding answer under
a rule frozen before execution.

The physical task harness now asserts the complete request history, including the
system context, rather than only the latest user message, and retains untrimmed
response text separately from the existing trimmed scoring field. The existing
workspace isolation test now crosses a save/restore boundary and asserts that
restoration does not resend. All 16 workspace tests pass; scoped syntax and lint
checks pass. These checks do not rerun the physical workload or improve its score.
The subsequent [independent control](../movie-request-control-20261017/README.md)
replays two exact failed requests: both wrong answers and all output token IDs
match independent Transformers CPU execution over the same retained Q4_K bytes.
These failures are not specific to Doppler execution; base-model versus
quantization attribution remains open. The original 5/12 score is unchanged.

## Useful preparation and contribution isolation

Automatic ordered-stage contributors previously prepared a redundant stage even when every stage was already supplied, or an isolated stage when too few willing participants existed to complete a route. The existing policy now leaves these contributors waiting without loading weights. It prepares missing stages only when observed suppliers plus willing joiners cover a prospective route; excess joiners wait. With explicit replica policy, one joiner addresses observed queue/bottleneck demand and others wait while that replica prepares. Waiting contributors re-evaluate discovery and can fill a departed supplier's gap. Stopping while waiting prevents later preparation. Existing busy residents stay pinned; request placement still requires actual prepared capacity.

The public `StageAssignmentDecision.index` can now be `null`, with `waiting-for-route` or `no-useful-assignment`; consumers must not treat a waiting decision as a stage number. This is a change to the existing opt-in partition policy, not activation of partitioning or new orchestration. Whole-model providers remain the default. Discovery is partial and expiring, so this is an observed usefulness decision, not a guarantee against duplicate preparation under inconsistent network views. It does not implement a global allocator for storage, bandwidth or whole-model replicas.

- [20 focused tests passed](useful-assignment.log.gz): assignment, simultaneous joiners, waiting, departure, demand, owner stop and existing busy-resident hysteresis.
- Library TypeScript consumer check, focused ESLint and regenerated browser-byte manifest check passed.
- [Real browser Verification Worker](verification-worker.json) passed both changed runtime files with zero errors and eight retained structural/complexity warnings.
- [57 boundary tests passed](service-boundaries.log.gz): scheduler, host lifecycle, native ownership, assignment and replicas. This run preceded the assignment change; its assignment coverage is superseded by the 20-test run above.
- [Four browser checks passed](contribution-browser.log.gz): verified bounded storage acquisition and reload persistence; stop acquisition without stopping chat; competing tabs cannot exceed the shared allowance; real Verification Worker. These use actual OPFS/IndexedDB with synthetic model bytes/transport and injected chat execution. They do not prove GPU memory accounting or physical model execution while contributing storage.

## Reproduction and unresolved gates

Reconstruct the exact application/native/runtime candidate using the [original campaign instructions](../model-service-20261017/README.md#reproduce-and-close-the-remaining-gates), retain the generation settings in `contract.json`, and use a private owned state directory. The committed contracts contain paths, not the private room capability or identity secret. Adjust paths for the local installation. Run the shared journey with `REPLOID_SERVICE_CAMPAIGN` pointing to `shared-journey-contract.json`; the harness owns startup, termination and restart of that contributor.

With that exact contributor prepared separately, run the movie suite using its private request URL in `REPLOID_NATIVE_CHAT_URL` (supply the capability locally; do not publish it):

```sh
REPLOID_NATIVE_CHAT_MODEL=qwen-3-5-2b-q4k-ehaf16 \
REPLOID_CHAT_TASK_SUITE=tests/fixtures/movie-service-tasks.json \
REPLOID_E2E_BASE_URL=http://localhost:8127 REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-native-whole-model-tasks.spec.js --project chromium

npx vitest run --config tests/vitest.config.js \
  tests/unit/partition-stage-assignment.test.js \
  tests/unit/automatic-ordered-assignment.test.js \
  tests/unit/automatic-ordered-replicas.test.js
```

The movie harness was subsequently hardened to exclude all pre-existing attempt IDs and wait for visible thread selection; the retained twelve answers were audited against their exact requests and are not stale-attempt matches. No extra physical run was used to replace these failed quality results.

The service gate remains incomplete until a candidate passes the frozen task and a separate holdout, sustained arrivals demonstrate fairness, different-participant replacement is exercised, and the named CI failures/skips actually close. Recruitment remains blocked on task quality. Complete cost against a shared server and competitors, useful human completions, voluntary returns and independent application retention are still absent. The [27B Q4 exclusion and F16 control](../model-service-20261017/README.md#frozen-quality-results) remain in force.

Component: partition contribution policy and service verification. Intent: preserved. Acceptance: scoped evidence above, with quality and CI failures retained. Boundary effects: no new subsystem; Reploid owns coordination and permissions, Doppler owns preparation and execution.
