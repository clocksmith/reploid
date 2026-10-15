# CATSCAN: Contribution Rewards

Parent: [Hosted Services](../CATSCAN.md)

## Target

Credit only for validated, demanded contribution under accepted offers, within capacity-bounded issuance bases.

## Authority
- Owns offers, per-category validation, contract challenges, readiness probes, funding reservations, delivery evidence and the ledger's reward `issuanceAuthority`.
- Excludes balances, prices, reward amounts, identity, capacity admission and quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit reward and issuance policy; offer terms.
- [Ledger](../ledger/CATSCAN.md) settlements, route summaries, attested REP-5 receipts, identity-certified custody keys, stage probe ports and capacity evidence.

Outputs:
- Operations in [store-contract.js](store-contract.js); earned or subsidized issuance decisions.

## Invariants
- Only policy-enabled categories earn, never online time.
- Evidence roots: ledger settlement, recipient-attested receipts (kept only from attesting devices), or store-run challenges and probes; signatures alone never suffice.
- Readiness requires real admission, execution and settlement probes, never stored bytes.
- Storage is accessible delivery; byte responses cannot establish local custody.
- Missed or failed obligations reduce or void rewards per accepted terms.
- Funded-reservation credit is subsidized, never earned, from open, authority-approved [register](../ledger/funding/CATSCAN.md) allocations; bases stay within admitted capacity.
- One reward per unit of work; same account, owner, participant or named link earns nothing.
- Rejections, voids and declines persist.

## Acceptance
- Evidence: memory and Firestore pass identical [inference](../../tests/unit/contribution-rewards.test.js), [category](../../tests/unit/contribution-reward-categories.test.js) and [delivery](../../tests/unit/custody-delivery-attribution.test.js) scenarios.
- Limits: known-link rejection is incomplete collusion prevention; accounts are not shown independent; only `failureCompensation: none`.

## Non-goals
- Reward amounts, payments, clawback, local-retention proof or attested hardware.

## Freedom
Preserve boundaries and acceptance.
