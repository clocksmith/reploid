# CATSCAN: Model Partition Coordination

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target

Coordinate a conversation's generation across Doppler-defined model partitions.

## Authority

Owns attempts, ordering and placement. Doppler owns weight dependencies, original
layer positions, generation state, execution and stopping. Hosts verify grants
and own resident sessions. Discovery grants no authority.

## Scope

This subtree. It is not a second inference engine or conversation owner.

## Contracts

Inputs: Doppler plan/codecs, identified executors, verifying authorization,
bounded transport, allocation limits and grants.
Outputs: deltas, tokens, step costs and settlement.
Every token traverses both partitions; B returns one selected token to A.

## Invariants

- Missing authorization fails before work. Hosts verify recipients, scope,
  expiration, revocation and budgets, not just grant names.
- Bind model, plan, thread, attempt, participants and token position at boundaries.
- No invented continuation. New attempts require new identities. Receiver
  duplicates must not advance state twice.
- Per-thread cancellation settles both owned attempts, not shared model weights.
- Threads share FIFO token leases.
- No runtime downloads, imports of Doppler, or connections at module import.
- Injected computation tests do not prove GPU execution or distributed residency.

## Acceptance

Evidence: [partition tests](../../../../../tests/unit/partition-runner.test.js).
Milestone: partial loading, binary WebRTC, chat integration, numerical parity and
real two-tab answers. Unit tests do not qualify execution. Physical cross-device
and capacity-pooling proof remain separate.

## Non-goals

Model math, new chat UI, fabricated inference, or whole-model execution on B
presented as a distributed generation loop.

## Freedom

Preserve the ownership and evidence boundaries above.

*Last updated: September 2026*
