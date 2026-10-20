# Physical Qwen 2B search service journey — 2026-10-17

**Lifecycle passed; useful-answer acceptance failed.** The entire bounded journey
ran in Chrome on the M3 using the pinned Doppler 0.6.32 native whole-model
contributor and live Bing RSS search. Application source was 70768396; the exact
harness hash and package integrity are in [campaign.json](campaign.json).
The later Doppler preparation changes were not included in this installed package.

[Full receipt](service-journey.json), [test log](journey.log.gz), and
[owned provider log](provider.log.gz) retain the failing output and timing. This
was a private local room with two independent requester contexts and only
campaign-owned contributor processes. No requester weights/tokenizer downloads,
page errors or permission dialogs were observed. No public provider was stopped.

## Outcomes

| Step | Result | First text / complete ms |
| --- | --- | --- |
| Search with sources | Completed, incorrect/unhelpful source set | 7145 / 13208 |
| Contextual follow-up | Completed, wrong answer | 10514 / 11955 |
| Count 1–20 alongside independent movie request | Both correct; both progressed | 1789 / 5072; 4086 / 5578 |
| Cancel counting; unrelated arithmetic | Cancelled; unrelated answer 63 preserved | 2604 / 2740; 2663 / 4044 |
| Reuse after cancellation | Correct answer 42 | 2627 / 4122 |
| Kill owned provider during streaming | Explicit disconnect failure; partial output preserved | 2720 / 20806 |
| Explicit retry on different provider identity | Completed; new attempt, correct retry link | 2677 / 22604 |
| Reload before overlap and after retry | Exact stored thread histories preserved | not benchmarked |

The original execution identity was `peer:ced546ed39da8e5f7fc0c95c`; replacement
was `peer:3b5b29faa98684b7ceb33eba`. This proves different-identity replacement,
not merely reconnecting the same process. It does not prove in-flight continuation:
the interrupted answer stays interrupted and retry recomputes a new attempt.
Transport loss remains distinct from confirmed GPU cleanup.

## Useful-answer failure remains open

Question: “What year was the Eiffel Tower completed? Cite a source.” Bing returned
Year, Current Year, a photo-year guessing game and Calendar Year pages. The model
correctly observed those pages did not supply the requested fact, so the required
1889 answer failed. It cited irrelevant sources. The contextual follow-up asking
the city returned **Marietta**, failing the required Paris answer.

Direct [query probes](query-probes.json) reproduced that upstream source set with
and without “Cite a source.” A keyword query, “Eiffel Tower completion year,”
returned relevant Eiffel pages. No application query rewrite, alternate provider,
or easier replacement question was introduced. The probe's elapsedMs field was
sampled before the await and is invalid timing evidence; only its query/result
mapping is used. Search and follow-up quality need repair before service acceptance.
The earlier movie-selection quality failures remain open and this factual task
does not replace that evaluation.

Soft usefulness assertions let the remaining lifecycle steps execute, but keep
the test and receipt failed. There were no timeout failures in this run; the
provider-loss delay is retained. The two-request case does not establish sustained
fairness, cross-machine throughput, cold loading or broad model quality.

## Reproduction

Provision the pinned model and package; adapt only machine-local paths in the
campaign. Create a private room token in the state directory, mode 0600. Start
an isolated local Reploid server with loopback admission, then run:

```sh
REPLOID_SERVICE_CAMPAIGN=/absolute/path/to/campaign.json \
REPLOID_E2E_BASE_URL=http://localhost:8132 REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test \
  --config tests/playwright.config.js tests/e2e/chat-model-service-journey.spec.js \
  --project chromium --output artifacts/search-service-20261017/browser
```

Live search results can change. Keep failed runs and their sources; do not replace
them with passing keyword probes. The campaign controls a maximum of two requester
conversations and owns only the providers it launches, including their cancellation.

Component: verification evidence. Intent: preserved. Acceptance evidence:
physical lifecycle success with explicit useful-answer failure. Boundary effects:
none; Reploid coordinates and the pinned Doppler package executes.
