# CATSCAN: Blueprint Registry

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Preserve discoverable design records for runtime modules without substituting design descriptions for current proof.

## Authority
- Owns blueprint identifiers, module design descriptions, and the generated blueprint registry.
- Does not own runtime status, product intent, or acceptance evidence.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Documentation rules from the [documentation index](../../docs/INDEX.md).
- Blueprint source files in this directory.

Outputs:
- The generated [blueprint registry](../config/blueprint-registry.json).

## Invariants
- Blueprint identifiers remain unique and resolvable.
- A blueprint documents intended mechanics; it cannot prove that code is current, deployed, or accepted.

## Acceptance
- Every registered blueprint resolves to its declared source and module identity.
- Evidence: [blueprint registry](../config/blueprint-registry.json).

## Non-goals
- Acting as a roadmap, component charter, or live status report.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
