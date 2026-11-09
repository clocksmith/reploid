# Reploid chat controls — November 9, 2026

Component: Poolday conversation UI and host; shared chat workspace API.
Intent: deliberately changed automatic empty-thread selection and control presentation.
Boundary effects: additive `keepAutomatic` workspace option, browser library mirror and hosting bundle. Exact identities, used threads and permission boundaries remain pinned.

Fresh automatic choices prefer ready shared models. Unused automatic threads follow capacity; confirming the picker or sending pins the choice. Legacy unmarked choices are not guessed to be automatic. Model selection changes; the Automatic execution-location policy can still reuse the selected model locally.

Exact model variants appear in readiness order, with provider, route and format information under Model details. Hover/focus help shares one tooltip; Help and measurement taps work without hover. One animated status and Stop belong to the answer. Offscreen answers retain Stop in the composer. Reduced motion disables pulsing. Delayed dialog close events no longer steal a later focus change.

Acceptance: 125 unit tests across six files; 12 Chrome checks with controlled host-state fixtures at desktop/phone widths, light/dark themes, keyboard, touch emulation and reduced motion. Library types, lint, CSS layers, ownership, import boundaries and bundle identity passed. See receipt.json and screenshots. No physical-phone or model-inference qualification.

Reproduce:

```sh
npx vitest run --config tests/vitest.config.js tests/unit/chat-session.test.js tests/unit/chat-workspace.test.js tests/unit/conversation-workspace.test.js tests/unit/model-select.test.js tests/unit/message-list.test.js tests/unit/execution-activity.test.js
REPLOID_E2E_BASE_URL=http://localhost:8017 REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test tests/e2e/chat-material.spec.js --config=tests/playwright.config.js --project=chromium --timeout=45000 -g 'focused chat controls|touch help|activity settles|bounded inspector and reduced viewport|conversation materials'
```

Deployment: hosting-only from isolated pushed revision `8138cf464`, containing implementation `a5380be92`. Live verification matched the manifest and five served assets byte-for-byte, then exercised the real page on desktop and touch emulation with no page errors. See [live.json](live.json), the live screenshots and `live-smoke.mjs` (run from repository root). No ready shared model appeared during these brief live checks; readiness transitions are covered by the controlled host tests, not claimed as a live inference result.
