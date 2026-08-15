# CATSCAN: Optional Capabilities

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Package optional optimization, reflection, memory, and swarm behaviors behind explicit runtime and verification boundaries.

## Authority
- Owns capability-specific implementations and their internal state.
- Does not own core safety gates, surface authority, or promotion decisions.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Capability loading rules documented in the [capabilities README](README.md).
- Core execution services from the [agent core](../core/CATSCAN.md).

Outputs:
- Optional behaviors consumable by declared surface profiles.

## Invariants
- Loading a capability cannot broaden its caller's authority.
- Fitness, reflection, and optimization records remain evidence inputs rather than self-validating proof.

## Acceptance
- Optimization engines preserve their declared contracts and gates.
- Evidence: [GEPA engine tests](../../tests/unit/gepa-engines.test.js) and [optimizer tests](../../tests/unit/doppler-optimizer.test.js).

## Non-goals
- Making every capability part of the Research Room or claiming autonomous self-improvement.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
