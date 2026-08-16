# CATSCAN: Research Room Interface

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Let curators adjudicate a public-protein dispute and choose in-room actions.

## Authority
- Owns room projection, inspection, review, correction, replication, and next-action controls.
- Does not own evidence production, admission policy, network transport, or biological interpretation.

## Scope

- This tree.

## Contracts

Inputs:
- Governed records from the [Poolday evidence runtime](../../pool/CATSCAN.md).
- Deterministic room state from [room-projection.js](room-projection.js).

Outputs:
- The primary room view through [room-view.js](room-view.js).
- Technical disclosure through [research-technical-panel.js](research-technical-panel.js).
- First-market proof and campaign context through room projection.

## Invariants
- Outcomes and gaps lead.
- Archive and decision memory remain distinct.
- Prior-room context, campaign status, findings, and reviewer authority stay visible; failures never become independent replicas.
- Duplicate origins remain inspectable while one declared source contributes at most once to memory.
- Checkpoints, north-star policy freezes, and laboratory profiles expose declared boundaries without implying authorization, closure, truth, or hidden-outcome integrity.
- Actions and realized-value credit expose candidates, value, cost, calibration, contracts, selection, causal records, and independent approval.
- Controls grant no allocation or execution authority.
- Infrastructure stays disclosed.

## Acceptance
- Users can inspect disagreement, review, replicate, checkpoint, propose, and independently approve exact contracts.
- Evidence: [browser journey](../../../tests/e2e/pool-evidence-journey.spec.js), [room](../../../tests/unit/pool-room-projection.test.js), [candidate](../../../tests/unit/pool-discovery-candidate-action.test.js), [replay](../../../tests/unit/pool-discovery-contract.test.js), [adjudication](../../../tests/unit/pool-adjudication-experiment.test.js), and [value](../../../tests/unit/pool-realized-action-value.test.js) tests.

## Non-goals
- Exposing Zero, X, network simulation, or generic peer inference as the primary workflow.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
