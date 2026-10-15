# CATSCAN: Service Credit Ledger

Parent: [Hosted Services](../CATSCAN.md)

## Target

Durable credit accounts, quotes, reservations and settlement giving each billable event one economic effect.

## Authority
- Owns lots/provenance, quote terms, reservations, settlement outcomes, disputes, refunds, purchase reversals, append-only journal, [funding commitments](funding/CATSCAN.md), [conversion records](conversion/CATSCAN.md), solvency inputs.
- Excludes prices, rates, reward amounts/validation, payments, capacity admission, disclosure grants, quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit accounting policy ([economics contract](../../docs/product-specification.md#3-credits-and-marketplace)).
- Validated-work, purchase, donation, funding references; acceptance-time device authority.
- Requester reports and signed evidence under [outcome](attempt-outcomes.js) and [evidence](attempt-evidence.js) rules.

Outputs:
- [Store operations](store-contract.js), settlement receipts, route records, solvency snapshots.

## Invariants
- Balances never expire; quantity, purchase price, reward and service price differ.
- Subsidized reward lots keep provenance, never reported earned.
- Atomic, idempotent mutations; replays cause no second effect.
- Charges follow accepted terms to their maximum; more needs new acceptance.
- One acceptance's attempts share one billable event; reports never name outcomes or charges.
- Acknowledgments override understated or missing reports; unacknowledged assertions stay disputed for review.
- Expired reservations release; failed quality awaits review.
- Transfers stay disabled pending approval.
- Separate from Poolday points, compute reservations and allowances.
- Spending adds no disclosure review.
- Reversals remove purchased lots' unspent credit; spent credit follows declared treatment.

## Acceptance
- Memory and Firestore pass identical scenarios.
- Evidence: [ledger](../../tests/unit/credit-ledger.test.js), [reversal](../../tests/unit/credit-reversals.test.js), [execution](../../tests/integration/earning-execution.test.js), [evidence](../../tests/integration/earning-evidence.test.js) tests.

## Non-goals
- Payment processing, reward policy, stress tests, marketplace trading, financial-accounting qualification.

## Freedom
Preserve boundaries; pass acceptance.
