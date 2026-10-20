# Send without permission popups

The conversation view no longer renders or opens search or contributor approval
dialogs. Send uses the default-on network-answer policy; selecting search starts
that tool, and Retry starts a fresh search without another approval. Observed
search, page-reading and result-preparation progress appears in the thinking
loader. Network opt-outs remain effective and produce inline explanations.

Component: conversation UI, browser host, chat search authorization.
Intent: deliberately changed from dialog consent to Send/Retry authorization,
as requested by the owner. The product contract and component charters reflect
that change. Boundary effects: search records optionally carry `source: send`;
legacy records retain their provenance. Model/recipient verification, contributor
capacity, download controls and spending bounds are unchanged.

Evidence:

- [97 focused tests](focused-tests.log.gz): host/session, conversation UI,
  search grants and retries, network opt-out, reload/history and message display.
- [12 search tests after provenance assertions](provenance-tests.log.gz):
  Send provenance, legacy compatibility and refusal of an unknown source.
- [Two Chrome tests](browser-tests.log.gz): no-popup Send/Retry, observed tool
  progress and cancellation using an injected session; real Verification Worker.
- [Loader screenshot](tool-loader.png), [Verification Worker result](verification-worker.json)
  and [verified runtime hashes](source-hashes.json).
- Focused ESLint and browser build passed. Browser fixture execution is not
  model execution, real search, performance or numerical qualification.

Reproduce the browser checks without starting a server or using a contributor:

```sh
REPLOID_E2E_CHROMIUM_CHANNEL=chrome REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
  npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-tools-no-popup.spec.js --project chromium
```

The existing physical whole-model search harness now expects no popups and types
its query directly. It was not rerun against a GPU for this presentation change.
The earlier 27B useful-answer failure remains open in
[the physical search evidence](../search-whole-model-20261017/README.md).

Earlier CI failures and skipped checks remain open. The repository-wide charter
validator encounters unrelated temporary checkout/source trees and a stale
component index; this is not a passing repository-wide charter check. The three
changed charters meet the 250-word limit after the edit.
