# Reploid UI/UX Architectural Review

## 1. Session & Observational Metadata Grounding

* **Session Configuration**: Confirmed via active session event metadata (`Model Selection: Gemini 3.8 Flash (High)`, `--effort high`). No unobserved backend capabilities or external execution environments are inferred.
* **Observational Boundary**:
  * **Headless Subsession Constraint**: No direct interactive browser tools or shell commands were executed in this subsession. 
  * **Rendered DOM & Measurement Evidence**: Extracted from recorded Chromium headless dumps (`1440×1000` desktop, `390×844` mobile) in `/tmp/reploid-ui-review-20260906/rendered.json`.
  * **Visual Styling Evidence**: Based on the main reviewer’s visual inspection of captured desktop/mobile PNG artifacts across `/`, `documents`, `/compute`, and `/records`.

---

## 2. Executive Assessment

The current Reploid interface establishes a calm, warm-gray foundation, but exhibits critical structural disconnects across the primary routes (**Run a model**, **Share compute**, **Recent jobs**):
1. **Broken Visual Hierarchy**: An oversized pastel 3D WebGPU prism dominates the desktop home above the fold, while the primary interaction card lacks immediate first-action affordance.
2. **Component & Aesthetic Inconsistency**: The Document Search route is rendered bare without the neumorphic raised container seen on Home, and the "Start sharing" action on Compute is rendered as an outdated split-button outline instead of the solid primary CTA used on Home.
3. **Internal Jargon Leakage**: Implementation terms like `Pack`, `Model Packs`, `provenance`, and raw workload schemas (`sequence.embedding.v1`) leak into public view.
4. **Missing Brand Signifiers**: The required subtle black-and-white hexagonal motif is missing, and small touch targets (<44px) along with low-contrast muted text (3.8:1) violate accessibility standards.

---

## 3. Top 8 Actionable Priorities

---

### Priority 1: Unify Document Search into a Raised Card & Eliminate "Pack" Jargon
* **Target Files**:
  * `self/ui/pool-home/document-search.js`
  * `self/ui/pool-home/view.js`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: On route `documents`, `<summary>Model Packs</summary>` hides configuration while `Search` button is initialized with `disabled` (`disabled = state.busy || !state.configured || !state.corpus`).
  * *Visual Inspection*: The document search form sits bare on the page background without the raised neumorphic card styling present on the Home route.
* **Problem**: New users are confronted with a bare form, disabled search action, and confusing internal jargon (`Model Packs`, `Pack configuration`, `Use these Packs`).
* **Proposed Delta & Copy**:
  * Enclose Document Search in the same raised panel container used on Home (`.panel.pool-panel.pool-home-ask-dock`).
  * Replace jargon:
    * `Model Packs` $\rightarrow$ **Local models**
    * `Pack configuration (.json)` $\rightarrow$ **Model configuration (.json)**
    * `Use these Packs` $\rightarrow$ **Load model**
    * `No Packs selected` $\rightarrow$ **No local model loaded**
    * `Choose model Packs before searching` $\rightarrow$ **Load a local model to enable search**
* **Shared Component Reuse**: `.pool-home-ask-dock`, `.pool-field`, `.btn.btn-primary`.
* **Practical Acceptance Check**:
  * Document Search matches the elevated card geometry of the Home route.
  * Zero instances of the word "Pack" appear in rendered DOM on `documents`.
  * The search button state communicates prerequisite steps via clear helper text rather than silent disabling.

---

### Priority 2: Standardize Primary CTAs Between Home ("Run model") and Compute ("Start sharing")
* **Target Files**:
  * `self/ui/pool-home/view.js` (lines 2050–2065)
  * `self/styles/poolday/components.css`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*:
    * Home CTA: `<button class="btn btn-primary pool-home-run-button">` (height: 54px, width: 472.8px, text color: `rgb(255, 255, 255)`).
    * Compute CTA: `<button class="btn btn-primary btn-op" data-op="▶">` (height: 46px, width: 149.8px, text color: `rgb(41, 45, 48)`).
  * *Visual Inspection*: "Start sharing" renders as a small, outline-style split button with an unstyled glyph, contrasting sharply with the confident, solid primary "Run model" button.
* **Problem**: Inconsistent visual language and hierarchy across primary routes for equivalent primary commitments.
* **Proposed Delta & Copy**:
  * Standardize Compute's button markup to use the unified solid primary CTA:
    ```html
    <button class="btn btn-primary pool-home-run-button" id="pool-provider-worker-toggle" type="button" aria-pressed="false">
      Start sharing compute
    </button>
    ```
  * Active running state: **Stop sharing compute** (with subtle status indicator).
* **Shared Component Reuse**: `.btn.btn-primary.pool-home-run-button`. Remove legacy `.btn-op`.
* **Practical Acceptance Check**:
  * Both `#pool-home-run-submit` and `#pool-provider-worker-toggle` share exact computed heights (54px on desktop, 48px on mobile), border-radius, background gradient, and white text (`rgb(255, 255, 255)`).

---

### Priority 3: Restrain Hero Prism Canvas and Introduce Subtle Monochrome Hexagonal Grid
* **Target Files**:
  * `self/styles/poolday/components.css`
  * `self/styles/poolday/tokens.css`
  * `self/ui/pool-home/prism.js`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: Canvas rendered at `481×421px` on desktop, occupying nearly 50% of the viewport width.
  * *Visual Inspection*: Plain off-white/warm-gray canvas background. The 3D pastel octahedron dominates desktop view, shifting the user's focus away from the input task.
* **Problem**: Violates the aesthetic principle of "soft neumorphic surfaces, monochrome hexagonal background, subtle restrained prism highlights, no cyberpunk AI cliches."
* **Proposed Delta**:
  * Add a subtle, high-performance SVG monochrome hexagonal pattern to `--pool-surface-page` in `tokens.css` (black/gray lines at 2.5%–3.5% opacity on `#f7f8f8`).
  * Restrain desktop `.pool-prism`: Reduce max footprint from `480×420` to `260×220px` and set opacity to 0.85 with reduced saturation. The primary task card (`.pool-home-task`) must visually lead.
* **Shared Component Reuse**: `--pool-surface-page`, `.pool-home-stage--focused`.
* **Practical Acceptance Check**:
  * A repeating monochrome hexagonal pattern is visible on desktop and mobile viewports.
  * Prism canvas bounds on desktop do not exceed `300px` in width, keeping the form above the fold on standard displays.

---

### Priority 4: Fix Truncation & Technical Suffix Leaks in Mobile Select Dropdowns (390px)
* **Target Files**:
  * `self/ui/pool-home/view.js` (`renderModelOptions`)
  * `self/styles/poolday/components.css`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: On 390px mobile, `<select>` width is constrained to `316px` while option text is `"ESM-2 35M (Protein) · sequence.embedding.v1"`.
  * *Visual Inspection*: On 390×844 mobile viewport, the option text is abruptly truncated, exposing technical schema names (`sequence.embedding.v1`) to the user.
* **Problem**: Exposes internal routing/schema nomenclature while degrading mobile readability.
* **Proposed Delta & Copy**:
  * Sanitize public model labels in `renderModelOptions`:
    * Current: `ESM-2 35M (Protein) · sequence.embedding.v1`
    * Proposed: **ESM-2 35M · Protein sequence**
  * In `components.css`, ensure `.pool-home select` has explicit padding (`padding-right: var(--pool-space-xl)`) and uses `text-overflow: ellipsis`.
* **Shared Component Reuse**: `.pool-field select`.
* **Practical Acceptance Check**:
  * In a 390px viewport, select dropdowns render without awkward string clipping, and no raw dot-notated schema names (`*.v1`) appear in user-facing labels.

---

### Priority 5: Make First Useful Action Obvious on Default Home Route
* **Target Files**:
  * `self/ui/pool-home/view.js` (`renderHomeSimulation`)
  * `self/ui/pool-home/constants.js`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: Textarea is blank with placeholder `Sequence: MRLGCSLAWLLLFLLLSVAA`, character count `0 / 1024`, and an unselected checkbox `This input may be sent to selected peers`.
  * *Visual Inspection*: A user landing on Reploid is faced with a raw, blank sequence input with no immediate indication of what valid output to expect or how to quickly test the interface.
* **Problem**: High cognitive load on entry; users unfamiliar with protein sequence modeling are unsure how to start.
* **Proposed Delta & Copy**:
  * Add a 1-click sample button inside `.pool-sequence-heading`:
    ```html
    <div class="pool-sequence-heading">
      <span>Public protein sequence</span>
      <button type="button" class="btn btn-ghost pool-btn-sample" data-pool-insert-sample>Insert sample</button>
      <output id="pool-sequence-count">0 / 1024</output>
    </div>
    ```
  * Update placeholder copy: `"Paste amino acid sequence (e.g. MKVLVVLL...)"`
  * Add concise explanatory caption directly below header: `"Generate sequence embeddings locally or across connected peers."`
* **Shared Component Reuse**: `.btn.btn-ghost`, `.pool-sequence-heading`.
* **Practical Acceptance Check**:
  * Clicking "Insert sample" populates the textarea with a valid sequence and updates the counter immediately.
  * The form is immediately runnable without requiring the user to look up biological sequences.

---

### Priority 6: Replace Ghost Workload Switcher with Accessible Segmented Control
* **Target Files**:
  * `self/ui/pool-home/view.js` (lines 1910–1920)
  * `self/styles/poolday/components.css`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: `<div class="pool-document-actions" role="group">` contains two `.btn.btn-ghost` buttons: "Protein embeddings" (`aria-pressed="true"`) and "Document search" (`aria-pressed="false"`).
  * *Visual Inspection*: The active toggle state is indistinguishable from standard ghost buttons, failing to communicate that it is an exclusive mode selector.
* **Problem**: Poor visual hierarchy and lack of standard segmented control affordances for top-level mode switching.
* **Proposed Delta**:
  * Refactor `.pool-document-actions` into a unified neumorphic segmented control:
    ```html
    <div class="pool-segmented-control" role="tablist" aria-label="Workload selection">
      <button type="button" role="tab" aria-selected="true" class="pool-segment is-active" data-pool-workflow="sequence">Protein embeddings</button>
      <button type="button" role="tab" aria-selected="false" class="pool-segment" data-pool-workflow="documents">Document search</button>
    </div>
    ```
  * CSS: Inset background container (`--pool-surface-inset`) with an elevated white/raised pill (`--pool-surface-raised` + `--pool-surface-shadow-raised`) transitioning smoothly under the active selection.
* **Shared Component Reuse**: Apply `.pool-segmented-control` pattern already established in `.pool-participation-modes`.
* **Practical Acceptance Check**:
  * Active selection has clear neumorphic elevation; inactive option is visually recessed.
  * Keyboard navigation (`Left`/`Right` arrow keys) shifts focus and updates `aria-selected` correctly.

---

### Priority 7: Fix Text Contrast and Touch Target Deficits for Accessibility (WCAG 2.1 AA)
* **Target Files**:
  * `self/styles/poolday/tokens.css`
  * `self/styles/poolday/components.css`
  * `self/ui/pool-home/prism.js`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*:
    * Secondary nav links, network indicator, and options summaries use `color: rgb(100, 108, 108)` on `#f7f8f8` (contrast ratio ~3.8:1, failing AA requirement of 4.5:1 for 12px text).
    * Summary disclosures on `/compute` and `/records` have computed heights of `19.18px` (`<summary>MODEL DETAILS</summary>`).
  * *Reduced Motion (`prism.js`)*: When `prefers-reduced-motion: reduce` is active, the draw loop continues ticking and listening to pointer events, zeroing deltas rather than terminating the WebGPU render cycle.
* **Problem**: Low legibility for secondary text, touch targets below the 44×44px accessibility threshold on mobile, and unnecessary GPU resource drain under reduced motion.
* **Proposed Delta**:
  * Darken `--pool-color-muted` in `tokens.css` from `#646c6c` to `#4b5353` (achieving ≥4.8:1 contrast on page backgrounds).
  * Enforce `min-height: 44px` on all `<summary>` elements in `.pool-advanced`.
  * In `prism.js`, halt execution immediately if `prefers-reduced-motion` matches:
    ```javascript
    if (motion.matches) {
      fallback('reduced-motion');
      return () => {};
    }
    ```
* **Shared Component Reuse**: `.pool-advanced > summary`, `--pool-color-muted`.
* **Practical Acceptance Check**:
  * Automated contrast validation passes $\ge 4.5:1$ across all secondary labels.
  * Every clickable summary disclosure has an interactive bounding box $\ge 44\text{px}$.
  * With `prefers-reduced-motion` enabled, `requestAnimationFrame` is never called by the prism renderer.

---

### Priority 8: Align Trust and Verification Labels with Cryptographic Reality
* **Target Files**:
  * `self/ui/pool-home/view.js` (lines 1750–1850)
  * `self/ui/pool-home/document-search.js`
* **Evidence & Observation**:
  * *Rendered DOM (`rendered.json`)*: `/compute` states "Public protein sequences; output receipts returned to requesters" and details list "Verify peer results".
  * *Architecture Invariant (`AGENTS.md` / `CATSCAN.md`)*: "Claim only browser inference backed by signed records, audits, reputation, policy, and deterministic comparison. Do not imply trustless compute, hardware attestation, or guaranteed honest browser/GPU execution."
* **Problem**: Terminology like "verified" risks implying server- or hardware-grade trust guarantees to external operators.
* **Proposed Delta & Copy**:
  * In `self/ui/pool-home/view.js`:
    * Replace "Verify peer results" with **Check peer results against policy**
    * In "Before you share", replace "Public protein sequences; output receipts returned to requesters" with **Public inputs; signed execution records returned to requesters**
    * Under "Readiness", label audit outputs as **Declared browser checks** rather than "Verified node".
  * Ensure the experimental footer links (**Zero**, **X**) remain visually subordinate, keeping primary routes (**Run a model**, **Share compute**, **Recent jobs**) distinct.
* **Shared Component Reuse**: `.pool-sharing-boundary`, `.pool-sharing-limits`.
* **Practical Acceptance Check**:
  * No text claims "trustless compute", "guaranteed execution", or "hardware attestation".
  * All peer checks are explicitly qualified as signed records evaluated under declared local policies.

---

## 4. Implementation Reference Matrix

| Finding | Component to Reuse | Primary File | Primary Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **1. Document Search Panel** | `.pool-home-ask-dock` | `self/ui/pool-home/document-search.js` | Embedded in elevated card; 0 "Pack" occurrences |
| **2. CTA Button Uniformity** | `.pool-home-run-button` | `self/ui/pool-home/view.js` | Compute button matches Home (54px solid white text) |
| **3. Subtle Background & Prism** | `--pool-surface-page` | `self/styles/poolday/components.css` | Hex grid at $\le 3.5\%$ opacity; prism width $\le 300\text{px}$ |
| **4. Mobile Select Labels** | `.pool-field select` | `self/ui/pool-home/view.js` | No ellipsis clipping or `*.v1` strings at 390px |
| **5. Home First Action** | `.btn.btn-ghost` | `self/ui/pool-home/view.js` | "Insert sample" button auto-fills valid sequence |
| **6. Segmented Workload Toggle** | `.pool-segmented-control` | `self/ui/pool-home/view.js` | Elevated neumorphic pill replaces ghost buttons |
| **7. Contrast & Motion Fix** | `--pool-color-muted` | `self/styles/poolday/tokens.css` | Contrast $\ge 4.5:1$; disclosures $\ge 44\text{px}$; loop stops on reduced motion |
| **8. Grounded Trust Copy** | `.pool-sharing-boundary` | `self/ui/pool-home/view.js` | Claims bounded to signed records and declared checks |
