# CATSCAN: Conversation Workspace

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Concurrent conversations supplied by an authorized peer mesh, without a global objective.

## Authority
Owns conversation history, membership, per-thread permissions, attempt identities,
stream projection and fair device scheduling. Hosts supply authenticated identities,
durable stores, admission, disclosure and Doppler sessions. No agent loop.

## Scope
This directory.

## Contracts
Inputs: explicit policy, model identities and host ports.
Outputs: isolated conversations, bounded attempts and provenance-bound observations.
Compose existing custody and whole-request jobs; file possession grants no execution.

## Invariants
- Selecting or closing a thread does not cancel execution; cancelling affects only its attempt.
- Every stream update binds thread and attempt. Retries create new attempts, never append to old generations.
- Restore history and mark unfinished attempts interrupted; never silently resend.
- Permissions precede placement. Model and adapter identity remain exact.
- Share bounded model residency across threads; reset conversation and adapter state between executions.
- Fairness uses host-authenticated participant identity, not requester-chosen thread IDs.
- Cancellation retains the device slot until execution and cleanup settle.
- Record queue, load, execution and failure observations with unique attempt identity.
- Verified files, compatible adapters, whole requests and Doppler-defined splits remain distinct capabilities.

## Acceptance
Evidence: [workspace tests](../../../../tests/unit/chat-workspace.test.js),
[scheduler tests](../../../../tests/unit/chat-scheduler.test.js), [three tabs](../../../../tests/e2e/chat-three-tab.spec.js).
Initial integration uses isolated tabs: concurrent conversations, resumed file/adapter
exchange, refresh recovery and execution-peer loss. Physical-device qualification remains separate.

## Non-goals
Model mathematics, transport reimplementation, admission or qualification by UI.

## Freedom
Preserve boundaries and acceptance.
