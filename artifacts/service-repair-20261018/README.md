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

The existing boot-recovery test still intercepted an obsolete unbundled module.
It now interrupts `app.bundle.js` and checks the current conversation workspace.
A second check requires a visible terminal error after two failed loads, without
an automatic reload loop. Both passed in physical Chrome locally (497/445 ms);
both are now included in CI's browser smoke alongside its existing wizard checks.

CI run `39164235021` failed solely because the updated chat charter exceeded its
250-word limit: 4593 tests passed, one failed, 36 skipped. The charter was shortened
without changing requirements, its index regenerated, and all seven charter tests
passed locally. Downstream installed-package/browser steps from that failed run
were later executed successfully in runs `39164687957` and `39164826979`. The latter also ran the two updated product-root recovery checks. Optional unit skips remain separate from executed coverage.

## Browser contributor repair

After the owner manually completed Google's human check, the dedicated profile
passed the original natural-language question and the Austen/Curie source probes.
Commit `c2f02f5b` adds an opt-in native browser worker using that isolated profile.
Google redirects use its session; extracted pages still use the bounded,
DNS-guarded public reader without cookies. Search is serialized; busy requests
refuse, cancellation closes its tab, and pending redirect work settles before
reuse. Personal profiles are refused. Closing the browser withdraws its offer;
human checks remain manual. No new permission popup was added.

The [first live attempt](live-browser-search-unavailable.json.gz) and
[settings-confirmed attempt](live-browser-search-no-ready-model.json.gz) could
not send because no eligible exact 2B provider was ready. The owned contributor
then prepared the already-provisioned 2B model; no new weights were downloaded.
The [next attempt](live-browser-search-reload-race.json.gz) answered `1889 [2]`
and `Paris`, but reload exposed the old Bing offer before the browser provider
reconnected. Its Austen query returned irrelevant sources and an explicit unknown.
The browser host now waits for its selected browser service instead of falling
back to RSS. The legacy native adapter remains available only by explicit choice.

Hosting deployed bundle
`sha256:b278658b701cc1e24a8ca5530bd2fc07f87733140e9963c70aedca26f07f59f8`.
The [final live receipt](live-browser-search.json.gz) and
[compact results](browser-search-summary.json) record four completed answers:
`1889 [2]`, `Paris`, Jane Austen with citations, and Physics (1903) / Chemistry
(1911) with citations. Reload preserved exact conversation records. Each new
search used `contributor-google-browser`; the Paris follow-up reused retained
context without another search. No requester weights, page exceptions or search
permission dialogs occurred. **Correction from the retained receipts:** only the
Eiffel and Paris answers used the owned Mac's whole-model Qwen 3.5 2B Q4_K.
After reload, Austen and Curie ran on 27B in a newly created thread. History
records survived, but the selected conversation did not. The original harness
checked stored records without asserting selection or model continuity; its
`passed: true` does not establish the complete exact-model journey. Raw receipts
remain unchanged. The [selection repair and new evidence](../latency-reload-20261018/README.md)
qualify that claim. These are bounded functional observations, not general
answer-quality or performance qualification.

First output / complete latency in milliseconds:

| Question | Model | First output | Complete |
| --- | --- | ---: | ---: |
| Eiffel completion | 2B | 12856 | 14497 |
| City follow-up | 2B | 9964 | 11635 |
| Austen | 27B | 29159 | 32071 |
| Curie | 27B | 19599 | 26778 |

The physical contributor and browser must remain available; this is not an
always-on availability guarantee. Source extraction refusals remain explicit.
The earlier intermittent reload timeout and rejected movie quality remain open.
After this live harness saved its successful assertions and its Chrome child
exited, Node retained an idle child-process pipe (no active requests). The owned
harness process was stopped explicitly. This does not qualify natural process
exit; the reproduction now closes its context explicitly and records completion
after browser close. The contributor process was left running.

Focused checks passed: browser worker (five tests), contributor routing (seven),
search authorization (twelve), native participant (twelve), native delivery
(three), library types and browser-byte generation. The native-delivery suite is
excluded from the default configuration; its first invocation found no tests,
then the explicit heavy configuration executed all three successfully.
CI for runtime `c2f02f5b` passed in [run 39166022261](https://github.com/clocksmith/reploid/actions/runs/39166022261): lint, unit/integration, Chromium installation, installed-package smoke and all five browser boot checks. Five optional test files remain skipped; successful CI does not count them as executed. Later evidence-only commits do not change deployed runtime bytes.

Reproduce against the deployed route with the browser contributor and exact 2B
model already ready:

```sh
node artifacts/service-repair-20261018/reproduce-browser-search.mjs
```

The reproduction runs three searches and one follow-up, verifies citations,
provider identity, reload history and zero requester weight requests. Its
synthetic questions are development checks, not protected task evaluation.
Component: hosted browser adapter, peer service identity and browser composition.
Intent preserved; no model arithmetic or Doppler package changes. New service
wording binds Google and its exact contributor under existing Send authorization.
