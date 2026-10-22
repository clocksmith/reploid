# CATSCAN: Runtime Configuration

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Declare reproducible per-surface boot, route, module, environment and capability configuration.

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
- Shared discovery policy selects public rendezvous, not execution authority; private invitations require room-scoped capabilities.
- Discovery may select authenticated RTC credentials, never reroute Poolday APIs or silently switch providers.
- Doppler defaults are pinned origin-relative assets; Node synchronization never serializes file URLs.
- Zero owns minimal complete self-source. X explicitly adds upgrades; neither auto-hydrates the repository or inherits legacy upgrade grants.
- Poolday, Zero, and X profiles cannot silently inherit one another's authority.
- Ordered route limits and requester-history bounds are versioned here and apply only to catalogs declaring an ordered plan. Stage assignment is per-instance operator storage, never a default, link or discovery result.

## Acceptance
- Surface intent and boot-seed contracts remain valid.
- Evidence: [surface-intent tests](../../tests/unit/surface-intents.test.js) and [boot-seed tests](../../tests/unit/boot-seed.test.js).

## Non-goals
- Using configuration names as proof that a capability works.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
