# Connection journey verification, 2026-10-17

Reconnect and stale-update coverage is complete for the exercised boundaries below. No telemetry was added. The deployed Qwen3.5 2B whole-model journey passed independently of the local presentation fixture. Repository CI was **not green at this observation**; the later [clean-checkout repair](../ci-repair-20261017/README.md) records the successful run.

## Connection and UI evidence

`tests/unit/swarm-signaling-independence.test.js` now verifies that a replacement connection authenticates and carries traffic after delayed open/close/state callbacks and application messages from the retired connection. The old message is not delivered; the new message is delivered once; the new connection stays open and can send. Existing tests cover failed RTC recovery, healthy-peer preservation and explicit-disconnect cancellation.

Focused run: 56 tests passed across `swarm-signaling-independence`, `work-swarm-lifecycle`, `preparation-progress`, and `network-controls`. The extended reconnect test file then passed all 20 tests. The host tests preserve unknown cleanup across reconnect and exercise explicit cleanup retry; a lost transport is not cleanup confirmation.

The expanded `chat-rail-layout.spec.js` connection journey passed in light/dark themes at 1440/390 px: connection begins before advertisement; waiting; connected but readiness unknown; transfer progress; authenticated identity; GPU preparation; ready; executing; stopping; interrupted; replacement connection refusing the old advertisement; explicit failure. Open details and draft remain intact. Four presentation cases plus the Verification Worker passed. These use injected authoritative state, not real transport or GPU work. [Browser log](browser-complete.log.gz).

```sh
npx vitest run --config tests/vitest.config.js \
  tests/unit/swarm-signaling-independence.test.js \
  tests/unit/work-swarm-lifecycle.test.js \
  tests/unit/preparation-progress.test.js tests/unit/network-controls.test.js
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test \
  --config tests/playwright.config.js tests/e2e/chat-rail-layout.spec.js \
  --project chromium --grep 'connection journey|connection runtime'
```

## Real prepared-provider journey

A fresh Chrome 155.0.8059.80 requester on **https://replo.id** selected **Qwen3.5 2B**, artifact `sha256:83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028`, and used the existing native whole-model provider. The 47.2-second test passed arithmetic answer 42, contextual follow-up 40, streamed counting cancellation, reuse yielding 42, and reload with identical conversation messages and attempt statuses. Recorded attempts bind recipient/model permission and `peer-whole-request` placement. No requester shard/tokenizer downloads or page errors were observed. [Exact receipt](whole-model-chat.json).

This is a deployed-service observation at the receipt timestamp, not deployment of the new local source, a provider replacement test, or broad answer-quality qualification. No provider was started or restarted. Reproduction requires that exact prepared provider to remain available:

```sh
REPLOID_E2E_BASE_URL=https://replo.id REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome REPLOID_NATIVE_CHAT_URL=https://replo.id \
REPLOID_NATIVE_CHAT_MODEL=qwen-3-5-2b-q4k-ehaf16 \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-native-whole-model.spec.js --project chromium
```

## CI follow-up

The later clean hosted run at `a11f27dc` passed all Smoke steps, including the
previously skipped Chromium installation, installed-package and browser checks.
See the [retained repair receipt](../ci-repair-20261017/README.md). Historical
failures below remain failures; the suite's individual skips remain unqualified.

## Earlier CI failures


Update after the complete isolated service campaign: hosted runs [39046487269](https://github.com/clocksmith/reploid/actions/runs/39046487269) (`721cd862`) and [39047399689](https://github.com/clocksmith/reploid/actions/runs/39047399689) (`18af09cd`) passed lint but **failed unit/integration tests**. Chromium installation, installed-package smoke and browser-boot smoke were again **skipped**. [First job steps](ci-39046487269.json), [latest job steps](ci-39047399689.json), [retained failure log](ci-39046487269.log.gz). These remain open; the [passing local whole-model lifecycle](../model-service-20261017/README.md) does not substitute for them.

Hosted runs [39038880441](https://github.com/clocksmith/reploid/actions/runs/39038880441) and [39043016731](https://github.com/clocksmith/reploid/actions/runs/39043016731) failed lint and skipped unit/integration tests, Chromium installation, installed-package smoke and browser-boot smoke. Earlier failed runs remain failed; focused passes do not close them. [Latest retained job steps](ci-39043016731.json), [failed lint log](ci-39043016731.log).

The six undefined-global lint errors are corrected with explicit `globalThis` references in serialized browser callbacks. This preserves their browser execution and top-frame/origin guard. No lint rule was disabled. Lint over all tracked JavaScript/MJS files passed ([log](tracked-lint.log.gz)); the unrestricted local `npm run lint` scan was stopped because it also traversed temporary historical snapshots. The hosted clean-checkout lint run remains separate.

The skipped checks were actually executed locally on the shared working tree:

| Check | Result | Evidence |
|---|---|---|
| `npm test` | **Failed**: 19 files failed, 409 passed, 5 skipped; 46 tests failed, 4519 passed, 36 skipped; 6 errors | [Full log](npm-test.log.gz) |
| `node tests/library-package-acceptance.js` | **Failed** source/application asset hash equality for `chat/workspace.js`; remaining 16 checks passed | [Report](installed-package-report.json), [log](package.log.gz) |
| `REPLOID_E2E_CHROMIUM_CHANNEL=chrome npm run test:e2e:smoke` | **Passed**, 3 browser boot checks | [Log](boot.log.gz) |

The source tree was concurrently being edited; these local failures are retained observations, not attribution to this patch. Examples include missing absolute Doppler imports, incomplete transport fixtures, charter drift, permission assertions, and package mirror mismatch. They are not relabeled as success or silently excluded. Local Chrome was already installed; the hosted Chromium-install step has not been proved by this local run.

Next closure requires a coherent source/vendor snapshot, correction of the named failed assertions, and an actual hosted run reaching all skipped steps. Retry the exact workflow commands above after those changes; do not infer acceptance from a new push or an isolated lint pass.

Component: verification evidence and browser bridge callback references. Intent: preserved. Acceptance: focused reconnect/state tests, complete scripted state journey, real prepared-provider conversation, and explicit failing broader receipts. Boundary effects: none; Reploid remains coordination owner and Doppler remains model execution owner.
