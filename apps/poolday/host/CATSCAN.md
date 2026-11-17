# CATSCAN: Product Host

Parent: [Poolday Product](../CATSCAN.md)

## Target

Compose conversations, network participation and contribution from host ports.

## Authority
- Owns threads and the optional [earning client](earning/CATSCAN.md).
- Disclosure requires revocable contributor/thread/search grants.
- Network answers default on. Send/Retry bind host-policy grants without dialogs.
  Persist opt-outs; distinguish legacy consent; preserve local-only/search boundaries.
- Separates helpers/swarms/previews/isolation/evaluation/activation from Packs.
- Separately authorizes isolated training; export never activates.
- Tasks validate; repositories version; providers execute; views remain immutable.

## Scope

Subtree.

## Contracts

Inputs: [catalog](../../../shared/config/chat-models.json), [runtime](../pool/CATSCAN.md).

Outputs: [product session](product-session.js), [conversations](chat-session.js).

## Invariants
- Disconnect prevents rejoin. Discovery grants no authority;
  only operator configuration assigns stages or chooses own-policy `auto`.
- Partition network owners expose open/close; closure requires settled channels.
- Files grant no permissions/correctness.
- Viewing/stopping preserves others' objectives/grants/execution.
- Peers require authorization/exact identities/evidence. Uncovered requests wait;
  revocation spares admitted answers; never reroute them.
  metadataDigest catalogs open single-tab transactional history, otherwise ordinary.
- A paired native requester delegates private service under its enrolled identities
  and credit policy. A private choice cannot fall back to public or local execution.
- Connection, introductions, cached compute/file sharing default on;
  Separate off controls; downloads require approval.
  Discovery never downloads weights.
- Doppler storage verifies files; inventories cannot select code.
  Resident leases include adapter application/evidence/removal/cancellation settlement.
- Candidates cannot read protected tests or self-activate; attempts pin versions, retaining rollback sources.
- Version objectives/measures externally; changes require reevaluation.

## Acceptance
- Evidence: [chat](../../../tests/e2e/chat-real-adapter.spec.js), [races](../../../tests/unit/work-swarm-lifecycle.test.js),
  [history](../../../tests/unit/ordered-requester-history.test.js), [search](../../../tests/unit/search-answer-permission.test.js), [storage](../../../tests/unit/model-storage.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve.
