# CATSCAN: Reploid Product Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target
Present connected objectives, agents, models, work, results and evaluated changes.

## Authority
Owns product/Room-1 presentation. Hosts own execution/review. Requests candidate
transfer, evaluation, adoption/rollback; never judges. Excludes Pack/receipt
validation, admission, transport and scientific interpretation.

## Scope
This tree.

## Contracts
Inputs: [runtime](../../pool/CATSCAN.md), deterministic [room state](room-projection.js).
Outputs: [markup](view.js), [Room-1](room-view.js).

## Invariants

- Preserve monochrome neumorphism. No promotional banners, stacked slogans, or preset-prompt grids on the main workspace. Communicate through live state and concise controls.
- Preserve Reploid/Poolday identities, shared components/tokens, aligned gutters,
  accessible themes and responsive scrolling. Activities prescribe no navigation hierarchy.
- Link tasks/helpers/jobs/results/candidates; show observed states and missing admission/evaluators.
- Preserve execution in protein/document examples and request/execution/comparison/acceptance/receipt lifecycles. Recovery requires valid state.
- Disclose execution location; approve exact outgoing public payloads. Room membership grants no disclosure.
- Keep thread failures, approvals and stop visible; selection never stops background threads.
- Inspect Pack/runtime/provider/hardware/fallback/timing/output/agreement. Review grants no evaluation/promotion; receipts prove no hardware attestation; acceptance names policy.
- Research administration stays in Room-1; generic Packs inherit no research fields.
- Archive/decision memory remain distinct; Zero/X grant no mutation authority.

## Acceptance

- Compare measured benefit/cost against local/centralized baselines. Injected providers prove no inference.
- Desktop/mobile, both themes: compare empty, active, approval and completed screenshots.
- Evidence: [visual states](../../../tests/e2e/workspace-material.spec.js).
- Evidence: [navigation](../../../tests/unit/pool-home-nav.test.js), [requests](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), [peers](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
Primary scientific administration, reputation, protocol internals.

## Freedom
Preserve these contracts.
