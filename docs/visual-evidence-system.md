# Visual Evidence System

Reploid owns the first shared evidence visual system for the browser inference pool. The goal is to keep public proof diagrams, README claim charts, and release evidence charts visually consistent across Reploid, Doppler, Doe, and later product surfaces.

## Theme

Use a neutral terminal-style evidence theme:

```js
{
  bg: '#050607',
  panel: '#0b0d0f',
  panelAlt: '#101317',
  border: '#2a2f35',
  text: '#f2f2f0',
  muted: '#9ca3af',
  good: '#86efac',
  warn: '#fde68a',
  bad: '#fca5a5',
  accent: '#93c5fd'
}
```

Rules:

- Dark canvas, thin bordered panels, no decorative gradients.
- Title text uses bold sans.
- Body text uses compact sans.
- Hashes, paths, metrics, and receipt fields use monospace.
- Accent colors carry evidence meaning: good, warning, failure, neutral accent.
- Receipt and trust-tier badges are the primary visual emphasis.

## Grammar

Use one diagram grammar:

- Boxes are system actors.
- Thin solid lines are assignment or data flow.
- Thin dashed lines are verification or audit flow.
- Badges show trust tier, identity, or evidence status.
- Metric strips summarize claims.
- Receipt cards list fields that make a claim auditable.

Supported diagram types:

1. Architecture flow.
2. Claim/evidence card.
3. Benchmark comparison.
4. Receipt lifecycle.

Everything else should stay as prose or tables.

## Shared Modules

The shared implementation starts in `scripts/visuals/`:

- `evidence-theme.js`: palette, typography, trust-tier colors.
- `svg-primitives.js`: escaping, SVG wrapper, panels, nodes, badges, connectors.
- `render-claim-card.js`: claim and evidence cards.
- `render-metric-strip.js`: compact metric and trust-tier strips.
- `render-flow-diagram.js`: structured flow diagrams.

Product-specific generators should import these modules and keep their own data separate from presentation logic.

## Repository Mapping

Reploid owns product diagrams:

- pool architecture;
- requester, provider, and agent journeys;
- receipt lifecycle;
- points economy loop.

Doppler owns engine diagrams:

- model loading;
- inference session;
- receipt/proof fields;
- public export boundaries.

Doe owns high-trust evidence diagrams:

- claim gates;
- runtime identity;
- parity and proof lanes.

D4DA remains a reference for receipt, reputation, economy, and settlement-style ledger views.

## First Launch Diagram

The first generated pool launch diagram is:

```text
docs/visuals/receipt-backed-browser-inference-loop.svg
```

Regenerate it with:

```bash
node scripts/generate-pool-evidence-visuals.js
```

The diagram is intentionally narrow: requester, coordinator, provider browser, Doppler runtime, signed receipt, verifier, requester acceptance, and the T1/T2/T3 trust roadmap.

