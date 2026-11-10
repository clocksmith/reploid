# CATSCAN: Fleet Service

Parent: [Hosted Services](../CATSCAN.md)

## Target
Enrolled computers serve exact models within owner preferences and measured
capacity, exchanging non-cash credits for acknowledged completed work.

## Authority
- Owns computer/provider associations, observations, placement, native reconciliation
  and non-cash credit admission/settlement. Membership comes from the operator's
  existing registry; no second machine inventory lives here.
- Uses existing participant signing and execution protocols.
- Excludes purchased balances, cash conversion, payouts, numerical qualification,
  cryptographic identity design and operating-system access policy.

## Scope
This directory.

## Contracts
Inputs: explicit enrollment, policies, preferences, measured envelopes and signed
execution evidence.

Outputs: durable balances, work records and placement decisions.

## Invariants
- Identity denotes enrollment, not hardware attestation.
- Permission, exact artifacts and resource limits precede ranking.
- Credit admission precedes disclosure/execution; completed work requires provider
  signatures and requester acknowledgment. Replays have one economic effect.
- Credits are non-cash and conserved. Explicit policy bounds debt and permits
  same-owner transfers. A requester's local partition share is unbilled.
- Unknown work stays pending; stopping does not prove GPU settlement.
- Busy providers retain work. Placement changes only at idle boundaries.
- Capacity observations and measured envelopes have separate expiry; envelopes
  bind the installed delivery. Physical performance and numerical qualification
  remain separate.

## Acceptance
Evidence: [credits](../../tests/unit/fleet-credits.test.js),
[placement](../../tests/unit/fleet-placement.test.js),
[requester/provider integration](../../tests/integration/fleet-service.test.js).
Physical runs qualify only their exercised runtime and devices.

## Non-goals
Trustless computation, anonymous debt, guaranteed speedups.

## Freedom
Preserve these boundaries and existing obligations.
