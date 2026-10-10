# CATSCAN: Reploid Product Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target
Present connected conversations, agents, models, results and evaluated changes.

## Authority
Owns product/Room-1 presentation; requests candidate transfer/evaluation/adoption/rollback.
Owns no execution/review, validation/admission, transport or scientific interpretation.

## Scope
This tree.

## Contracts
Inputs: [conversation/execution state](../../../packages/reploid/src/chat/CATSCAN.md),
[host composition](../../host/CATSCAN.md), [runtime](../../pool/CATSCAN.md),
and scoped deterministic [room state](room-projection.js).
Outputs: [conversations](conversation-workspace.js), [markup](view.js), [Room-1](room-view.js).

## Invariants

- Monochrome, shallow depth; prismatic navigation/model/focus accents. Animate observed events only; idle readiness stays still; discovery never implies execution. Respect reduced motion; concise controls; no banners/slogans/preset-prompt grids.
- Preserve Reploid/Poolday identities, shared components/tokens, aligned gutters,
  accessible themes/responsive scrolling. Activities prescribe no hierarchy.
- Link tasks/helpers/jobs/results/candidates; show observations and missing admission/evaluators.
- Preserve execution in protein/document examples and request/execution/comparison/acceptance/receipt lifecycles. Recovery requires valid state.
- Disclose execution location; approve exact public payloads or explicitly grant
  future disclosure to the verified recipient for that thread/model. Show and
  revoke grants. Membership grants no disclosure.
- Keep failures/approvals/stop visible; selection never stops background threads.
- Include compatible adapters in model selection. Separate compute/bounded file consent;
  discovery/thread grants imply neither.
- Inspect Pack/runtime/provider/hardware/fallback/timing/output/agreement. Review grants no evaluation/promotion; receipts prove no hardware attestation; acceptance names policy.
- Research administration stays in Room-1; generic Packs inherit no research fields.
- Archive/decision memory remain distinct; Zero/X grant no mutation authority.

## Acceptance

- Measure benefit/cost against local/centralized baselines. Injected providers prove no inference.
- Desktop/mobile, both themes: empty/active/approval/completed screenshots.
- Evidence: [conversations](../../../tests/e2e/chat-material.spec.js), [CSS](../../../scripts/verify-poolday-css-layers.js), [visuals](../../../tests/e2e/workspace-material.spec.js), [navigation](../../../tests/unit/pool-home-nav.test.js), [requests](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), [peers](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
Primary scientific administration, reputation, protocol internals.

## Freedom
Preserve contracts.
