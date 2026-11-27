# CATSCAN: Browser Runtime

Parent: [Reploid](../CATSCAN.md)

## Target

Boot the selected Reploid surface in a browser with explicit configuration, recoverable state, and inspectable authority boundaries.

## Authority
- Owns browser boot, application composition, persistence choices, credentials and user-interface delivery.
- Reusable runtime, persistence and peer mechanics move to `packages/reploid/`; temporary modules here forward to its generated public entries.
- Does not own hosted relay truth, scientific truth, or repository strategy.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Surface selection from [surface intents](../shared/config/surface-intents.js).
- Runtime modules from the [manifest](manifest.js).

Outputs:
- The substrate entry points [zero/boot.js](zero/boot.js), [host/boot-x.js](host/boot-x.js) and [kernel/boot.js](kernel/boot.js); product entries belong to [Poolday](../apps/poolday/CATSCAN.md).
- Seeded runtime state through [boot seed](config/boot-seed.js).

## Invariants
- A route must resolve to one declared surface and authority profile.
- Recovery state and mutable state remain distinguishable.
- Zero bootstraps from its minimal self-source; X at `spark` boots Zero's capsule via [host/boot-x.js](host/boot-x.js) and loads extra modules only for upgrades above `spark`, never by branching Zero's modules. The two-file adapter in [zero-extension.json](../docs/x/zero-extension.json) may only shrink (`npm run verify:x-extension`). Existing instances retain owned source and work.
- Browser-local claims remain bounded by verifiable records.

## Acceptance
- Supported surfaces boot from their declared profiles and preserve the runtime contract.
- Evidence: [browser boot test](../tests/e2e/boot.spec.js) and [runtime unit test](../tests/unit/self-runtime.test.js).

## Non-goals
- Making every substrate capability visible in each product surface.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
