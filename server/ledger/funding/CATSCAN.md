# CATSCAN: Funding Commitment Register

Parent: [Service Credit Ledger](../CATSCAN.md)

## Target

One record per external funding commitment, with every use's allocation drawn within its total.

## Authority
- Owns commitments, external-reference claims, allocations by use, issued credits, release, expiry and the solvency `funding` view.
- Excludes funding decisions and amounts, who holds funding authority, rate values and each use's accepted funder kinds.

## Scope

- This directory.

## Contracts

Inputs:
- Commitments: funder kind (donor, operator or community) and identity, external reference, total (credits or currency minor units), validity.
- Allocations for [reward funding](../../rewards/CATSCAN.md), [Community Access pools](../../community-access/CATSCAN.md) and donated credit, each with accepted kinds and its owner's authority decision.

Outputs:
- Ledger operations in [store-contract.js](../store-contract.js); the solvency `funding` block.

## Invariants
- An external reference records one commitment; uses record none of their own.
- Allocations commit atomically with their commitment's total, never exceeding it.
- Currency allocations convert under the [conversion record](../conversion/CATSCAN.md) in effect and stamp it.
- Drawn lots name their funder and consume their allocation within the issuance transaction.
- Allocation and whole issuance need validity, which sets status.
- Reported consumption never falls below issued credits and caps later issuance; closing returns the rest.
- Unissued donated allocations expire here; other uses expire their own.
- Allocations and releases name an authority and decision.

## Acceptance
- Memory and Firestore stores pass identical scenarios.
- Evidence: [funding register tests](../../../tests/unit/funding-register.test.js).

## Non-goals
- Moving money, funder verification or expiring issued balances.

## Freedom
Preserve boundaries; pass acceptance.
