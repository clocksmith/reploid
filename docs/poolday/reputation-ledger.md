# Poolday Reputation Ledger

Poolday reputation is event-sourced.
Reducers produce views, but direct score mutation is not the source of truth.

## Event Types

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

*Last updated: June 2026*
