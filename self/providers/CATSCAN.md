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

## Acceptance
- The Doppler adapter preserves request, response, and failure boundaries.
- Evidence: [provider adapter tests](../../tests/unit/doppler-reploid-provider.test.js).

## Non-goals
- Certifying provider execution or converting model responses into accepted scientific evidence.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
