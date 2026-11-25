# CATSCAN: Fleet Service

Parent: [Hosted Services](../CATSCAN.md)

## Target
Serve exact models within owner preferences and measured capacity; credit acknowledged output.

## Authority
- Owns computer/provider associations, observations, placement, native reconciliation
  and non-cash credit admission/settlement. Membership: operator registry or
  [confirmed pairings](../../docs/self-serve-credits.md).
- Excludes purchased balances, cash conversion, payouts, numerical qualification,
  cryptographic identity design and operating-system access policy.

## Scope
Subtree.

## Contracts
Inputs: explicit enrollment, policies, preferences, measured envelopes and signed
execution evidence.

Outputs: durable balances, statements, work records, placement decisions.

## Invariants
- Identity denotes enrollment (pairing: a confirmed fingerprint), not hardware attestation.
- Permission, exact artifacts and resource limits precede ranking.
- Credit admission precedes disclosure/execution; completed work requires provider
  signatures and requester acknowledgment. A cancelled run may settle its proven
  acknowledged prefix. Replays have one economic effect.
- Credits are non-cash and conserved. Explicit policy bounds debt and permits
  same-owner transfers. A requester's local partition share is unbilled.
- Fence admission before release; retain signed proof across restarts.
- Delegation requires pairing/TLS-or-loopback/origins (browser) or bearer/TLS/enrolled-recipient checks (HTTP); keys stay native.
- Split settlement replays from signed records alone.
- Unknown work stays pending; stopping does not prove GPU settlement.
- Busy providers retain work; placement changes at idle boundaries.
- Observations and measured envelopes expire separately; envelopes bind the
  installed delivery. Performance and numerical qualification stay separate.

## Acceptance
Evidence: [credits](../../tests/unit/fleet-credits.test.js),
[statements](../../tests/unit/credit-statement.test.js),
[settlement replay](../../tests/unit/settlement-replay.test.js),
[placement](../../tests/unit/fleet-placement.test.js),
[feed](../../tests/unit/fleet-notifier.test.js),
[integration](../../tests/integration/fleet-service.test.js).
Physical runs qualify exercised devices only.

## Non-goals
Trustless computation, anonymous debt, guaranteed speedups.

## Freedom
Preserve boundaries and obligations.
