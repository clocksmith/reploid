# Chat rails and readable permissions — 2026-10-12

Component: Reploid conversation presentation. Intent: deliberately changed to independently collapsible thread and settings rails, a single transcript scroller and contextual execution activity. Boundary effects: presentation only; session, permission, contribution and Doppler contracts unchanged.

## Changes

- Left 7s toggle threads; right 7s toggle the shared settings/network inspector. Both can remain open on desktop without covering the composer. Phone rails overlay within the viewport.
- Icons replace repeated labels for attachment, Send/Stop, Copy, conversation actions and inspector sections. Accessible names and native keyboard activation remain.
- Transcript and approval use one vertical scroller. Attachment review renders escaped questions and source passages in collapsed disclosures. Exact protocol payload remains in Technical details; approval binding is unchanged.
- Each answer owns expandable execution activity. Assigned participants come from that attempt, not discovery. The single bar is explicitly **recorded step-time share**, not model allocation or completion percentage. Rates count the runner's selected-token steps over recorded per-executor durations, including overhead. No output-text estimate or invented animation.
- Current public transport reports aggregate timing at completion. The presentation updates whenever an observation arrives; this change does not claim live per-token timing delivery. Before timings arrive it shows assigned layers and Timing pending.

## Verification

73 focused unit tests pass: permissions, conversation workspace, message list, network controls, execution projections, navigation and shared CSS. Seventeen Chromium cases pass across light/dark, 320/390/1440px, independent rails, readable expanded attachment approvals, streaming/stop states, code/citations, saved drafts and simulated keyboard viewports. [Browser summary](browser-results.json).

Actual [Verification Worker](verification-worker.json) passes all ten changed UI modules with no errors and 19 static warnings. Warnings concern existing relative imports, escaped HTML rendering and complexity, not executed inference. CSS layering and generated browser-manifest checks pass.

Commands:

```sh
npx vitest run --config tests/vitest.config.js tests/unit/conversation-permission.test.js tests/unit/conversation-workspace.test.js tests/unit/network-controls.test.js tests/unit/execution-activity.test.js tests/unit/execution-ribbon.test.js tests/unit/pool-home-nav.test.js tests/unit/message-list.test.js tests/unit/design-system-css.test.js tests/unit/poolday-css-layers.test.js
REPLOID_E2E_SKIP_LOCAL_SERVER=1 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/playwright.config.js --project=chromium tests/e2e/chat-material.spec.js tests/e2e/chat-rails.spec.js
node scripts/verify-poolday-css-layers.js
node scripts/build-browser-bundle-manifest.js --check
```

Initial checks caught desktop inspector overlap and a phone rail intercepting the settings controls; both were corrected and regression assertions retained. Existing header-status tests now inspect the per-answer status through the transcript because status intentionally moved with its answer.

[Desktop rails](desktop-rails.png) · [Phone activity with synthetic timing](phone-activity.png) · [Phone attachment review](phone-approval.png)

These are browser interaction fixtures, not distributed inference, physical phone keyboard or unfamiliar-user evidence. At the initial UI checkpoint, no deployment had occurred. Doppler's accepted 0.6.27 pin is unchanged; this does not close numerical, useful-answer or signed physical release acceptance.

## Public deployment

Deployed source `1ae67af2` to https://replo.id on 2026-10-12 using Firebase Hosting only. [Deployment receipt](deployment.json). Backend services and the Doppler 0.6.27 pin remain unchanged.

[Served-byte verification](deployed-bundle.log) matched all 1,909 assets and the descriptor to `sha256:6f7a4f88f15f62bae7d1a68b89d3fe450267de4732c0c5d016250ef1ed9c34c1`. Four Chromium cases against the public origin passed in 45.7 seconds: light/dark at 1440/390px, independent rails, composer placement, readable attachment approval and no nested vertical approval scrolling. The tests exercise actual application rails, then mount scoped presentation fixtures for approval states. Desktop and phone screenshots were visually inspected. This does not establish physical-phone, returning-installation migration or distributed inference acceptance.
