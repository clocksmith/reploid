# CATSCAN: Conversation Workspace

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Concurrent conversations from authorized peers, without a global objective.

## Authority
Owns history/membership/permissions/attempts/streams/scheduling.
Hosts supply authenticated identity/persistence/admission/disclosure/retrieval and Doppler sessions.

## Scope
This directory.

## Contracts
Inputs: explicit policy, model identities and host ports.
Outputs: isolated conversations, bounded attempts, provenance-bound observations.
Compose custody/whole-request jobs/[retrieval](../retrieval/CATSCAN.md); file possession grants no execution.

## Invariants
- Selection/closure never cancels execution; cancellation affects one attempt.
- Stream updates bind thread/attempt. Retries create new attempts, never extending old generations.
- Restore history, marking unfinished attempts interrupted; never silently resend.
- One requester-owned transactional writer commits canonical/ordered records; known rejections never fence.
- Permissions precede placement; model/adapter identity stays exact.
- Disclosure, retrieved sources included, requires covering per-send/stored permission.
  Records cite permission, governing wording and recipients. Hosts distinguish
  default-setting authorization from dialog consent; both require exact coverage.
- Search-answer grants cover one answer: the reviewed query, then that question and passages to listed recipients. A person may explicitly include a prior question in the reviewed query; unrelated history stays excluded. Edited retry queries require fresh permission.
- Reusable grants bind verified recipient/mesh/thread/model/adapters/scope, persist before use,
  and revocation cancels affected attempts/reuse. Grants authorize no contribution/supply/evaluation/adoption.
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
