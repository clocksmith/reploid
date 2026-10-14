# CATSCAN: Model Partition Coordination

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target

Coordinate partitioned conversations.

## Authority

Discovery observes capabilities/channels; placement selects; residents admit;
runners sequence attempts/grants/settlement. Doppler owns computation/positions/generation/stopping.
Hosts own sessions. Shared validators live in `partition-contract.js`;
discovery/placement/reservations stay independent.

## Scope

Subtree.

## Contracts

Inputs: Doppler plans/codecs, authenticated executors, grants, resources.
Outputs: tokens, costs, settlement.
Legacy traverses A/B. Ordered routes traverse all stages; only the last samples.
Requester writers commit unsigned ordered steps before delivery or next steps.
Geometry determines stage count; attempts retain replicas.
Session: [contract](../../../../../docs/chat-mvp.md#resident-integration-contract).

## Invariants

- Authorization precedes work; verify recipients/scope/expiration/revocation/budgets.
- Bind model/plan/thread/attempt/participants/token position.
- Discovery grants no authority; advertise capacity, never conversation identities.
- Hosts assign stages; opt-in [Launch 3](../../../../../docs/launch-3-orchestration.md) `auto` lets that
  contributor's own policy choose from observed offers, moving only idle residents.
- Signed reservations are authoritative. Release slots only after confirmed runtime cleanup.
- Bound receipts by attempt budgets; distinguish cleanup failure/channel-lost unknowns/settlement.
  Admission limits aren't physical-memory measurements.
- Busy replicas never move conversations. Recovery requires fresh identities
  unless Doppler supports continuation. Duplicates never advance state twice.
- Cancellation settles named attempts, preserving shared weights/independent threads.
- FIFO execution leases share weights: legacy routes lease token traversals;
  ordered routes lease each stage. Weightless requesters bind requester
  identity/placement generation.
- No import-time connections, downloads or Doppler imports.

## Acceptance

Evidence: [partition](../../../../../tests/unit/partition-api.test.js), [publication](../../../../../tests/unit/ordered-publication.test.js).
Physical evidence qualifies loading/WebRTC/answers/numerics; injected tests
prove neither execution nor residency.

## Non-goals

Math, UI, fabricated inference, disguised whole-model execution.

## Freedom

Preserve these boundaries.
