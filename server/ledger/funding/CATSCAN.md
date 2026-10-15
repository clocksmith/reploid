# CATSCAN: Funding Commitment Register

Parent: [Service Credit Ledger](../CATSCAN.md)

## Target

One record per external funding commitment, with every use's allocation drawn within its total.

## Authority
- Owns funding commitments, external-reference claims, allocations by named use, issued credits, their release and expiry, and the solvency `funding` view.
- Excludes funding decisions and amounts, who holds funding authority, currency-to-credit conversion and which funder kinds a use accepts.

## Scope

- This directory.

## Contracts

Inputs:
- Commitments naming funder kind and identity, external reference, total (credits or currency minor units) and validity.
- Allocations for [reward funding](../../rewards/CATSCAN.md), [Community Access pools](../../community-access/CATSCAN.md) and donated credit, each with accepted funder kinds and its owner's authority decision.

Outputs:
- Ledger operations in [store-contract.js](../store-contract.js) and the solvency `funding` block.

## Invariants
- An external reference records one commitment.
- Each allocation commits in one ledger transaction with its commitment's total and never exceeds it.
- Subsidized, Community Access and donated lots draw their allocation inside the issuance transaction, never beyond it.
- Allocation and whole issuance need validity; status derives from it.
- Reported consumption never falls below issued credits and caps later issuance; release or expiry returns the rest.
- Every allocation and release names an authority and decision.
- Uses record no commitments of their own.

## Acceptance
- Memory and Firestore stores pass identical register scenarios.
- Evidence: [funding register tests](../../../tests/unit/funding-register.test.js).

## Non-goals
- Moving money, funder verification or expiring issued balances.

## Freedom
Preserve these boundaries and pass acceptance.
