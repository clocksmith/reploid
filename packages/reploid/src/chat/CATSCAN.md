# CATSCAN: Conversation Workspace

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Concurrent conversations from authorized peers, without a global objective.

## Authority
Owns history, membership, thread permissions, attempts, streams and fair scheduling.
Hosts supply authenticated identities, persistence, admission, disclosure and Doppler sessions.

## Scope
This directory.

## Contracts
Inputs: explicit policy, model identities and host ports.
Outputs: isolated conversations, bounded attempts and provenance-bound observations.
Compose existing custody and whole-request jobs; file possession grants no execution.

## Invariants
- Thread selection/closure never cancels execution; cancellation affects one attempt.
- Stream updates bind thread/attempt. Retries create new attempts, never append to old generations.
- Restore history and mark unfinished attempts interrupted; never silently resend.
- Permissions precede placement. Model and adapter identity remain exact.
- Explicit reusable disclosure grants bind verified recipient, mesh, thread, model,
  adapters and scope. Persist before use; revocation cancels affected attempts and
  prevents reuse. Grants authorize no contribution, artifact supply, evaluation or adoption.
- Share bounded residency; reset conversation/adapter state between executions.
- Fairness uses host-authenticated participants, never requester-chosen thread IDs.
- Cancellation retains the device slot until execution and cleanup settle.
- Bind queue/load/execution/failure observations to unique attempts.
- Verified files, compatible adapters, whole requests and Doppler-defined splits remain distinct capabilities.

## Acceptance
Evidence: [workspace tests](../../../../tests/unit/chat-workspace.test.js),
[scheduler tests](../../../../tests/unit/chat-scheduler.test.js), [three tabs](../../../../tests/e2e/chat-three-tab.spec.js).
Initial integration uses isolated tabs: concurrent conversations, resumed file/adapter
exchange, refresh recovery and execution-peer loss. Physical-device qualification remains separate.

## Non-goals
Agent loops, model mathematics, transport reimplementation, admission or qualification by UI.

## Freedom
Preserve boundaries and acceptance.
