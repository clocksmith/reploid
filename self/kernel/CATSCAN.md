# CATSCAN: Genesis Kernel

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Provide the smallest immutable browser boot and recovery path from which the mutable runtime can be restored safely.

## Authority
- Owns kernel boot order, immutable recovery entrypoints, and failure containment before mutable startup.
- Does not own product routing, agent policy, or application state.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- The kernel document in [index.html](index.html).
- Host startup through [boot.js](boot.js).

Outputs:
- A verified handoff to the host runtime.

## Invariants
- Mutable code cannot silently replace the recovery root.
- Boot failure remains explicit and cannot masquerade as a successful application start.

## Acceptance
- The boot shell and genesis integrity checks pass.
- Evidence: [boot-shell test](../../tests/unit/self-boot-shell.test.js) and [genesis integrity test](../../tests/unit/genesis-integrity.test.js).

## Non-goals
- Implementing product features or mutable agent behavior.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
