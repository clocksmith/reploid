# CATSCAN: Product Host

Parent: [Poolday Product](../CATSCAN.md)

## Target

Compose conversations, network participation and contribution from host ports.

## Authority
- Owns threads and optional [earning client](earning/CATSCAN.md).
- Disclosure requires revocable contributor/thread/search grants.
- Network answers default on. Initial Send binds host grants; returning cryptographic recipients reconnect directly, while new recipients require consent. Persist opt-outs; preserve local/search boundaries.
- Separates helpers/swarms/isolation/evaluation/activation from Packs; authorizes isolated training without auto-activation.
- Tasks validate; repositories version; providers execute; views stay immutable.

## Scope

Subtree.

## Contracts

Inputs: [catalog](../../../shared/config/chat-models.json), [runtime](../pool/CATSCAN.md).

Outputs: [product session](product-session.js), [conversations](chat-session.js).

## Invariants
- Disconnect prevents rejoin. Discovery grants no authority; operator config assigns stages/`auto`.
- Partition network owners expose open/close; closure awaits settled channels.
- Files grant no permissions/correctness. Viewing/stopping preserves others' objectives/grants/execution.
- Peers require authorization/exact identities/evidence. Uncovered requests wait; revocation spares admitted answers without rerouting. `metadataDigest` catalogs single-tab transactional history.
- Paired native requesters delegate private service under enrolled identities/credit policy without public/local fallback.
- Browser contributors retain profile signing slots via Web Locks; copied tabs get distinct slots and fresh session IDs without migrating keys or claiming hardware uniqueness.
- Connection and introductions default on. Serving compute and files is opt-in, per switch. Downloads need approval; discovery downloads zero weights.
- Doppler storage verifies files; resident leases settle adapter application/evidence/removal/cancellation.
- Candidates cannot read protected tests or self-activate; attempts pin rollback sources; objective edits require reevaluation.

## Acceptance
- Evidence: [chat](../../../tests/e2e/chat-real-adapter.spec.js), [races](../../../tests/unit/work-swarm-lifecycle.test.js),
  [history](../../../tests/unit/ordered-requester-history.test.js), [search](../../../tests/unit/search-answer-permission.test.js), [storage](../../../tests/unit/model-storage.test.js).

## Non-goals
- Scientific question/model policy/promotion.

## Freedom
Preserve.
