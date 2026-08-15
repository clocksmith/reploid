# CATSCAN: Runtime Configuration

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Declare reproducible boot, route, module, environment, and capability configuration for each Reploid surface.

## Authority
- Owns executable configuration schemas, defaults, registries, and surface profiles.
- Does not own runtime behavior, user-facing strategy, or evidence admission decisions.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Supported surface boundaries from [surface intents](surface-intents.js).
- Seed requirements from [boot-seed.js](boot-seed.js).

Outputs:
- Resolvable module declarations in the [module registry](module-registry.json).
- Generated VFS declarations in the [VFS manifest](vfs-manifest.json).

## Invariants
- Configuration must fail closed when required identity or policy is absent.
- Poolday, Zero, and X profiles cannot silently inherit one another's authority.

## Acceptance
- Surface intent and boot-seed contracts remain valid.
- Evidence: [surface-intent tests](../../tests/unit/surface-intents.test.js) and [boot-seed tests](../../tests/unit/boot-seed.test.js).

## Non-goals
- Using configuration names as proof that a capability works.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
