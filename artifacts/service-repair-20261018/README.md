# Reploid service repair — 2026-10-18

Ordinary follow-ups now retain digest-checked passages from completed turns in
the same conversation, including after reload and explicit retry. The new Send
authorizes the actual input. Search-only requests still exclude conversation
history; cached passages are not presented as freshly fetched evidence.

Component: conversation workspace and service verification. Intent preserved:
Reploid owns context, disclosure and lifecycle; Doppler computes. The chat charter
now explicitly specifies retained-source follow-ups. No model arithmetic,
runtime package, public contributor or model identity changed.

## Evidence and limits

- 38 focused workspace, retrieval and search-permission tests passed, including
  retained-context reload/retry, corruption refusal and conversation isolation.
  Library type checking and the generated browser-byte check passed.
- [Live arithmetic](live-arithmetic.json.gz): deployed `replo.id`, weightless
  requester, exact Qwen 2B whole-model provider, answer `42`.
- [Live search failure](live-search.json.gz): the original Eiffel completion-year
  question still retrieves unrelated Year/Calendar pages through a contributor's
  Bing RSS adapter. This remains an unresolved product failure.
- [Corrected private physical journey](corrected-journey.json.gz),
  [summary](summary.json), [provider log](corrected-provider.log.gz) and
  [frozen contract](campaign.json): M3, pinned Doppler 0.6.32, two independent
  weightless Chrome requesters. Overlap, isolated cancellation, reuse, different
  provider identity, linked retry, preserved partial output and reload passed.
  The follow-up dispatched the retained passages and answered `Paris` without
  another search (first text 2878 ms; complete 4258 ms).
- The **overall physical test remains failed**: its diagnostic keyword prompt
  `Eiffel Tower` produced a relevant summary without `1889`, while the inherited
  year assertion required that value. This is neither the original question nor
  evidence that natural-language search was repaired. No assertion was relaxed.
- The [initial run](initial-journey.json.gz) and [log](initial-provider.log.gz)
  retain a separate harness failure: Search resets after one answer, but the test
  blindly clicked it again before the follow-up. That accidentally searched the
  isolated question and answered `Montrose`. The harness now checks and asserts
  Search is off, and asserts the follow-up has no new retrieval record. The older
  October 17 receipts remain unchanged; their follow-up interpretation requires
  this qualification.

These are functional observations under existing machine load, not latency
benchmarks or movie-task acceptance. No public contributor was stopped. Only
campaign-owned providers were interrupted; room tokens are not published.

## Browser-search experiment rejected

A fresh unsigned-in Chrome session initially returned relevant Bing results for
the Austen question. Repeated exact-question checks did not hold up: unrelated
or hidden results and deadlines remained. Google, DuckDuckGo and Brave presented
human-verification challenges; none were bypassed. No personal browser was
attached. The proposed contributor adapter and protocol changes were removed.
[Candidate patch](rejected-browser.patch.gz) and
[failed browser probes](browser-search-probes.json.gz) are retained, not active.

The current search path is still contributor-owned public Bing RSS. An existing
browser adapter interface is not evidence of an attached, reliable browser
service. A working contributor/browser session must pass the original natural
question and unseen questions before replacing this path. No paid API was enabled.

## Reproduction

Run the three focused suites:

```sh
npx vitest run --config tests/vitest.config.js tests/unit/chat-retrieval.test.js tests/unit/search-answer-permission.test.js tests/unit/chat-workspace.test.js
```

For the physical lane, copy `campaign.json` into private state, provision its exact
existing model, create an owner-only `room-token` file with mode 0600, and choose
a fresh private room/state directory. Keep the 600000 ms/two-request bounds.

```sh
REPLOID_SERVICE_CAMPAIGN=/absolute/private/campaign.json REPLOID_E2E_BASE_URL=http://localhost:8132 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/playwright.config.js tests/e2e/chat-model-service-journey.spec.js --project=chromium --workers=1
```

Doppler main `31e777b3` has successful hosted CI; software Vulkan remains separate
from physical qualification. Reploid's pinned package and historical model hashes
were preserved. An initial installed-Doppler smoke invocation stopped at its
missing `DOPPLER_TEST_CONSUMER` precondition, before execution. A discovered
same-version consumer differed from the pinned archive and was not substituted.
Instead, a fresh consumer installed Reploid's exact pinned archive and ran the
public integration smoke successfully: 64 phase calls, 64 released results and
two closed sessions, including cancellation, streaming and adapter cleanup.
[Installed smoke summary](installed-smoke.json) retains the archive identity and
lockfile. These injected-logit fixtures establish API behavior, not model quality
or community training qualification. The physical lane used the same pinned
runtime with actual Qwen weights.

## Deployment and remaining gates

Commits `434638d9` and `faba1d4d` were pushed to main. Hosting-only deployment
completed on October 18; live bundle identity is
`sha256:40e64aa43d8569c8f9010a01456201db55c42f40749312e34286d20c60efc0fc`.
[Live post-deployment requests](deployed.json.gz) returned a sourced Eiffel summary
and `Paris` on the ordinary follow-up through the physical 2B contributor.

One subsequent live reload timed out after entering `reploidBootRetry`; no page
exception had been recorded. It remains an unresolved intermittent boot failure.
A [fresh empty-history reload](reload-probe.json.gz),
[retained-history restoration](reload-retained-history.json.gz), and
[three subsequent reloads](deployed-reloads.json.gz) passed. The latter restored
the exact retained synthetic conversation into a fresh test profile, then compared
all thread records after each reload (4981, 2452, 1990 ms). These follow-up checks
do not erase the initial failure.

CI run `39164235021` failed solely because the updated chat charter exceeded its
250-word limit: 4593 tests passed, one failed, 36 skipped. The charter was shortened
without changing requirements, its index regenerated, and all seven charter tests
passed locally. Downstream installed-package/browser steps from that failed run
remain unexecuted until a subsequent complete CI run passes.

The separate, unsigned-in contributor Chrome profile is waiting at Google's
human-verification page. No attached browser search service or new provider has
been enabled. Search usefulness and the intermittent reload are still open;
this checkpoint does not declare the product journey fully accepted.
