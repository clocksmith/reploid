# Poolday Reputation Ledger

Poolday reputation is event-sourced.
Reducers produce views, but direct score mutation is not the source of truth.

## Event Types

- `reputation_seed`
- `provider_advertised`
- `assignment_accepted`
- `commit_received`
- `reveal_received`
- `receipt_validated`
- `quorum_match`
- `quorum_mismatch`
- `canary_passed`
- `canary_failed`
- `challenge_passed`
- `challenge_failed`
- `requester_accepted`
- `requester_disputed`
- `timeout`
- `stale_assignment`
- `policy_violation`

## Reducer Rule

```text
reputation_v1(events) -> provider reputation view
```

The reducer must be:

- deterministic
- versioned
- idempotent under duplicate gossip
- stable under harmless event reordering
- able to quarantine repeated identity or policy failures

Reputation can be global, per-model, per-runtime bucket, or per-policy.
The active view must state which scope it uses.

## Hosted implementation

Hosted reputation mutations append category `reputation` events to `pool_events`, then rebuild the provider's `reputation_state` projection with `poolday.reputation.reducer.v1`. Accepted receipts, rejected receipts, timeouts, canary outcomes, and delayed challenge outcomes use this path. A provider with pre-event-source counters receives one `reputation_seed` migration event before its first new event. Reusing an event id is idempotent under replay.

`reputation_state` is a scheduler-facing projection, not the source of truth. Audit quarantine uses deterministic unresolved failure balances; it does not depend on Firestore query order or random event-id ordering.

*Last updated: June 2026*
