# One composer model picker — 2026-11-09

The empty conversation rendered a shared-model card above the composer as well
as the composer picker. Removed the card, its independent selection handlers
and its CSS. The composer now owns the single entry to model selection. Shared
models, local/download choices, route/source details and contribution controls
in Computers keep their existing behavior.

Acceptance evidence:
- 60 focused tests in `production-surface.test.js` and
  `conversation-workspace.test.js` pass: defaults, readiness, shared/local source,
  route selection, draft and attachment preservation, no unintended generation or
  downloads, and contribution separation.
- 11 Chromium/SwiftShader browser checks pass in `chat-material.spec.js` and
  `production-journey.spec.js`, selected with
  `one composer chooser|discovered models stay|model source, selection|production opens chat`.
  Widths include 320, 390, 1280 and 1440. Presentation fixtures are not inference proof.
- Targeted ESLint, CSS ownership and browser bundle freshness checks pass.
- Rebuilt product bundle and served-file manifest.

Component: Poolday conversation interface.
Intent: preserved; model selection remains a bounded choice in the composer.
Boundary effects: browser presentation only. Provider processes and model runtime unchanged.
