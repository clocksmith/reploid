# CATSCAN: Shared Browser Code

Parent: [Reploid](../CATSCAN.md)

## Target

Serve, from one owner, the browser files that both the Poolday product and the agent substrate load.

## Authority
- Owns files referenced from both the product and the substrate, as the [ownership inventory](../docs/ownership-inventory.md) assigns them from references.
- Does not own product presentation, substrate behavior, or package implementations; `packages/reploid/src` and Doppler own those and `vendor/` delivers them.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- References from the [browser runtime](../self/CATSCAN.md) and the Poolday product.

Outputs:
- Files served at their paths in the one browser URL namespace composed by [the browser tree](../server/browser-tree.js).

## Invariants
- Shared files load only shared files.
- A file keeps its served path and bytes when it moves between source roots.
- A file used by only one side belongs to that side.

## Acceptance
- Evidence: [boundary check](../scripts/verify-browser-boundaries.js), its [tests](../tests/unit/browser-boundaries.test.js) and `npm run verify:ownership-inventory`.

## Non-goals
- Collecting general utilities that only one side uses.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
