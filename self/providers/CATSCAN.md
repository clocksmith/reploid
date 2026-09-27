# CATSCAN: Model Providers

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Adapt named model providers into explicit runtime contracts with bounded identity, configuration, and failure semantics.

## Authority
- Owns provider adapters and translation between provider APIs and Reploid runtime contracts.
- Does not own model truth, provider honesty, scientific interpretation, or evidence admission.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Provider configuration through [doppler-reploid.js](doppler-reploid.js).
- Calls from the [agent core](../core/CATSCAN.md).

Outputs:
- Typed provider responses and explicit provider failures.

## Invariants
- Provider and model identity must remain attached to outputs.
- Authentication, quota, timeout, and transport errors cannot be collapsed into model results.
- Catalog adapter bytes are size/hash checked; Doppler owns compatibility and
  tensor identity. The pinned scoped API supplies actual adapter identity through
  generation evidence. A bounded configured readiness probe precedes advertising
  the adapter; streamed chat remains provisional until its evidence matches.
- Adapter removal and conversation reset complete within the resident lease.
  Failed cleanup retires the session; base-model requests never inherit an adapter.

## Acceptance
- The Doppler adapter preserves request, response, and failure boundaries.
- Evidence: [provider adapter tests](../../tests/unit/doppler-reploid-provider.test.js).
- Resident isolation: [resident tests](../../tests/unit/work-resident-provider.test.js),
  [catalog acquisition tests](../../tests/unit/work-adapter.test.js).

## Non-goals
- Certifying provider execution or converting model responses into accepted scientific evidence.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
