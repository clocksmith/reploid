# CATSCAN: Model Partition Coordination

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target

Coordinate Doppler-partitioned conversations.

## Authority

Discovery owns expiring capability snapshots and control channels. Placement
selects from snapshots. Residents own admission across channels. Runners own
attempts, grants, sequencing and settlement. Doppler owns dependencies, layer
positions, computation, generation state and stopping. Hosts own sessions.

## Scope

Subtree.

## Contracts

Inputs: Doppler plans/codecs, authenticated executors, grants and bounded resources.
Outputs: deltas, tokens, costs and settlement receipts.
Every token traverses both partitions; B returns one selected token.
Session: [Doppler handoff](../../../../../docs/doppler-partition-handoff.md).

## Invariants

- Authorization precedes work; verify recipients, scope, expiration, revocation and budgets.
- Bind model, plan, thread, attempt, participants and token position.
- Discovery grants no authority; advertise capacity counts, never conversation identities.
- Signed reservations are authoritative. Release slots only after confirmed runtime cleanup.
- Bound receipts by attempt budgets; distinguish cleanup failure from settlement.
  Admission limits are not physical-memory measurements.
- Busy replicas never move existing conversations. Recovery requires fresh identities
  unless Doppler supports continuation. Duplicates never advance state twice.
- Cancellation settles the named attempts, preserving shared weights and independent threads.
- FIFO token leases share weights. Weightless requesters bind requester identity and placement generation.
- No import-time connections, downloads or Doppler imports.

## Acceptance

Evidence: [partition tests](../../../../../tests/unit/partition-api.test.js).
Physical-device evidence qualifies selective loading, WebRTC, complete
answers and numerical agreement; injected tests prove neither execution nor residency.

## Non-goals

Model math, new UI, fabricated inference or whole-model execution disguised as partitioning.

## Freedom

Preserve these boundaries.
