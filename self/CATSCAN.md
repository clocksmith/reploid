# CATSCAN: Browser Runtime

Parent: [Reploid](../CATSCAN.md)

## Target

Boot the selected Reploid surface in a browser with explicit configuration, recoverable state, and inspectable authority boundaries.

## Authority
- Owns browser boot, runtime composition, local persistence, and user-interface delivery.
- Does not own hosted relay truth, scientific truth, or repository strategy.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Surface selection from [surface intents](config/surface-intents.js).
- Runtime modules from the [manifest](manifest.js).

Outputs:
- The browser entry surface in [index.html](index.html).
- Seeded runtime state through [boot seed](config/boot-seed.js).

## Invariants
- A route must resolve to one declared surface and authority profile.
- Recovery state and mutable state remain distinguishable.
- Browser-local claims remain bounded by verifiable records.

## Acceptance
- Supported surfaces boot from their declared profiles and preserve the runtime contract.
- Evidence: [browser boot test](../tests/e2e/boot.spec.js) and [runtime unit test](../tests/unit/self-runtime.test.js).

## Non-goals
- Making every substrate capability visible in each product surface.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
