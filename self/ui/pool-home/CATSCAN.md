# CATSCAN: Reploid Product Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target
Present conversations/agents/models/results/evaluated changes.

## Authority
Owns product/Room-1 presentation; requests candidate transfer/evaluation/adoption/rollback.
Owns no execution/review, validation/admission, transport or scientific interpretation.

## Scope
This tree.

## Contracts
Inputs: [conversation/execution state](../../../packages/reploid/src/chat/CATSCAN.md),
[host composition](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md),
deterministic [room state](room-projection.js).
Outputs: [conversations](conversation-workspace.js), [markup](view.js), [Room-1](room-view.js).

## Invariants

- Monochrome, shallow depth; prismatic accents. Animate observed events, never idle readiness; discovery implies no execution. Respect reduced motion; concise controls; no banners/slogans/preset-prompt grids.
- Preserve Reploid/Poolday identities, shared components/tokens, gutters,
  accessible themes/responsive scrolling. Activities prescribe no hierarchy.
- Link tasks/helpers/jobs/results/candidates; show observations and missing admission/evaluators.
- Preserve execution in protein/document examples and request/execution/comparison/acceptance/receipt lifecycles. Recovery requires valid state.
- Disclose execution location. Separate routing from default-on Allow network
  answers; explain conversation disclosure to contributors. Persist opt-outs;
  ask before sending. Search always asks per request; local never asks.
  Viewing/restoring/selection grants nothing.
- Keep failures and Stop visible; selection never stops background threads.
- Connection/cached sharing default on; downloads require opt-in.
- Include compatible adapters in model selection. Compute/file controls;
  discovery/thread grants imply neither.
- Inspect Pack/runtime/provider/hardware/fallback/timing/output/agreement. Review grants no evaluation/promotion; receipts prove no hardware attestation; acceptance names policy.
- Research administration stays in Room-1; generic Packs exclude research fields.
- Archive/decision memory remain distinct; Zero/X grant no mutation authority.

## Acceptance

- Measure benefit/cost against local/centralized baselines. Fixtures prove no inference.
- Desktop/mobile, light/dark: empty/active/interrupted/completed screenshots.
- Evidence: [conversations](../../../tests/e2e/chat-material.spec.js), [CSS](../../../scripts/verify-poolday-css-layers.js), [visuals](../../../tests/e2e/workspace-material.spec.js), [navigation](../../../tests/unit/pool-home-nav.test.js), [requests](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), [peers](../../../tests/e2e/p2p-mesh.spec.js), [search](../../../tests/unit/search-answer-permission.test.js).

## Non-goals
Primary scientific administration, reputation, protocol internals.

## Freedom
Preserve contracts.
