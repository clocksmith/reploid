# Contributor search followed by split 27B synthesis

The existing live site completed the combined browser journey on October 16,
2026: question, contributor search, fetched passages, separate execution
permission, two-stage Qwen3.8-27B Q4K generation, and linked citations.
No model reconversion, new GPU process, service restart, or runtime deployment
was needed. The tested bundle is recorded in `live-build.json`.

## Successful observed request

`attempt-2.json` retains the question “What is WebGPU used for?”, both permission
dialogs, retrieval provenance and passages, answer, and execution receipt.

- Search contributor: `peer:691a71be6c88b33d7f0123d2`, the existing Mac browser
  contributor with its native public-page bridge. The request retrieved five
  fetched passages through Bing in 4.482 seconds.
- Execution: existing Mac input stage and AMD output stage, manifest
  `19ecff3e4ab9e7c1191e271f4a6e94f10a8a102206dcda9413bed728c33c271d`, plan
  `b16f75916a28265354eb89ac2260d100fe44e2083e2f014f2aa1d0a2903dda7b`.
- First persisted answer text: 76.01 seconds after Send. Completed answer:
  98.12 seconds, including search and browser approval handling.
- The answer contains two factual sentences, both citing source 2. Its fetched
  Wikipedia passage explicitly describes graphics, games, AI/machine learning,
  and efficient cross-platform GPU access. Citation markers resolve to the
  recorded source and render as links. No requester weights were downloaded;
  no browser page errors were recorded. Generation ended on EOS.
- The prompt contains 1,080 tokens. Stage prompt elapsed times are 2.065 seconds
  on Mac and 67.768 seconds on AMD. The receipt records 37 generation steps,
  including terminal work. These are one-run observations with other providers
  resident, not isolated benchmarks. Runtime subintervals do not account for
  all stage elapsed time and must not be treated as an additive GPU profile.

The automated citation verifier reports two resolved, cited claims and zero
unresolved citations. Semantic support remains `unverified` in that record:
there is no configured independent support checker. The passage inspection above
is limited to this answer; it is not a broad answer-quality qualification.

## Preserved failed case and harness limits

`attempt-1.json` records the longer question beginning “According to MDN” and
including answer-format instructions. The unchanged full message was sent as
the search query. Search returned dictionary results; only a Vocabulary.com
page about “According” was fetched successfully. The split model completed with
“The retrieved sources do not answer it.” The cited-answer assertion failed.
This demonstrates a retrieval-relevance limitation, not a split execution failure.
The shorter question is a separate test case, not a relabeled successful retry
of the original input. No query-planning fix is claimed.

Both runs used existing 256-token output and retrieval limits; neither changed
provider resource budgets. The successful test completed all assertions and
closed its browser, but its Playwright worker remained alive during teardown.
Only that owned test worker was terminated afterward, allowing the reporter to
flush `1 passed`. This cleanup issue is separate from the retained completed
application receipt. No contributor process was terminated.

## Reproduction and boundaries

```sh
REPLOID_E2E_BASE_URL=https://replo.id REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome REPLOID_SEARCH_SPLIT_URL=https://replo.id \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-search-split.spec.js --project=chromium
```

The test requires prepared, reachable search and split contributors. It does
not prepare hardware or grant ongoing search permission. The existing split
lifecycle test now targets the themed radio choice rather than the hidden
native select; its full lifecycle campaign was not repeated here.

Post-check services remained active: AMD 0.8B (2963679), 2B (2967869), whole 27B
(482901), split 27B (1739039), and search (1769062); Mac split launch agent
`id.replo.qwen27b-split` remained PID 57903.

Component: browser integration evidence. Intent: preserved. Acceptance evidence:
the opt-in Playwright test, two retained request records, and `cited-answer.png`.
Boundary effects: none to runtime or provider configuration. Existing numerical
tolerance evidence remains separate and unchanged.
