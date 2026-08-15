# CATSCAN: Poolday Evidence Runtime

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Produce and govern exact, inspectable model and review evidence for bounded public-protein adjudication questions.

## Authority
- Owns browser-side Poolday model contracts, assignments, receipts, agreement, research records, and admission mechanics.
- Does not own biological truth, hosted relay authority, RSI evaluation, or private-sequence claims.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Product boundaries from [Poolday product intent](../../docs/poolday/product-intent.md).
- Exact runtime policy from [pool-config.json](pool-config.json).

Outputs:
- Signed execution records through [inference-receipt.js](inference-receipt.js).
- Governed research state through [research-cycle.js](research-cycle.js).

## Invariants
- A receipt proves only its declared signed record and identities.
- Provisional archive material and policy-admissible decision memory remain distinct.
- Agreement, review, and acceptance never imply biological truth.

## Acceptance
- Exact model, evidence, and research-cycle contracts pass focused verification.
- Evidence: [Pool contract tests](../../tests/unit/pool-contract.test.js) and [research-cycle tests](../../tests/unit/pool-research-cycle.test.js).

## Non-goals
- Maximizing inference volume, peer count, or generic decentralized compute.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
