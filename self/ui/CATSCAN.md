# CATSCAN: Browser Interfaces

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Render each declared surface's authoritative state and actions without inventing new authority or widening claims.

## Authority
- Owns browser presentation, interaction state, accessibility, and progressive disclosure.
- Does not own scientific acceptance, candidate promotion, transport guarantees, or persisted domain truth.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Surface boundaries from [surface intents](../config/surface-intents.js).
- State from the owning runtime component.

Outputs:
- User-visible Poolday, Zero, and X interfaces in their child components.

## Invariants
- UI labels and status cannot imply stronger evidence than the underlying record.
- Surface-specific controls remain within the owning component's authority.
- Errors, pending states, and unavailable evidence remain visible.

## Acceptance
- Shared visual contracts and surface boot behavior pass focused tests.
- Evidence: [design-system tests](../../tests/unit/design-system-css.test.js) and [browser boot test](../../tests/e2e/boot.spec.js).

## Non-goals
- Creating competing dashboards for infrastructure that belongs in progressive disclosure.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
