# CATSCAN: Research Room Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Let curators resolve a public-protein dispute and choose the next action in-room.

## Authority
- Owns room projection, inspection, review, correction, replication, and next-action controls.
- Does not own evidence production, admission policy, network transport, or biological interpretation.

## Scope

- This directory and unchartered descendants.

## Contracts

Inputs:
- Governed records from the [Poolday evidence runtime](../../pool/CATSCAN.md).
- Deterministic room state from [room-projection.js](room-projection.js).

Outputs:
- The primary room view through [room-view.js](room-view.js).
- Technical disclosure through [research-technical-panel.js](research-technical-panel.js).
- First-market proof status through room projection and lifecycle controls.

## Invariants
- Research outcome and unresolved questions lead the interface.
- Archive status and decision-memory admissibility remain distinct.
- Prior-room context differences and required reviewer authority remain visible.
- Duplicate origins remain inspectable while one declared source contributes at most once to memory.
- Checkpoints freeze evidence state without implying closure or truth.
- Primary next action exposes admitted and rejected candidates, raw value and cost, calibration, exact contract, deterministic selection, and approval.
- Candidate controls imply no allocation or execution authority.
- Contributor, receipt, transport, and reputation details remain supporting disclosures.

## Acceptance
- Users can inspect, review, replicate, checkpoint, propose, and independently approve exact contracts.
- Evidence: [browser journey](../../../tests/e2e/pool-evidence-journey.spec.js), [room tests](../../../tests/unit/pool-room-projection.test.js), [candidate tests](../../../tests/unit/pool-discovery-candidate-action.test.js), [replay tests](../../../tests/unit/pool-discovery-contract.test.js), and [adjudication tests](../../../tests/unit/pool-adjudication-experiment.test.js).

## Non-goals
- Exposing Zero, X, network simulation, or generic peer inference as the primary workflow.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
