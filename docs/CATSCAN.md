# CATSCAN: Documentation

Parent: [Reploid](../CATSCAN.md)

## Target

Keep product intent, contracts, mechanisms, claims, and current evidence discoverable without conflating their authority.

## Authority
- Owns documentation taxonomy, navigation, and distinctions among intent, design, claims, and status.
- Does not use prose to substitute for implementation, tests, deployment evidence, or user-owned intent.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Repository strategy from [GOALS.md](../GOALS.md).
- Documentation conventions from the [documentation index](INDEX.md).

Outputs:
- Navigable documentation through [INDEX.md](INDEX.md).
- Generated charter discovery through the [component index](component-index.md).

## Invariants
- Product intent and current status remain separate.
- Claims link to evidence and retain explicit non-claims.
- Generated documents are changed through their generator.

## Acceptance
- Claim references remain valid and the component index matches the charter graph.
- Evidence: [surface claim tests](../tests/unit/surface-claim-index.test.js) and [CATSCAN tests](../tests/unit/catscan.test.js).

## Non-goals
- Turning design notes or aspirational prose into proof of working behavior.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
