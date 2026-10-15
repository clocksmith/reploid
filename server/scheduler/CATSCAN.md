# CATSCAN: Durable Scheduler

Parent: [Hosted Services](../CATSCAN.md)

## Target

Due resume, expiry, challenge and probe work runs on an explicit schedule, once per item, across restarts and concurrent runners.

## Authority
- Owns job leases, pass records, schedule validation, contract obligation slots and the [operator entry point](operator.js).
- Excludes the operations it calls and their rules, intervals and batch sizes, hosting triggers, routes and device transport.

## Scope

- This directory.

## Contracts

Inputs:
- An explicit schedule: version, lease length, and per job an interval and batch limit.
- Resume and expiry operations of the [ledger](../ledger/CATSCAN.md), [rewards](../rewards/CATSCAN.md), [Community Access](../community-access/CATSCAN.md) and [payments](../payments/CATSCAN.md); reward challenge and probe operations; transport and acquirer ports.

Outputs:
- Operations in [store-contract.js](store-contract.js); pass records with items, counts, backlog and next due time; obligation slots.

## Invariants
- One runner holds a job's lease; an expired lease's running pass is recorded abandoned.
- Only the lease holder records completion; work re-derives from durable records, so repeats change nothing.
- Each pass stays within its batch limit.
- Sweeps expire only holds, allocations and queue entries, never balances.
- Each contract interval holds at most one obligation per configured kind, issued at a stored unpredictable time; a missed window is recorded, never dropped or charged.
- Probes settle on their own path.

## Acceptance
- Memory and Firestore stores pass identical scenarios.
- Evidence: [sweep](../../tests/unit/scheduler-sweeps.test.js) and [obligation](../../tests/unit/scheduler-obligations.test.js) tests.

## Non-goals
- Hosting, cron triggers, routes, device transport, intervals or funding returns.

## Freedom
Preserve boundaries; pass acceptance.
