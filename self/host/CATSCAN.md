# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot configured browser surfaces from trusted seeds.

## Authority
- Owns VFS seeding, module loading, startup and application tools.
- Composes the agent with local work retention and exact-payload peer approval.
- Composes helpers, swarms, candidate previews, isolation, evaluation and activation separately from Pack jobs.
- Task contracts own validation; repositories own committed revisions; providers adapt execution; views expose detached immutable state.
- Does not own product policy, module semantics, or recovery-root immutability.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Seed declarations from [boot seed](../config/boot-seed.js).
- Host entry logic from [start-app.js](start-app.js).

Outputs:
- Seeded virtual files through [seed-vfs.js](seed-vfs.js).
- Application startup through [start-reploid.js](start-reploid.js).

## Invariants
- Seed identity and destination remain explicit.
- Host loading cannot silently substitute missing or unverified modules.
- Received files cannot grant permissions or prove correctness.
- Peer candidate delivery grants no evaluation or adoption authority.
- Peer operations require fresh host approval, exact execution identities, and retained acceptance evidence.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.
- Selects versioned objectives and measures outside candidate isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete and the VFS round trip is valid.
- Evidence: [boot-seed test](../../tests/unit/boot-seed.test.js) and [VFS integration test](../../tests/integration/vfs.test.js).

## Non-goals
- Choosing the scientific question, model policy, or promotion outcome.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
