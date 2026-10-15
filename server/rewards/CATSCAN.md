# CATSCAN: Contribution Rewards

Parent: [Hosted Services](../CATSCAN.md)

## Target

Earned credit only for validated, demanded contribution under accepted offers, within capacity-aware issuance limits.

## Authority
- Owns contribution offers, reward validation, validation records and the ledger's earned `issuanceAuthority`.
- Excludes balances, lots, prices, reward amounts, account identity, capacity admission and quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit reward and issuance policy; offer reward formulas.
- Settled [ledger](../ledger/CATSCAN.md) reservations, route attempt summaries, contributor admission records, owner policies, identity and admitted-capacity ports.

Outputs:
- Operations in [store-contract.js](store-contract.js) and earned-issuance decisions.

## Invariants
- Only validator-qualified, policy-enabled categories earn. Delivery, contracted storage and prepared availability stay disabled; online time earns nothing.
- Offers bind work, reward basis, validation conditions, bounds, duration, payment timing and failure compensation before admission.
- Rewards need a requester's accepted quote and completed settlement binding the contributor's stage; signatures or peer agreement never suffice.
- One reward per stage share of a settled attempt; replays have no second effect.
- Same account, owner or participant, and policy-named account links, earn nothing.
- Earned issuance stays within policy shares of measured settled demand and fresh admitted capacity.
- Rejections and declines are retained.

## Acceptance
- Memory and Firestore stores pass identical reward scenarios.
- Evidence: [reward tests](../../tests/unit/contribution-rewards.test.js).

## Non-goals
- Reward amounts, account identity, payments, clawback or storage/readiness proof.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
