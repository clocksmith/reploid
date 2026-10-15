# CATSCAN: Purchase Reconciliation

Parent: [Hosted Services](../CATSCAN.md)

## Target

Confirmed one-time top-ups issue purchased credit exactly once, and refunds and chargebacks reverse it, behind a processor interface.

## Authority
- Owns checkout records, notification authenticity through the processor port, authoritative-status reconciliation, polling recovery and the ledger's purchased `issuanceAuthority`.
- Excludes prices and quantities (explicit policy), real processors, keys, taxes, terms, balances, lots and spent-credit treatment.

## Scope

- This directory; [test-processor.js](test-processor.js) serves local runs and tests only.

## Contracts

Inputs:
- Explicit payment policy, the [processor port](processor-contract.js) and an account port for authenticated participants.
- Processor notifications and authoritative payment status.

Outputs:
- Operations in [store-contract.js](store-contract.js); purchased issuance and reversals in the [ledger](../ledger/CATSCAN.md).

## Invariants
- Only port-verified notifications count, and they only name a purchase.
- Effects follow fetched authoritative status, so duplicate, reordered and replayed notifications converge.
- One purchased lot per purchase, minted only after confirmation at the checkout's amount for its account.
- Polling recovers missed notifications; restarts resume without a second effect.
- Full refunds and chargebacks reverse the lot; partial reversals and amount mismatches await review.
- Top-ups never recur.

## Acceptance
- Memory and Firestore stores pass identical reconciliation scenarios.
- Evidence: [reconciliation tests](../../tests/unit/payment-reconciliation.test.js).
- A real processor needs its own authenticity, refund, chargeback, tax and terms acceptance.

## Non-goals
- Moving money, card data, tax calculation, pricing or dispute representation.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
