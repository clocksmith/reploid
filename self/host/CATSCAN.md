# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot surfaces from trusted seeds.

## Authority
- Owns seeding/startup/tools and independent threads.
- Remote disclosure needs stored, revocable contributor permissions
  (sharing-scope/disclosure-kind/model-catalog), thread grants or per-server search settings.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Packs.
- Tasks validate; repositories version; providers execute; views are immutable.
- Excludes policy/module semantics/recovery-root mutation.

## Scope

Subtree.

## Contracts

Inputs: [seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs: [VFS](seed-vfs.js), [startup](start-reploid.js).

## Invariants
- Explicit seed identity/destination.
- Never substitute missing/unverified modules.
- Disconnect prevents rejoin. Discovery grants no compute/disclosure/files/improvement/stage authority;
  only operator configuration assigns stages or chooses `auto` (own-policy choice).
- Partition network owners expose open/close; closure requires settled channels.
- Received files cannot grant permissions or prove correctness.
- Viewing/stopping threads cannot change another's objective/grants/execution.
- Candidate delivery grants no evaluation/adoption authority.
- Peer operations require current authorization/exact identities/evidence.
  Uncovered requests send nothing until granted; revocation spares admitted
  answers, which never change route.
  Ordered catalogs with metadataDigest open one tab's transactional history, else report ordinary.
- File contribution requires separate bounded consent. Explicit compute may acquire
  selected files, not redistribute. Discovery never downloads weights.
- Doppler storage verifies files; inventories cannot select code.
  Resident leases include adapter application/evidence/removal/cancellation settlement.
- Candidates cannot read protected tests or self-activate; attempts pin versions, retaining rollback sources.
- Version objectives/measures outside isolation; changed objectives require reevaluation.

## Acceptance
- Seeded modules are complete; VFS round-trips succeed.
- Evidence: [boot](../../tests/unit/boot-seed.test.js), [VFS](../../tests/integration/vfs.test.js),
  [chat](../../tests/e2e/chat-real-adapter.spec.js), [races](../../tests/unit/work-swarm-lifecycle.test.js),
  [history](../../tests/unit/ordered-requester-history.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve boundaries and acceptance.
