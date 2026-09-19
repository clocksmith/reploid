# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Materialize the configured browser runtime from trusted seed assets and hand control to the selected application surface.

## Authority
- Owns VFS seeding, service-worker module loading, application startup, and application-selected task tools.
- Composes the agent with local work retention and exact-payload peer approval.
- Composes helpers, compatibility text swarms, isolated tools, protected suites and operator activation separately from admitted Pack jobs.
- Work task contracts own validation, the repository owns committed revisions, providers own execution adaptation, and views expose detached immutable state.
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
- Task files cannot grant permissions; file inspection does not establish execution correctness.
- Peer operations require fresh host approval, exact execution identities, and retained acceptance evidence.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.

## Acceptance
- Seeded modules are complete and the VFS round trip is valid.
- Evidence: [boot-seed test](../../tests/unit/boot-seed.test.js) and [VFS integration test](../../tests/integration/vfs.test.js).

## Non-goals
- Choosing the scientific question, model policy, or promotion outcome.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
