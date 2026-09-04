# CATSCAN: Poolday Product Contracts

Parent: [Documentation](../CATSCAN.md)

## Target

Define Poolday's peer-execution product authority, evidence boundaries, and explicit infrastructure and scientific non-claims.

## Authority
- Owns canonical Poolday intent, user workflow, evidence semantics, and claim boundaries.
- Does not own implementation status, deployment status, or repository-wide strategy outside Poolday.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Durable repository goals from [GOALS.md](../../GOALS.md).
- Implemented evidence behavior from the [Poolday runtime charter](../../self/pool/CATSCAN.md).

Outputs:
- Canonical product direction in [product-intent.md](product-intent.md).
- Bounded public claims in [claims-and-nonclaims.md](claims-and-nonclaims.md).

## Invariants
- Accepted means admissible under a named policy, never globally true.
- Receipt, agreement, review, laboratory, and biological claims remain distinct.
- Public-sequence support cannot imply private-sequence protection.
- The product loop adds improved later decisions and repeat independent use to request, execution, comparison, acceptance, and retained receipts.
- Doppler Pack identity and qualification remain distinct from peer availability and successful execution.
- Recent jobs remains execution-only; scientific Room-1 administration has a separate non-primary route.

## Acceptance
- Product contracts remain compatible with peer-job, recovery, research-cycle, and surface-claim behavior.
- Evidence: [peer-room tests](../../tests/unit/pool-peer-room.test.js), [research-cycle tests](../../tests/unit/pool-research-cycle.test.js), and [surface claim tests](../../tests/unit/surface-claim-index.test.js).

## Non-goals
- Advertising Zero, X, peer count, a trustless marketplace, hardware attestation, or scientific truth as the product.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
