# CATSCAN: Model Partition Coordination

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target

Coordinate partitioned conversations.

## Authority

Discovery observes capabilities/channels; placement selects; residents admit;
runners sequence attempts, grants and settlement. Doppler owns computation,
positions, generation and stopping. Hosts own sessions. Shared validators belong
in `partition-contract.js`; discovery, placement and reservations remain independent.

## Scope

Subtree.

## Contracts

Inputs: Doppler plans/codecs, authenticated executors, grants and resources.
Outputs: tokens, costs and settlement.
Legacy traverses A/B. Ordered routes traverse all stages; only the last samples.
Geometry determines stage count; attempts retain replicas.
Session: [resident integration contract](../../../../../docs/chat-mvp.md#resident-integration-contract).

## Invariants

- Authorization precedes work; verify recipients, scope, expiration, revocation and budgets.
- Bind model, plan, thread, attempt, participants and token position.
- Discovery grants no authority; advertise capacity, never conversation identities.
- Signed reservations are authoritative. Release slots only after confirmed runtime cleanup.
- Bound receipts by attempt budgets; distinguish cleanup failure, channel-lost unknowns, settlement.
  Admission limits aren't physical-memory measurements.
- Busy replicas never move conversations. Recovery requires fresh identities
  unless Doppler supports continuation. Duplicates never advance state twice.
- Cancellation settles named attempts, preserving shared weights and independent threads.
- FIFO execution leases share weights: legacy routes lease a token traversal;
  ordered routes lease each stage independently. Weightless requesters bind
  requester identity and placement generation.
- No import-time connections, downloads or Doppler imports.

## Acceptance

Evidence: [partition tests](../../../../../tests/unit/partition-api.test.js).
Physical evidence qualifies loading, WebRTC, answers, numerics; injected tests
prove neither execution nor residency.

## Non-goals

Math, UI, fabricated inference, disguised whole-model execution.

## Freedom

Preserve these boundaries.
