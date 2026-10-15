# CATSCAN: Service Credit Ledger

Parent: [Hosted Services](../CATSCAN.md)

## Target

Durable credit accounts, quotes, reservations and settlement giving each billable event exactly one economic effect.

## Authority
- Owns credit lots and provenance, quote terms, monetary reservations, settlement outcomes, refunds, purchase reversals, the append-only journal, [funding commitments](funding/CATSCAN.md) and solvency inputs.
- Excludes prices, reward amounts, payments, reward validation, capacity admission, disclosure grants and quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit accounting policy under the [economics contract](../../docs/product-specification.md#3-credits-and-marketplace).
- Validated-work, purchase, donation or funding references.
- Device authority read inside quote acceptance.

Outputs:
- Operations in [store-contract.js](store-contract.js), settlement receipts and solvency snapshots.

## Invariants
- Balances never expire; quantity, purchase price, reward and service price stay distinct.
- Subsidized reward lots keep their own provenance, never reported as earned.
- Mutations are atomic and idempotent; duplicates and replays cause no second effect.
- Charges follow accepted terms up to their maximum; further charges need a new acceptance.
- Expired reservations release; failed quality awaits operational review.
- Transfers stay disabled until approved activation.
- Separate from Poolday points, compute reservations, resource settlement and transfer allowances.
- Spending never adds per-request disclosure review.
- Reversals remove a purchased lot's unspent credit; spent credit follows the declared treatment.

## Acceptance
- Memory and Firestore stores pass identical ledger scenarios.
- Evidence: [ledger](../../tests/unit/credit-ledger.test.js) and [reversal](../../tests/unit/credit-reversals.test.js) tests.

## Non-goals
- Payment processing, reward policy, solvency stress testing, marketplace trading or financial-accounting qualification.

## Freedom
Preserve these boundaries and pass acceptance.
