# CATSCAN: Poolday Evidence Runtime

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Govern inspectable evidence for bounded public-protein adjudication.

## Authority
- Owns Poolday model contracts, assignments, receipts, agreement, research records, and admission.
- Does not own biological truth, hosted relay authority, RSI evaluation, or private-sequence claims.

## Scope

- This directory and unchartered descendants.

## Contracts

Inputs:
- Product boundaries from [Poolday product intent](../../docs/poolday/product-intent.md).
- Runtime policy from [pool-config.json](pool-config.json).

Outputs:
- Execution records from [inference-receipt.js](inference-receipt.js) and governed state from [research-cycle.js](research-cycle.js).
- Replay checkpoints from [discovery-contract.js](discovery-contract.js) and candidate actions from [discovery-candidate-action.js](discovery-candidate-action.js).
- Annotation-adjudication comparisons from [evidence-network.js](evidence-network.js).

## Invariants
- A receipt proves only its declared signed record and identities.
- Archive material and policy-admissible decision memory remain distinct.
- Agreement, review, acceptance, and context matches never imply biological truth or contextual relevance; cross-room memory requires signed current-room review.
- Duplicate declared source identities count once in decision memory; only accepted corrections or authorized revocations establish supersession.
- Candidate actions remain governance proposals outside decision memory; proposal, ranking, and approval grant no execution authority.
- Numeric candidate uncertainty is admissible only with a named calibration method and an independently accepted frozen cohort; uncalibrated uncertainty remains ordinal or set-valued.

## Acceptance
- Model, evidence, research-cycle, candidate-action, replay, and adjudication contracts pass.
- Evidence: [Pool tests](../../tests/unit/pool-contract.test.js), [cycle tests](../../tests/unit/pool-research-cycle.test.js), [candidate tests](../../tests/unit/pool-discovery-candidate-action.test.js), [replay tests](../../tests/unit/pool-discovery-contract.test.js), and [adjudication tests](../../tests/unit/pool-adjudication-experiment.test.js).

## Non-goals
- Maximizing inference volume, peer count, or generic decentralized compute.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
