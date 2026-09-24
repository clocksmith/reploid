# CATSCAN: Peer Transport

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide Poolday's WebRTC connections and authorized exchange among independently controlled network participants.

## Authority
Owns bounded transport setup, delivery and recovery. Has no model, domain, UI, evaluation or adoption authority. Legacy swarm and complete-job assignment protocols remain distinct.

## Scope
This directory and unchartered descendants.

## Contracts
Inputs: immutable policy and explicit host ports.
An optional asynchronous `getRtcConfig` host port supplies fresh authorized ICE
configuration for each negotiation; the transport neither issues nor persists credentials.
Outputs: bounded operations, state, failures and retained evidence.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.
- WebRTC discovery is joined only after matching acknowledgement; peer counts require open data channels. Manual disconnect cancels pending joins and reconnects.
- WebRTC-only callers never silently fall back to BroadcastChannel.
- Storage shards, complete requests, partition tensors/continuation state and agent subtask messages retain distinct payload contracts. Transfers do not authorize execution or prove partition compatibility.
- Candidate transfers bind endpoints, room, contract, bytes and expiry. Retried delivery is bounded at-least-once; acknowledgements establish retained preview only.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/p2p-transport-lifecycle.test.js).
Run tests/unit/p2p-transport-lifecycle.test.js, tests/e2e/peer-pack-jobs.spec.js. Account for transferred bytes, retries, cancellation and participant loss.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.

*Last updated: September 2026*
