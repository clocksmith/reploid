# CATSCAN: Peer Transport

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide authorized WebRTC exchange.

## Authority
Owns bounded setup/delivery/recovery, not models/UI/evaluation/adoption. Legacy swarm and complete-job protocols remain distinct.

## Scope
Subtree.

## Contracts
Inputs: immutable policy/ports; `getRtcConfig` supplies ICE. Never issue/persist credentials.
Outputs: bounded delivery evidence.
Partitions pipeline authorized requests/bounded replies under receiver credit; receipt/cancellation proves no GPU settlement.

## Invariants
- Introduction availability is separate from established direct channel liveness.
- Introductions authenticate contacts, encrypt negotiation and bound separately authorized forwarding.
- Replaceable bootstrap ports grant no admission/compute/disclosure. Qualify WebRTC Direct separately.
- Imports are inert, application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.
- Discovery joins only after matching acknowledgement; peer counts require open channels. Disconnect cancels joins and reconnects.
- WebRTC-only callers never silently fall back to BroadcastChannel.
- Reconnection honors trusted host retry deadlines; disconnect cancels that wait.
- Custody/partitions/training use separate reliable ordered channels; framing grants no execution. Reject unknown/post-disconnect channels.
- Shards, jobs, tensors/continuations and subtasks retain distinct contracts. Transfers authorize no execution/compatibility.
- Candidate transfers bind endpoints, room, contract, bytes and expiry. Retried delivery is bounded at-least-once; acknowledgements establish retained preview only.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/p2p-transport-lifecycle.test.js).
Run tests/e2e/peer-pack-jobs.spec.js and tests/unit/partition-data-channel.test.js.
Account for bytes, retries, cancellation and peer loss.

## Non-goals
Catalogs, credentials, UI, scientific truth or deployment claims.

## Freedom
Preserve contracts.

*Last updated: October 2026*
