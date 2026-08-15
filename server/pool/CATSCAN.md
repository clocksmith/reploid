# CATSCAN: Hosted Poolday Services

Parent: [Hosted Services](../CATSCAN.md)

## Target

Authenticate and relay immutable Poolday records while maintaining rebuildable hosted projections and bounded coordination.

## Authority
- Owns Poolday routes, server-side contract validation, relay storage, scheduling, and reputation projections.
- Does not execute the claimed browser model, establish biological truth, or make final room decisions.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- HTTP contracts from [routes.js](routes.js).
- Record persistence through [store-contract.js](store-contract.js).

Outputs:
- Validated immutable records and rebuildable projections through [firebase-store.js](firebase-store.js).

## Invariants
- Delivery is bounded at-least-once and duplicate handling remains explicit.
- Projections are rebuildable from accepted immutable records.
- Server receipt cannot substitute for provider execution evidence.
- Discovery Contract publication fails closed unless the checkpoint exactly
  replays the coordinator's current room snapshot.

## Acceptance
- Research routes and hosted authentication enforce identity, immutability, and policy boundaries.
- Evidence: [research route tests](../../tests/unit/pool-research-routes.test.js) and [Firebase auth tests](../../tests/unit/pool-firebase-auth.test.js).

## Non-goals
- Becoming the authority for browser computation or scientific closure.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
