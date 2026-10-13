# Fresh requester preparation

The actual host catalogue projected a connected whole-request contributor as
`loading`, but the composer offered **Retry connection**. Its preparation predicate
only checked local loading and partition peers. The repaired predicate also checks
the selected catalogue model; unrelated model preparation does not hide retry.

Screenshot review then exposed a second boundary: the rail layout hides the header
status on the home route. The first predicate-only check passed while no preparation
guidance was visible. `predicate-only/` retains that limitation. The final source
uses the existing composer status line even without a prior attempt, hides it when
ready, and keeps unavailable/preparing states readable without changing navigation.

## Evidence

- `before.txt`, `before/`: four actual Chromium failures against the retained old
  component, served only through a test interception. No shared source rollback.
- `after.txt`, `after/`: four passing cases, light/dark at 390 and 1440 pixels.
  Actual session/catalogue/UI execute loading → ready → unavailable; draft remains
  intact, Send follows readiness, Retry appears only when unavailable. Each JSON
  retains actual served JavaScript/CSS hashes and visible composer observations.
- `compact-material.txt`: affected existing compact-chat case passes at 320 × 460;
  full local boot blocks external HTTP/WebSocket before injecting presentation state.
- `before-phone.png`: original exploratory reproduction.
- `worker.json`: actual Verification Worker passes for production UI, focused unit
  test, browser test and configuration; warnings retained.
- Root's focused unit run passed 20 cases, including unrelated model preparation.
  An initial invocation without `tests/vitest.config.js` failed because `document`
  was unavailable; this was a harness environment failure, not a product result.

The screenshots were inspected in both themes at phone and desktop widths. The
header's DOM text remains separately recorded as hidden; it is not visual evidence.
This is a browser component regression with injected discovery, not a model answer,
physical contributor, fresh installed application, or deployment qualification.

## Reproduce

From the Reploid repository root (port 29873 must be free):

```sh
REPLOID_FIRST_USE_BEFORE=1 REPLOID_FIRST_USE_EVIDENCE=artifacts/first-use-preparation-20261013/before npx playwright test --config=artifacts/first-use-preparation-20261013/playwright.config.js first-use-preparation.spec.js
REPLOID_FIRST_USE_EVIDENCE=artifacts/first-use-preparation-20261013/after npx playwright test --config=artifacts/first-use-preparation-20261013/playwright.config.js first-use-preparation.spec.js
npx playwright test --config=artifacts/first-use-preparation-20261013/playwright.config.js chat-material.spec.js --grep "compact chat keeps"
node artifacts/first-use-preparation-20261013/verify-worker.js
```

The existing proxy serves only the local fixture; Chromium has GPU/WebGPU disabled,
external requests are blocked, and no application boot or inference is started.
The proxy and browser terminate with the run.

Component: conversation UI. Intent: preserved. Acceptance: the commands and receipts
above. Boundary effects: catalogue readiness now reaches the existing composer state.
