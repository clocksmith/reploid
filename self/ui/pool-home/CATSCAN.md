# CATSCAN: Reploid Product Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target
Pursue bounded goals, share compute, inspect improvement evidence.

## Authority
- Owns Work, Network, Improve, examples, and Room-1 presentation.
- Host composes reusable agent; owns execution and review.
- Excludes Pack validation, admission, transport, receipt validation, scientific interpretation.

## Scope
This tree.

## Contracts
Inputs: [runtime](../../pool/CATSCAN.md), deterministic [room state](room-projection.js).
Outputs: [markup](view.js), [Room-1](room-view.js).

## Invariants
- Brand Reploid; preserve internal Poolday identities.
- Primary navigation: Work, Network, Improve, compact network indicator.
- Protein/document examples preserve execution.
- Connected rooms never authorize private-goal sharing.
- User review is neither independent evaluation nor promotion.
- Missing admission/evaluators remain visible.
- Preserve request, execution, comparison, acceptance, receipt lifecycle.
- Interrupted jobs expose valid recovery only.
- Inspect available Pack, runtime, provider, declared hardware, fallback, timing, output, agreement.
- Records Advanced contains only execution evidence, peer identities, retries, recovery.
- Research administration stays in Room-1; generic Packs inherit no research fields.
- Task data stays local; preview and explicitly approve each exact public payload.
- Acceptance names policy; receipts are not hardware attestation.
- Archive and decision memory remain distinct.
- Zero/X remain reachable without inheriting mutation authority.

## Acceptance
- Goals, criteria, input files, result downloads, revisions, sharing, jobs, evidence remain usable.
- Local/peer real-inference acceptance stays separate; injected providers prove neither.
- Evidence: [navigation](../../../tests/unit/pool-home-nav.test.js), [requests](../../../tests/unit/pool-home-ask-controls.test.js), [records](../../../tests/unit/pool-home-record.test.js), [peers](../../../tests/e2e/p2p-mesh.spec.js).

## Non-goals
Primary scientific administration, reputation, protocol internals.

## Freedom
Preserve these contracts.
