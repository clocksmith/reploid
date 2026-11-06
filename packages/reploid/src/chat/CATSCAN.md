# CATSCAN: Conversation Workspace

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Concurrent authorized conversations; no global objective.

## Authority
Owns history/membership/permissions/attempts/streams/scheduling.
Hosts supply authenticated identity/persistence/admission/disclosure/retrieval and Doppler sessions.

## Scope
Directory.

## Contracts
Inputs: explicit policy, model identities and host ports.
Outputs: isolated conversations, bounded attempts, provenance-bound observations.
Compose custody/whole-request jobs/[retrieval](../retrieval/CATSCAN.md); file possession grants no execution.

## Invariants
- Selection/closure never cancels; cancellation affects one attempt and retains device slots until execution/cleanup settle.
- Streams bind thread/attempt; retries create distinct attempts/generations; unfinished attempts restore as interrupted without resending.
- One requester-owned transactional writer commits canonical/ordered records; known rejections never fence.
- Permissions precede placement; model/adapter identity stays exact. Only marked automatic choices resolve before any message, attempt or grant; unmarked/explicit choices stay pinned.
- Disclosure (including passages) requires covering per-send or stored permission binding wording/recipients and distinguishing setting authorization from dialog consent.
- Search binds query/service/recipients once, excludes unrelated history, and renews grants on retry. Ordinary follow-ups retain digest-checked completed-turn passages under new Send authorization; retained evidence is not fresh retrieval.
- Reusable grants bind verified recipient/mesh/thread/model/adapters/scope before use; revocation cancels affected attempts/reuse; grants authorize no contribution/supply/evaluation/adoption.
- Share bounded residency; reset conversation/adapter state between runs; schedule fairly by authenticated participant.
- Bind queue/load/execution/failure/supply observations to attempts; unrecognized executors fail closed; files/adapters/whole-requests/Doppler-splits stay distinct.

## Acceptance
Evidence: [workspace](../../../../tests/unit/chat-workspace.test.js), [scheduler](../../../../tests/unit/chat-scheduler.test.js), [tabs](../../../../tests/e2e/chat-three-tab.spec.js), [publication](../../../../tests/unit/ordered-publication.test.js), [retrieval](../../../../tests/unit/chat-retrieval.test.js), [search](../../../../tests/unit/search-answer-permission.test.js), [provenance](../../../../tests/unit/supply-provenance.test.js). Physical qualification separate.

## Non-goals
Agent loops, model mathematics, transport reimplementation, UI admission/qualification.

## Freedom
Preserve boundaries and acceptance.
