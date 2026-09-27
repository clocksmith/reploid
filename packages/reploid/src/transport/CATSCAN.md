# CATSCAN: Peer Transport

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide Poolday's WebRTC connections and authorized peer exchange.

## Authority
Owns bounded setup/delivery/recovery, not models/UI/evaluation/adoption. Legacy swarm and complete-job protocols remain distinct.

## Scope
Subtree.

## Contracts
Inputs: immutable policy and host ports. `getRtcConfig` supplies authorized ICE
configuration; transport never issues/persists credentials.
Outputs: bounded operations and evidence.
Partition channels transfer binary requests and bounded JSON replies through
required host authorization. Receipt/cancellation does not establish GPU settlement.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.
- Discovery joins only after matching acknowledgement; peer counts require open channels. Disconnect cancels joins and reconnects.
- WebRTC-only callers never silently fall back to BroadcastChannel.
- Reconnection honors trusted host retry deadlines; disconnect cancels that wait.
- Custody uses a bounded reliable ordered auxiliary channel, granting no permissions.
  Reject unknown labels and channels arriving after disconnect.
- Storage shards, complete requests, partition tensors/continuation state and agent subtask messages retain distinct payload contracts. Transfers do not authorize execution or prove partition compatibility.
- Candidate transfers bind endpoints, room, contract, bytes and expiry. Retried delivery is bounded at-least-once; acknowledgements establish retained preview only.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/p2p-transport-lifecycle.test.js).
Run tests/e2e/peer-pack-jobs.spec.js and tests/unit/partition-data-channel.test.js.
Account for bytes, retries, cancellation and peer loss.

## Non-goals
Catalogs, credentials, UI, scientific truth or deployment claims.

## Freedom
Preserve boundaries and acceptance.

*Last updated: September 2026*
