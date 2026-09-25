# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot configured browser surfaces from trusted seeds.

## Authority
- Owns VFS seeding, module loading, startup and application tools.
- Composes agent threads with retained objectives and exact-payload approval.
  Conversations may use explicit revocable grants bound to verified recipient,
  mesh, thread, model and adapters.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Pack jobs.
- Tasks validate; repositories version; providers execute; views expose immutable state.
- Excludes product policy, module semantics and recovery-root immutability.

## Scope

- This tree.

## Contracts

Inputs: [boot seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs:
- Seeded virtual files through [seed-vfs.js](seed-vfs.js).
- Application startup through [start-reploid.js](start-reploid.js).

## Invariants
- Keep seed identity/destination explicit.
- Never substitute missing or unverified modules.
- Automatic discovery is cancellable; disconnect prevents background rejoin. Joining grants no compute, disclosure, file or improvement authority.
- Received files cannot grant permissions or prove correctness.
- Viewing/stopping threads cannot change another's objective, grants or execution.
- Peer candidate delivery grants no evaluation or adoption authority.
- Peer operations require current authorization, exact execution identities and retained evidence.
  Thread grants authorize disclosure only; new recipients/execution identities require approval.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.
- Version objectives/measures outside candidate isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete; VFS round trips succeed.
- Evidence: [boot-seed test](../../tests/unit/boot-seed.test.js) and [VFS integration test](../../tests/integration/vfs.test.js).

## Non-goals
- Choosing the scientific question, model policy, or promotion outcome.

## Freedom
Preserve boundaries and acceptance evidence.
