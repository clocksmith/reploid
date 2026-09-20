# Monochrome workspace repair

Open [comparison.html](comparison.html) for side-by-side screenshots: desktop
(1440px), mobile (390px), light/dark, empty/active/approval/completed.
Before captures use commit `9529cb37`; after captures use this repair.
The completed fixture now marks helpers/events complete; the earlier fixture
retained running helper labels. These injected host states establish presentation
and consent visibility, not actual inference or independent providers.

## Acceptance

- 21 Chromium checks passed across `workspace-material`, `work-clarity`,
  `agent-network-home`, and `work-integration`: aligned surfaces/control sizing,
  grayscale colors, depth, 320px overflow, exact-payload approval, stop controls,
  Verification Worker, WebRTC exchange, evaluation/adoption/reload/rollback.
- 18 unit checks passed across `design-system-css`, `poolday-css-layers`,
  `agent-network`, and `work-contracts`.
- `npm run verify:layers`, `npm run verify:pool:css`, `npm run verify:pool`,
  and `git diff --check` passed.
- `npm run lint -- --ignore-pattern '.deployment-checkouts/**'` passed;
  unfiltered lint includes pre-existing archived deployment copies.
- Registry audit: zero unresolved issues, generated JSON parses, second generation
  pass is idempotent. Browser bundle: 799 files,
  `sha256:4328b6301539cfec5eb59ec8cecb7360aafcbceeb939c66a49fc247d0923d4d4`.
- UI charter is within the 250-word limit. Repository charter validation still
  reports the pre-existing 267-word `self/pool/CATSCAN.md`.
- The full Vitest rerun passed 2662 tests, with 36 skipped and one failure:
  the runtime charter limit above. All 22 navigation assertions pass.
- Live smoke exposed inherited drawer width/padding transitions on the primary
  header during viewport changes. Restricted that transition to the drawer;
  the new resize regression fails before the repair and passes afterward.

Reproduce browser checks without replacing historical evidence:

```sh
REPLOID_E2E_ARTIFACT_DIR=artifacts/monochrome-workspace-2026-09-20 \
  npx playwright test tests/e2e/workspace-material.spec.js \
  tests/e2e/work-clarity.spec.js tests/e2e/agent-network-home.spec.js \
  tests/e2e/work-integration.spec.js --project=chromium --timeout=60000
```

Component: Pool-home UI and shared Poolday styles.
Intent: preserved; monochrome material invariant made explicit.
Boundary effects: presentation only; no networking, inference or mutation authority changes.
The duplicate `network.css` theme was removed and consolidated into shared layers;
its previous version remains recoverable from Git.
