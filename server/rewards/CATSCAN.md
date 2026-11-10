# CATSCAN: Contribution Rewards

Parent: [Hosted Services](../CATSCAN.md)

## Target
Credit only for validated, demanded contribution under accepted offers within capacity-bounded issuance bases.

## Authority
- Owns what [earns](../../docs/open-mesh-architecture.md#earning-vocabulary): offers, per-category claim validation, contract challenges, readiness probes, funding reservations, delivery evidence and ledger `issuanceAuthority`.
- Excludes balances, prices, reward amounts, identity, capacity admission and quality adjudication.

## Scope
Directory.

## Contracts
Inputs: reward/issuance policy and offer terms; [Ledger](../ledger/CATSCAN.md) settlements, route summaries or kept stage receipts, attested REP-5 receipts, certified custody keys, probe ports, capacity evidence.
Outputs: [store operations](store-contract.js); earned/subsidized issuance decisions.

## Invariants
- Only policy-enabled categories earn, never online time.
- Evidence roots: ledger settlement, recipient-attested receipts (from attesting devices only), or store-run challenges/probes; signatures alone never suffice.
- Whole-model inference requires an explicit whole-model offer, the accounting owner's kept measured receipt, a policy-bound quality decision and the settled requester quote (never inventing a partition stage or earning on missing evidence).
- Readiness requires admission/execution/settlement probes, never stored bytes; storage is accessible delivery, not local-custody proof.
- Missed/failed obligations reduce or void rewards; rejections, voids and declines persist; disputes earn only after review.
- Subsidized credit draws open, authority-approved [register](../ledger/funding/CATSCAN.md) allocations within admitted capacity.
- One reward per work unit; same account, owner, participant or named link earns nothing.

## Acceptance
Evidence: memory and Firestore pass identical [inference](../../tests/unit/contribution-rewards.test.js), [category](../../tests/unit/contribution-reward-categories.test.js) and [delivery](../../tests/unit/custody-delivery-attribution.test.js) tests. Known-link rejection is partial collusion defense; only `failureCompensation: none`.

## Non-goals
Reward amounts, payments, clawback, local-retention proof or attested hardware.

## Freedom
Preserve boundaries and acceptance.
