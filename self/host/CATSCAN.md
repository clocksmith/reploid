# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot configured browser surfaces from trusted seeds.

## Authority
- Owns VFS seeding, module loading, startup and application tools.
- Composes concurrent agent threads with retained objectives and per-thread exact-payload approval.
- Composes helpers, swarms, previews, isolation, evaluation and activation separately from Pack jobs.
- Tasks own validation; repositories own revisions; providers adapt execution; views expose immutable state.
- Does not own product policy, module semantics, or recovery-root immutability.

## Scope

- This tree.

## Contracts

Inputs: [boot seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs:
- Seeded virtual files through [seed-vfs.js](seed-vfs.js).
- Application startup through [start-reploid.js](start-reploid.js).

## Invariants
- Seed identity and destination remain explicit.
- Host loading cannot silently substitute missing or unverified modules.
- Automatic discovery is cancellable; disconnect prevents background rejoin. Joining grants no compute, disclosure, file or improvement authority.
- Received files cannot grant permissions or prove correctness.
- Viewing or stopping one thread cannot change another's objective, grants or execution.
- Peer candidate delivery grants no evaluation or adoption authority.
- Peer operations require fresh host approval, exact execution identities, and retained acceptance evidence.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.
- Selects versioned objectives and measures outside candidate isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete; VFS round trips succeed.
- Evidence: [boot-seed test](../../tests/unit/boot-seed.test.js) and [VFS integration test](../../tests/integration/vfs.test.js).

## Non-goals
- Choosing the scientific question, model policy, or promotion outcome.

## Freedom
Preserve boundaries and acceptance evidence.
