# CATSCAN: Credit Conversion Records

Parent: [Service Credit Ledger](../CATSCAN.md)

## Target

Every currency-to-credit figure recomputes from one immutable, published conversion version.

## Authority
- Owns conversion records (currency, credits per minor units, rounding, effective time), per-currency version order, conversion quotes and stamp verification.
- Excludes rate values, who may publish, top-up prices and inference prices.

## Scope

- This directory.

## Contracts

Inputs:
- Records published under a named authority that the ledger's conversion-authority port allows.
- Stamps on purchase quotes, purchased lots and currency [funding allocations](../funding/CATSCAN.md).

Outputs:
- Ledger operations in [store-contract.js](../store-contract.js): publish, read, quote and verify.

## Invariants
- A conversion id holds one record; republishing converges or is refused.
- Versions take effect in publication order, never before publication.
- Each quote, purchased lot and currency allocation stamps its record; a later version never changes it.
- Issuance refuses credits its stamped record does not recompute.
- Code holds no rate.

## Acceptance
- Memory and Firestore stores pass identical scenarios.
- Evidence: [conversion tests](../../../tests/unit/credit-conversion.test.js).

## Non-goals
- Choosing rates, currency exchange, taxes or retroactive repricing.

## Freedom
Preserve these boundaries and pass acceptance.
