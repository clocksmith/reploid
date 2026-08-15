# CATSCAN: Reploid

Parent: none

## Target

Help curators adjudicate bounded uncertainty about public protein annotations with inspectable, reusable evidence and accountable decisions.

## Authority
- Owns repository-wide product boundaries, component precedence, and proof requirements.
- Does not turn infrastructure activity, model output, or accepted evidence into biological truth.

## Scope

- Includes repository-wide work and paths not narrowed by a child CATSCAN.

## Contracts

Inputs:
- Strategic intent from [GOALS.md](GOALS.md).
- Current claim status from the [surface claim index](docs/status/surface-claim-index.json).

Outputs:
- Human navigation in the [README](README.md).
- Recursive component authority in the [component index](docs/component-index.md).

## Invariants
- Poolday, Zero, and X retain separate authority.
- Claims stay bounded by recorded acceptance evidence.
- Existing code cannot silently overrule a charter.

## Acceptance
- The charter graph validates, its index is current, and targeted work can resolve its full authority chain.
- Evidence: [CATSCAN validator tests](tests/unit/catscan.test.js).

## Non-goals
- Defining every implementation mechanism or treating peer count, mutation volume, and inference volume as product outcomes.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
