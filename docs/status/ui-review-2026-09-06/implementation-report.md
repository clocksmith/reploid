# Reploid UI implementation

Agy used `gemini-3.8-flash-high` with `--effort high` in subsession `59dc89c6-e985-4168-b713-b5a9ad2e16b2`. The CLI init confirms the exact model. Agy reviewed supplied source and genuine Chromium DOM/measurements; the coordinating reviewer inspected the screenshots. Its unsupported blanket contrast and continuous reduced-motion claims were rejected, as recorded in `vetted-review.md`.

## Implemented

- Required document Models setup is visible on first use, then collapses after configuration. “Models selected” does not imply downloaded or loaded weights. Disabled search has a visible next step and model setup links to the existing guide.
- Run, document search, and sharing reuse the raised task card, primary action, and recessed segmented controls. Public model choices omit raw operation schema suffixes. Ordinary labels use Models and job details rather than Pack terminology.
- Disclosure targets are at least 44 pixels with a visible open/closed indicator and keyboard focus. Reading surfaces remain opaque over a restrained monochrome hexagonal background. The smaller WebGPU prism retains its spectral computation with reduced color intensity and existing fallback/suspension behavior.
- “Use example” inserts the existing valid protein example and updates the counter without submitting or enabling sharing. Removed the old focus handler that erased restored or selected text matching an example.
- Kept signed-record/public-input explanations and exact identifiers inspectable. Existing private document isolation, route identity and runtime authority are preserved.

## Acceptance

68 focused Vitest checks pass. Ten Chromium UI/document checks pass, including the real Verification Worker, WebGPU lifecycle, reduced motion, static fallback, document workflow with injected model outputs, and keyboard/320/390/1440-pixel checks. Nine public-route Chromium boot checks pass. Final output is retained in `ui-unit-tests.txt`, `ui-browser-tests.txt`, and `ui-boot-tests.txt`; `ui-acceptance.json` pins changed file hashes.

Older boot assertions were updated from the former Poolday title, full-width navigation and viewport-centered task to the approved Reploid title, inset centered navigation and task-column alignment. They still assert unobstructed controls, complete navigation, route recovery, private/default disclosure and zero narrow-screen clipping. A real 4-pixel decorative overflow was repaired instead of suppressing that assertion.

## Rendered evidence

Before: `desktop-home.png`, `desktop-documents.png`, `mobile-home.png`, `mobile-documents.png`, `mobile-compute.png`.

After: `after-desktop-home.png`, `after-desktop-documents.png`, `after-mobile-home.png`, `after-mobile-documents.png`, `after-mobile-compute.png`. The `after-*-example.png` pair and `example-and-motion.json` preserve explicit example insertion without consent or submission.

Component: Poolday Interface. Intent: preserved. Acceptance evidence: commands/artifacts above. Boundary effects: none; runtime, transport, persistence policy and model math ownership unchanged. No commit, push, deployment, registry generation or public-release claim was made by this subsession.

*Last updated: September 2026*
