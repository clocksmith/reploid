# CATSCAN: Runtime Infrastructure

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Supply auditable lifecycle, dependency, policy, recovery, telemetry, and human-approval services to browser components.

## Authority
- Owns shared event, audit, dependency-injection, replay, recovery, telemetry, and approval mechanisms.
- Does not own domain decisions, scientific acceptance, or candidate promotion criteria.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Runtime events through [event-bus.js](event-bus.js).
- Policy decisions through [policy-engine.js](policy-engine.js).

Outputs:
- Append-only audit material through [audit-logger.js](audit-logger.js).
- Recovery checkpoints through [genesis-snapshot.js](genesis-snapshot.js).
- Bounded atomic attempt claims and signed response storage through [pack-job-storage.js](pack-job-storage.js).

## Invariants
- Audit, replay, and rollback records cannot silently rewrite the events they describe.
- Service failures remain observable and fail closed at governed boundaries.
- Poolday owns job admission and response verification; storage cannot authorize execution.

## Acceptance
- Event, audit, and snapshot lifecycle behavior passes focused tests.
- [Native job recovery tests](../../tests/e2e/peer-pack-jobs.spec.js) verify restart, writer fencing, cancellation, corruption, and bounds.
- Evidence: [event-bus tests](../../tests/unit/event-bus.test.js), [audit tests](../../tests/unit/audit-logger.test.js), and [genesis snapshot tests](../../tests/integration/genesis-snapshot.test.js).

## Non-goals
- Interpreting operational telemetry as proof of scientific or algorithmic improvement.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
