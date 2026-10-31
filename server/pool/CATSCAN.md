# CATSCAN: Hosted Poolday Services

Parent: [Hosted Services](../CATSCAN.md)

## Target
Authenticate immutable records; maintain rebuildable projections and bounded coordination.

## Authority
Owns routes, validation, relay storage, scheduling and reputation projections.
Excludes browser computation, biological truth and final room decisions.

## Scope
Directory and unchartered descendants.

## Contracts
Inputs: [HTTP](routes.js), [persistence](store-contract.js).
Outputs: [validated records and projections](firebase-store.js).

## Invariants
- Delivery is bounded at-least-once; duplicate handling stays explicit.
- Projections rebuild from accepted immutable records.
- Server receipt never substitutes for provider execution evidence.
- Acceptance/rejection atomically settle receipts, ledger and reputation.
  Identical decisions replay persisted results; conflicts cannot overwrite them.
  Legacy partial settlements require reconciliation, never blind replay.
- Commit rechecks current evidence and reputation revisions. Transaction retries
  have neither external effects nor unbounded history reads.
- V2 signs closed current-attempt agreement terms. Member selectors/timestamps
  remain signed but do not change semantic identity. Replay authenticates current
  membership and returns original terms without repricing.
- Existing v1 identities remain v1; peer/forecast retain explicit v1.
- Deploy matching v2 server before browser. Retain v1 compatibility; verification
  rejection never triggers downgrade.
- Discovery publication requires exact checkpoint replay of current room state.

## Acceptance
Identity, immutability and policy boundaries hold.
Evidence: [research](../../tests/unit/pool-research-routes.test.js),
[authentication](../../tests/unit/pool-firebase-auth.test.js),
[settlement](../../tests/unit/pool-acceptance-settlement.test.js),
[versioned replay](../../tests/unit/pool-acceptance-v2.test.js).

## Non-goals
Authority over browser computation or scientific closure.

## Freedom
Preserve boundaries and acceptance.
