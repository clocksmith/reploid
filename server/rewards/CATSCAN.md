# CATSCAN: Contribution Rewards

Parent: [Hosted Services](../CATSCAN.md)

## Target

Earned credit only for validated, demanded contribution under accepted offers, within capacity-aware issuance limits.

## Authority
- Owns offers, per-category validation, contract challenges and the ledger's earned `issuanceAuthority`.
- Excludes balances, lots, prices, reward amounts, identity, capacity admission and quality adjudication.

## Scope

- This directory.

## Contracts

Inputs:
- Explicit reward and issuance policy; offer formulas, obligations and thresholds.
- [Ledger](../ledger/CATSCAN.md) settlements, route summaries, attested REP-5 custody receipts, challenge answers, owner policies, identity and capacity ports.

Outputs:
- Operations in [store-contract.js](store-contract.js) and earned-issuance decisions.

## Invariants
- Only policy-enabled categories earn; online time never does.
- Offers bind work, reward basis, validation conditions, bounds, obligations, duration, payment timing and failure compensation.
- Evidence roots: ledger settlement, recipient-attested custody receipts or self-issued, timed challenges; signatures or peer agreement alone never suffice.
- Storage proofs never satisfy readiness.
- Missed or failed obligations reduce or void rewards only per accepted terms.
- One reward per unit of work; replays have no second effect.
- Same account, owner, participant or policy-named link earns nothing.
- Earned issuance stays within policy shares of settled demand and fresh admitted capacity.
- Rejections, voids and declines persist.

## Acceptance
- Memory and Firestore stores pass identical reward scenarios.
- Evidence: [inference](../../tests/unit/contribution-rewards.test.js) and [category](../../tests/unit/contribution-reward-categories.test.js) tests.

## Non-goals
- Reward amounts, account identity, payments, clawback or attested hardware.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
