# CATSCAN: Lab Surface Composition

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Compose Zero and X operator surfaces from explicit profiles while preserving their separate proposal and evaluation authority.

## Authority
- Owns lab route profiles, mirrors, runtime surface assembly, and operator-facing lab selection.
- Does not let Zero approve candidates, let X admit Poolday policy, or merge lab records with research evidence.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Route profiles from [profiles.js](profiles.js).
- Surface boundaries from [surface intents](../config/surface-intents.js).

Outputs:
- Composed lab surfaces through [surface.js](surface.js).

## Invariants
- Zero proposes and X evaluates under separately declared profiles.
- Lab availability is not evidence of prospective product improvement.

## Acceptance
- Route profiles resolve to the correct isolated surface intent.
- Evidence: [surface-intent tests](../../tests/unit/surface-intents.test.js) and [browser boot test](../../tests/e2e/boot.spec.js).

## Non-goals
- Presenting Zero or X as ordinary Research Room navigation before prospective proof.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
