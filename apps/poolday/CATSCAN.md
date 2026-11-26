# CATSCAN: Poolday Product

Parent: [Reploid](../../CATSCAN.md)

## Target

Serve replo.id: shared models first, independent conversations, and secondary device contribution and production.

## Authority
- Owns the product's HTML entries, interface, runtime, host composition and configuration in this tree.
- Loads shared code and only the documented substrate entry points, never substrate internals.
- Does not own the agent/VFS substrate, shared browser code, Doppler computation or hosted relay truth.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Surface selection from [surface intents](../../shared/config/surface-intents.js) and [shared browser code](../../shared/CATSCAN.md).

Outputs:
- replo.id routes through [index.html](index.html): `/`, `/network` and `/work` load the [conversation workspace](../poolday-react/CATSCAN.md) ([bundle](ui/react/app.js)); specialist routes load the [vanilla bundle](ui/pool-home/app.bundle.js).
- `/design` through [design.html](design.html): the design system page, built from `@reploid/poolday-ui` ([contract](../../docs/poolday-ui-architecture.md)).

## Invariants
- New and migrated screens compose `@reploid/poolday-ui` only; the legacy vanilla UI may only shrink.
- A route resolves to one declared surface and authority profile.
- Recovery state and mutable state remain distinguishable.
- Browser-local claims and UI labels cannot imply stronger evidence than the underlying record.
- Errors, pending states, and unavailable evidence remain visible.
- Served URLs do not depend on which source root holds a file.

## Acceptance
- Routes boot, render and keep their boundaries.
- Evidence: [browser boot test](../../tests/e2e/boot.spec.js), [UI tests](../../tests/unit/production-surface.test.tsx), [CSS verification](../../scripts/verify-poolday-css-layers.js), [boundary check](../../scripts/verify-browser-boundaries.js) and the [design-system check](../../scripts/check-poolday-ui-boundaries.mjs).

## Non-goals
- Making substrate capabilities visible in the product.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
