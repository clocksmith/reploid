# Reploid UI review

Agy subsession: `59dc89c6-e985-4168-b713-b5a9ad2e16b2`. CLI init confirms `gemini-3.8-flash-high`; invocation requests `--effort high`. Review completed with source supplied by the parent reviewer and actual Chromium DOM snapshots. Agy did not operate a live browser. Its initial headless shell and repository-read requests were denied; no broad permission bypass was used. Source and generated manifests were not changed.

## Changes supported by inspected UI

1. **Expose document setup when needed.** `self/ui/pool-home/document-search.js` hides required model selection in a closed disclosure while Search is disabled. Show setup until configured, then collapse it. Use “Models”, “Model settings (.json)”, “Use models”, and “Models selected”. Add a short visible next step. Configuration acceptance does not mean model weights are loaded.
2. **Share task surfaces and buttons.** The document form lacks the raised card used by the protein form; Share compute uses a legacy split-icon outline button. Reuse a neutral task-card and primary-action component across Run, Search, and Start sharing, keeping behavioral bindings unchanged.
3. **Remove technical copy from ordinary choices.** `view.js` renders `sequence.embedding.v1` in the model dropdown, visibly truncated at 390 pixels. Use its short model label. Keep exact model/operation identity inspectable in details. Replace “Rerank passages” with “Improve result order”, and “Protein embeddings” with “Protein sequences”.
4. **Share the exclusive selector.** The workload switcher uses unrelated ghost-button geometry. Use the same inset container/raised active treatment as primary navigation. Preserve proper button semantics or implement the complete tab keyboard pattern if choosing tab semantics.
5. **Make disclosures easier to tap.** Actual visible summary targets are about 19.2 pixels high in Model setup, Model details, Sharing limits, and Advanced details. Expand the summary itself to 44 pixels, use sentence case, and retain visible focus.
6. **Keep decoration subordinate.** The current background is plain warm gray and the desktop prism is 481 by 421 pixels. Add a restrained monochrome hexagonal background outside opaque reading surfaces; reduce the prism footprint and saturation. Keep WebGPU compute for the existing spectral effect, and static fallback.
7. **Make first input easier.** A dedicated “Use example” action can insert the existing valid example without submitting or consenting to peer sharing. Existing changing placeholders look like content but leave the field empty.
8. **Shorten sharing explanation without changing permission.** Preserve public-input scope and stop behavior. Plain copy such as “Public protein sequences only” and “Results and signed job records go to the requester” is clearer than “output receipts”. Do not turn technical trust qualifiers into longer primary text.

## Checked observations and rejected Agy claims

- Desktop 1440 by 1000 and mobile 390 by 844: Home, Document search, Share compute, Recent jobs; no JS errors or horizontal overflow observed.
- Reduced motion: WebGPU drew one static frame; count remained one and suspended remained true across 1.2 seconds. Agy’s claim of a continuous reduced-motion render loop is unsupported and contradicted by this observation.
- Muted `#646c6c` contrast is 4.59:1 against page `#eeede9`, 4.89:1 against raised `#f5f4f1`, and 4.39:1 against inset `#e9e8e4`. Agy’s blanket 3.8:1 claim is incorrect. Check actual text/background combinations before changing tokens.
- 44-pixel touch targets are an accessibility design target here. Do not repeat Agy’s assertion that every target below 44 pixels automatically violates WCAG 2.1 AA.
- Route keyboard activation retained focus on the selected “Share compute” navigation link.
- No standalone public “provenance” label appeared in the inspected default views. Remove it where it actually occurs, preserving protocol record fields.

## Acceptance for a UI change

Retain before/after desktop, 390-pixel and 320-pixel screenshots. Check keyboard selection, focus indication, 44-pixel summary targets, disabled-action explanations, honest configuration/loading copy, no public Pack or raw workload schema labels, forced colors and reduced motion. Run focused UI tests, browser geometry/interaction tests and the Verification Worker sandbox after application changes.

Component: Poolday Interface. Intent: preserved. Acceptance evidence: rendered.json, accessibility.json, screenshots in this directory. Boundary effects: none; review only.

*Last updated: September 2026*
