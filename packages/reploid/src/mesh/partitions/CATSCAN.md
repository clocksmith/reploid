# CATSCAN: Model Partition Coordination

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target

Coordinate partitioned conversations.

## Authority

Discovery observes capabilities/channels; placement selects; residents admit;
runners sequence attempts/grants/settlement. Doppler owns computation/positions/generation/stopping.
Hosts own sessions. `partition-contract.js` holds shared validators;
discovery/placement/reservations stay independent.

## Scope

Subtree.

## Contracts

Inputs: Doppler plans/codecs, authenticated executors, grants, resources.
Outputs: tokens, costs, settlement.
Legacy traverses A/B. Ordered routes traverse all stages; only the last samples.
Requester writers commit ordered steps before delivery, within their recorded window of computation.
Geometry determines stage count; attempts retain replicas.
Charged stages sign receipts, refusing steps beyond K unacknowledged outputs.
Session: [contract](../../../../../docs/chat-mvp.md#resident-integration-contract).

## Invariants

- Authorization precedes work; verify recipients/scope/expiration/revocation/budgets.
- Bind model/plan/thread/attempt/participants/token position.
- Discovery grants no authority; advertise capacity, never conversation identities.
- Hosts assign stages; opt-in [Launch 3](../../../../../docs/launch-3-orchestration.md) `auto`
  moves idle residents by contributor policy.
- Signed reservations are authoritative; slots release after confirmed cleanup.
- Bound receipts by attempt budgets; distinguish cleanup failure/channel-lost unknowns/settlement.
  Admission limits aren't memory measurements.
- Busy replicas never move conversations; recovery needs fresh identities absent
  Doppler continuation; duplicates never advance state.
- Cancellation settles named attempts, preserving weights/threads.
- FIFO leases share weights: legacy per traversal, ordered per stage.
  Weightless requesters bind identity/placement generation.
- Bound every stage call; deadlines precede grant expiry; envelopes refuse before disclosure.
- No import-time connections, downloads, Doppler imports.

## Acceptance

Evidence: [partition](../../../../../tests/unit/partition-api.test.js), [publication](../../../../../tests/unit/ordered-publication.test.js), [evidence](../../../../../tests/unit/ordered-attempt-evidence.test.js).
Physical evidence qualifies loading/WebRTC/answers/numerics; injected tests
prove neither execution nor residency.

## Non-goals

Math, UI, fabricated inference, disguised whole-model execution.

## Freedom

Preserve boundaries.
