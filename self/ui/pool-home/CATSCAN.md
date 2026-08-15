# CATSCAN: Research Room Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Give curators one room in which to adjudicate a bounded public-protein annotation dispute and choose a justified next action.

## Authority
- Owns the Research Room projection, evidence inspection, disagreement, review, correction, replication, and bounded next-action controls.
- Does not own evidence production, admission policy, network transport, or biological interpretation.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Governed records from the [Poolday evidence runtime](../../pool/CATSCAN.md).
- Deterministic room state from [room-projection.js](room-projection.js).

Outputs:
- The primary room view through [room-view.js](room-view.js).
- Progressive technical disclosure through [research-technical-panel.js](research-technical-panel.js).
- Explicit first-market proof status through the room projection and lifecycle controls.

## Invariants
- Research outcome and unresolved questions lead the interface.
- Complete archive status and decision-memory admissibility remain distinguishable.
- Prior-room context differences and the reviewer authority needed for reuse remain visible.
- Duplicate origin records remain inspectable while the room presents one declared source candidate and one possible memory contribution.
- Contributor, receipt, transport, and reputation details do not compete as separate products.

## Acceptance
- A user can inspect evidence and disagreement, record review, request replication, and choose the next bounded action without losing provenance.
- Evidence: [Research Room journey](../../../tests/e2e/pool-evidence-journey.spec.js), [room projection tests](../../../tests/unit/pool-room-projection.test.js), and [adjudication experiment tests](../../../tests/unit/pool-adjudication-experiment.test.js).

## Non-goals
- Exposing Zero, X, network simulation, or generic peer inference as the primary workflow.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
