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
- Selection/closure never cancels; cancellation affects one attempt.
- Streams bind thread/attempt; retries create distinct attempts/generations.
- Restore unfinished attempts as interrupted; never silently resend.
- One requester-owned transactional writer commits canonical/ordered records; known rejections never fence.
- Permissions precede placement; model/adapter identity stays exact.
- Disclosure, including passages, needs covering per-send/stored permission.
  Records bind wording/recipients and distinguish setting authorization from dialog consent.
- Search binds query/service/recipients once. Send/Retry replace dialogs; distinguish consent. Exclude unrelated history; retries renew grants.
- Ordinary follow-ups retain digest-checked completed-turn passages under new Send
  authorization. Search-only grants exclude history; retained evidence is not fresh retrieval.
- Persist reusable grants binding verified recipient/mesh/thread/model/adapters/scope before use;
  revocation cancels affected attempts/reuse. They authorize no contribution/supply/evaluation/adoption.
- Share bounded residency; reset conversation/adapter state between executions.
- Fairness uses host-authenticated participants, never requester-chosen thread IDs.
- Cancellation retains the device slot until execution/cleanup settle.
- Bind queue/load/execution/failure/supply observations to attempts; hosted/unrecognized executors fail closed.
- Files/adapters/whole-requests/Doppler-splits remain distinct.

## Acceptance
Evidence: [workspace](../../../../tests/unit/chat-workspace.test.js),
[scheduler](../../../../tests/unit/chat-scheduler.test.js), [tabs](../../../../tests/e2e/chat-three-tab.spec.js),
[publication](../../../../tests/unit/ordered-publication.test.js), [retrieval](../../../../tests/unit/chat-retrieval.test.js),
[search](../../../../tests/unit/search-answer-permission.test.js), [provenance](../../../../tests/unit/supply-provenance.test.js).
Tabs cover concurrency/transfers/refresh/peer-loss; physical qualification separate.

## Non-goals
Agent loops, model mathematics, transport reimplementation, admission or qualification by UI.

## Freedom
Preserve boundaries and acceptance.
