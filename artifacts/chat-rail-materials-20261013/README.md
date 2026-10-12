# Stationary rail controls and shared panel materials

Component: existing conversation and inspector presentation. Intent preserved; no navigation, execution, permission or runtime changes.

Both 7 glyph pairs retain their resting positions through hover, press, open and keyboard focus. Rest is quiet; hover uses the existing raised recipe; active/open uses the existing inset recipe; keyboard focus has an outline. Reduced motion disables transitions. The thread sidebar now composes `pool-surface`, uses padding on all sides and has a desktop column gutter for its shadow. The inspector keeps matching panel radius/padding and a visible phone edge gutter. Global tokens and material recipes are unchanged.

Validation:

- `npx vitest run --config tests/vitest.config.js tests/unit/conversation-workspace.test.js tests/unit/pool-home-nav.test.js tests/unit/poolday-css-layers.test.js --maxWorkers=2`: 45 pass.
- `REPLOID_E2E_BASE_URL=http://localhost:8426 npx playwright test --config tests/playwright.config.js tests/e2e/chat-rails.spec.js --project=chromium-swiftshader --reporter=list`: six existing direct-chat/composer cases pass. Four final rail cases pass at 1440px/320px in light/dark, including rest, hover, press, open, focus, exact stationary glyph rectangles, shared material values, padding, independent closing, reduced motion and overflow. The final rail-only repeat uses `--grep stationary` and `--output=artifacts/chat-rail-materials-20261013/final-controls`.
- `npm run verify:pool:css`, `npm run verify:browser-bundle:local`, `git diff --check`: pass.
- `node artifacts/chat-rail-materials-20261013/verify-worker.mjs`: actual Verification Worker parses the changed served JS; zero errors, three warnings, retained exact hash.

Visual inspection: final light phone and dark desktop open-panel screenshots show raised containers, retained edge padding and stationary toggles. Phone panels overlay the conversation, as before; their top toggles stay separately accessible. Hover and keyboard screenshots are retained alongside open-panel states under `final-controls/`.

Failures retained: the initial test wrongly treated any inset highlight in the shared raised recipe as pressed state; it now compares the actual complete recipe. The next run exposed a real older `sup` hover selector still moving the small seven; the scoped selector now overrides it. Phone geometry then exposed inherited `left:0` overriding the inspector's right gutter; explicitly restoring `left:auto` fixes it. Geometry checks wait for the actual panel animation to finish rather than sampling a moving frame. Earlier error contexts remain under `browser/`, `final-browser/`, `verified-browser/` and `accepted-browser/`; those names do not imply passing results.

UI-only deployment of pushed `07907105` completed at https://replo.id. [Deployment receipt](deployment/receipt.json) binds all 1,914 verified served files to `55978b55…`; the accepted Doppler pin is unchanged. [Public browser checks](deployment/live.json) pass fresh controls, saved history/draft restoration and persisted context after reload without inference. The returning fixture was seeded after publication, so this proves saved-state/reload compatibility, not a physical upgrade observation of real user data. These controls do not establish model quality or distributed inference acceptance. Unrelated topology documents remain outside this change.
