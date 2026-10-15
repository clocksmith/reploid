# CATSCAN: Service Credit Ledger

Parent: [Hosted Services](../CATSCAN.md)

## Target

Durable credit accounts, quotes, reservations and settlement giving each billable event exactly one economic effect.

## Authority
- Owns lots/provenance, quote terms, monetary reservations, settlement outcomes, refunds, purchase reversals, append-only journal, [funding commitments](funding/CATSCAN.md), [conversion records](conversion/CATSCAN.md), solvency inputs.
- Excludes prices, rates, reward amounts/validation, payments, capacity admission, disclosure grants, quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit accounting policy under the [economics contract](../../docs/product-specification.md#3-credits-and-marketplace).
- Validated-work, purchase, donation or funding references; device authority inside quote acceptance.
- Requester route-attempt reports under [declared outcome rules](attempt-outcomes.js).

Outputs:
- [Store operations](store-contract.js), settlement receipts, kept route records, solvency snapshots.

## Invariants
- Balances never expire; quantity, purchase price, reward and service price stay distinct.
- Subsidized reward lots keep own provenance, never reported earned.
- Atomic, idempotent mutations; duplicates/replays cause no second effect.
- Charges follow accepted terms up to their maximum; more needs new acceptance.
- One acceptance's attempts share one billable event; reports never name outcomes or charges.
- Expired reservations release; failed quality awaits operational review.
- Transfers stay disabled until approved activation.
- Separate from Poolday points, compute reservations, resource settlement, transfer allowances.
- Spending never adds per-request disclosure review.
- Reversals remove purchased lots' unspent credit; spent credit follows declared treatment.

## Acceptance
- Memory and Firestore pass identical scenarios.
- Evidence: [ledger](../../tests/unit/credit-ledger.test.js), [reversal](../../tests/unit/credit-reversals.test.js), [execution](../../tests/integration/earning-execution.test.js) tests.

## Non-goals
- Payment processing, reward policy, solvency stress tests, marketplace trading, financial-accounting qualification.

## Freedom
Preserve boundaries; pass acceptance.
