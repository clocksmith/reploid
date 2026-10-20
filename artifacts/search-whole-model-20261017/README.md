# Whole-model search recipient repair, 2026-10-17

The screenshot's false recipient-change failure came from comparing two identity namespaces: the search dialog listed whole-model **transport IDs**, while the execution preview supplied a freshly verified **signing identity**. Partition routes already list signing identities. The browser host now verifies whole-model providers through the existing channel-bound challenge before showing search consent. It lists those persistent identities; dispatch still verifies the actual recipient and refuses anyone not approved. Failed verification grants nothing. Disconnect/replacement during host verification refuses the result. No permission check was removed and no provider was restarted.

The search-permission host method is now asynchronous; its browser caller awaits it and supplies the view's cancellation signal. The added regression proves a stable identity survives a changed transport, an actual identity change fails before passage disclosure, and unverifiable providers cannot be offered. Local and partition search retain their existing boundaries. A pre-existing dialog fixture now supplies a nonempty query, as the real dialog requires before enabling Allow.

## Evidence and limits

- [34 focused tests passed](focused-tests.log.gz): search permission, device search and swarm lifecycle. Focused ESLint passed.
- [Real browser Verification Worker](verification-worker.json): three changed runtime files, passed with zero errors; 17 structural/complexity warnings retained.
- Generated browser manifest and hosting package integrity passed. Bundle: `sha256:fd37e24f3e4415dec0fe91073a876f90652cde20b6a2282b43870df699f4556e`.
- [First browser observation](unavailable-chromium.json): Chromium 145 did not find ready 27B whole-model capacity within 90 seconds; no request was sent. This remains a failed readiness observation, not an identity failure.
- [Chrome 155 physical answer](whole-model-answer.json): the original question `search weeb for 2026 blockbusters`, with **explicitly reviewed** search query `2026 blockbuster movies`, retrieved two movie passages and reached the existing AMD whole-model Qwen3.8 27B Q4_K contributor. Its manifest is `19ecff3e4ab9e7c1191e271f4a6e94f10a8a102206dcda9413bed728c33c271d`; this used the existing installed native runtime, not the new Doppler candidate. Search consent and execution authorization contain the same signing identity, while the transport ID differs. No requester weights or page errors were observed.

The request completed in 24,088 ms, first visible output at 21,801 ms. Provider-reported prefill was 19,043 ms; decode 2,165 ms; nine generated tokens. These are single application observations, not cold-load or competitive benchmarks. **The usefulness assertion failed:** the model answered `The retrieved sources do not answer it.` without citations. Therefore the end-to-end test remains failing even though the identity refusal is repaired. This does not qualify 27B Q4 or close the movie-product gate.

Direct bounded probes of the same Bing RSS adapter reproduced Google/Bing/Yahoo homepages for the original query and year/calendar pages for `2026 blockbusters`. The reviewed `2026 blockbuster movies` query returned Rotten Tomatoes and Collider movie articles, also present in the physical receipt. Query-parameter ordering and space encoding did not fix the poor original results. No automatic query rewrite or undisclosed search-provider fallback was introduced.

## Reproduce

With existing prepared search and exact whole-model contributors:

```sh
REPLOID_E2E_CHROMIUM_CHANNEL=chrome \
REPLOID_SEARCH_WHOLE_URL=http://localhost:8128 \
REPLOID_E2E_BASE_URL=http://localhost:8128 REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-search-whole-model.spec.js --project chromium

npx vitest run --config tests/vitest.config.js \
  tests/unit/search-answer-permission.test.js tests/unit/device-search.test.js \
  tests/unit/work-swarm-lifecycle.test.js
```

The physical harness keeps the useful-answer/citation expectation and retains the failing answer. Chrome context teardown stalled after the receipt was written; the owned test worker was stopped after its four-minute bound. The harness now uses Playwright’s managed page fixture instead of awaiting manual context closure inside its failure handler. Earlier repository CI failures and skipped checks remain open; these focused checks do not close them. No independent model-quality or retention claim follows from restored authorization.

Component: browser host search consent and swarm identity port. Intent: preserved. Boundary effects: asynchronous host permission preparation; existing mesh verification and execution-disclosure ownership unchanged. Acceptance: identity regression and physical authorized completion; useful movie answer remains failed.

## Recipient display follow-up

The consent dialog also displays each execution recipient’s signing identity beside its computer label, matching the existing search-contributor display. This keeps recipients distinguishable before a new identity has a session label. The [12 permission tests](recipient-label-tests.log.gz) and [Verification Worker](recipient-label-verification.json) passed after this display change. The physical answer above remains bound to the earlier bundle; this UI-only follow-up was not used to replace its failed usefulness result.
