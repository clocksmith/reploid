# CATSCAN: Purchase Reconciliation

Parent: [Hosted Services](../CATSCAN.md)

## Target

Confirmed one-time top-ups issue purchased credit exactly once, and refunds and chargebacks reverse it, behind a processor interface.

## Authority
- Owns checkout records, notification authenticity through the processor port, authoritative-status reconciliation, polling recovery and the ledger's purchased `issuanceAuthority`.
- Excludes prices (explicit policy), rate values ([conversion records](../ledger/conversion/CATSCAN.md)), real processors, keys, taxes, terms, balances and spent-credit treatment.

## Scope

- This directory; [test-processor.js](test-processor.js) serves local runs and tests only.

## Contracts

Inputs:
- Explicit payment policy, the [processor port](processor-contract.js) and an account port for authenticated participants.
- Processor notifications and authoritative payment status.

Outputs:
- Operations in [store-contract.js](store-contract.js); purchased issuance and reversals in the [ledger](../ledger/CATSCAN.md).

## Invariants
- Only port-verified notifications count; they only name a purchase its processor reconciles.
- Effects follow fetched authoritative status, so repeated, reordered and replayed notifications converge.
- Checkouts quote and stamp credits under the conversion record in effect; later records never change them.
- One purchased lot per purchase, minted after confirmation at the checkout's amount and stamped credits.
- Polling recovers missed notifications; restarts resume without second effects.
- Full refunds and chargebacks reverse the lot; partial reversals and amount mismatches await review.
- Top-ups never recur.

## Acceptance
- Memory and Firestore stores pass identical scenarios.
- Evidence: [reconciliation](../../tests/unit/payment-reconciliation.test.js), [Stripe](../../tests/unit/stripe-processor.test.js) tests.
- Real processors need live authenticity, refund, chargeback, tax and terms acceptance.

## Non-goals
- Moving money, card data, tax calculation, pricing or dispute representation.

## Freedom
Preserve boundaries; pass acceptance.
