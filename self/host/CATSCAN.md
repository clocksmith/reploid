# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot surfaces from trusted seeds.

## Authority
- Owns seeding, startup, tools and independent threads.
- Disclosure requires approval of displayed recipients/payload per attempt,
  or revocable recipient/mesh/thread/model/adapter grants.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Packs.
- Tasks validate; repositories version; providers execute; views are immutable.
- Excludes policy, module semantics and recovery-root mutation.

## Scope

Subtree.

## Contracts

Inputs: [boot seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs: [VFS](seed-vfs.js), [startup](start-reploid.js).

## Invariants
- Explicit seed identity/destination.
- Never substitute missing/unverified modules.
- Disconnect prevents rejoin. Discovery grants no compute/disclosure/files/improvement authority.
- Partition network owners expose open/close; successful closure requires all channels settled.
- Received files cannot grant permissions or prove correctness.
- Viewing/stopping threads cannot change another's objective, grants or execution.
- Candidate delivery grants no evaluation/adoption authority.
- Peer operations require current authorization, exact identities and evidence.
  Send/Retry never self-authorizes; approval covers one live attempt only.
  Changed execution identities require a new user action.
- File contribution requires separate bounded consent. Explicit compute may acquire
  selected files, not redistribute them. Discovery never downloads weights.
- Doppler storage verifies files; inventories cannot select code.
  Resident leases include adapter application/evidence/removal and cancellation settlement.
- Candidates cannot read protected tests or self-activate; attempts pin versions and retain rollback sources.
- Version objectives/measures outside isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete; VFS round trips succeed.
- Evidence: [boot](../../tests/unit/boot-seed.test.js), [VFS](../../tests/integration/vfs.test.js),
  [real chat](../../tests/e2e/chat-real-adapter.spec.js), [races](../../tests/unit/work-swarm-lifecycle.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve boundaries and acceptance evidence.
