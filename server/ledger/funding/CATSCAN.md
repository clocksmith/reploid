# CATSCAN: Funding Commitment Register

Parent: [Service Credit Ledger](../CATSCAN.md)

## Target

One record per external funding commitment, with every use's allocation drawn within its total.

## Authority
- Owns funding commitments, external-reference claims, allocations by named use, their release and expiry, and the solvency `funding` view.
- Excludes funding decisions and amounts, currency-to-credit conversion, which funder kinds a use accepts, and each use's own consumption records.

## Scope

- This directory.

## Contracts

Inputs:
- Commitments naming funder kind and identity, external reference, total in credit units or currency minor units, and validity.
- Allocations for [reward funding reservations](../../rewards/CATSCAN.md) and [Community Access pools](../../community-access/CATSCAN.md), naming the funder kinds each accepts.

Outputs:
- Ledger operations in [store-contract.js](../store-contract.js) and the solvency `funding` block.

## Invariants
- An external reference records one commitment.
- Each allocation commits in one ledger transaction with its commitment's total and never exceeds it.
- Allocation and pool issuance need the commitment's validity; status derives from it.
- Release or expiry returns the unconsumed share, never more.
- Community Access issuance consumes its pool allocation inside the issuance transaction.
- Uses record no commitments of their own.

## Acceptance
- Memory and Firestore stores pass identical register scenarios across both uses.
- Evidence: [funding register tests](../../../tests/unit/funding-register.test.js).

## Non-goals
- Moving or holding money, currency conversion, funder verification or expiring issued balances.

## Freedom
Preserve these boundaries and pass acceptance.
