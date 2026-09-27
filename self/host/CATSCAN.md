# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot surfaces from trusted seeds.

## Authority
- Owns seeding, loading, startup, tools and independent threads.
- Disclosure requires exact-payload approval or revocable recipient/mesh/thread/model/adapter grants.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Pack jobs.
- Tasks validate; repositories version; providers execute; views expose immutable state.
- Excludes policy, module semantics and recovery-root mutation.

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
- Disconnect prevents rejoin. Discovery grants no compute/disclosure/files/improvement authority.
- Received files cannot grant permissions or prove correctness.
- Viewing/stopping threads cannot change another's objective, grants or execution.
- Peer candidate delivery grants no evaluation or adoption authority.
- Peer operations require current grants, exact identities and evidence; changed recipients/models/adapters require approval.
- File contribution requires separate bounded consent. Explicit compute may acquire
  selected files, not redistribute them. Discovery never downloads weights.
- Host-pinned Doppler storage verifies catalog files; inventories cannot select code.
  Resident leases include adapter application/evidence/removal and cancellation settlement.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.
- Version objectives/measures outside candidate isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete; VFS round trips succeed.
- Evidence: [boot](../../tests/unit/boot-seed.test.js), [VFS](../../tests/integration/vfs.test.js),
  [real chat](../../tests/e2e/chat-real-adapter.spec.js), [races](../../tests/unit/work-swarm-lifecycle.test.js).

## Non-goals
- Choosing the scientific question, model policy, or promotion outcome.

## Freedom
Preserve boundaries and acceptance evidence.
