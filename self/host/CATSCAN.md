# CATSCAN: Runtime Host

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Boot trusted seeds.

## Authority
- Owns seeding/startup/tools, threads, optional [earning client](earning/CATSCAN.md).
- Disclosure requires revocable contributor/thread/search grants.
- Network answers default on. Send/Retry bind host-policy grants without dialogs.
  Persist opt-outs; distinguish legacy consent; preserve local-only/search boundaries.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Packs.
- Separately authorizes isolated training; export never activates.
- Tasks validate; repositories version; providers execute; views remain immutable.
- Excludes policy/module semantics/recovery-root mutation.

## Scope

Subtree.

## Contracts

Inputs: [seed](../config/boot-seed.js), [start-app.js](start-app.js).

Outputs: [VFS](seed-vfs.js), [startup](start-reploid.js).

## Invariants
- Explicit seeds; no missing/unverified module substitutions.
- Lab images export complete self-source; builds never delete existing work.
- Disconnect prevents rejoin. Discovery grants no authority;
  only operator configuration assigns stages or chooses own-policy `auto`.
- Partition network owners expose open/close; closure requires settled channels.
- Files grant no permissions/correctness.
- Viewing/stopping preserves others' objectives/grants/execution.
- Candidate delivery grants no evaluation/adoption authority.
- Peers require authorization/exact identities/evidence. Uncovered requests wait;
  revocation spares admitted answers; never reroute them.
  metadataDigest catalogs open single-tab transactional history, otherwise ordinary.
- Connection, introductions, cached compute/file sharing default on;
  Separate off controls; downloads require approval.
  Discovery never downloads weights.
- Doppler storage verifies files; inventories cannot select code.
  Resident leases include adapter application/evidence/removal/cancellation settlement.
- Candidates cannot read protected tests or self-activate; attempts pin versions, retaining rollback sources.
- Version objectives/measures externally; changes require reevaluation.

## Acceptance
- Complete seeds; VFS round-trips.
- Evidence: [boot](../../tests/unit/boot-seed.test.js), [VFS](../../tests/integration/vfs.test.js),
  [chat](../../tests/e2e/chat-real-adapter.spec.js), [races](../../tests/unit/work-swarm-lifecycle.test.js),
  [history](../../tests/unit/ordered-requester-history.test.js), [search](../../tests/unit/search-answer-permission.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve.
