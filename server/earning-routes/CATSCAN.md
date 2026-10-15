# CATSCAN: Earning Routes

Parent: [Hosted Services](../CATSCAN.md)

## Target

Authenticated HTTP access to accounts, devices, quotes, reservations, balances, reward claims and operator funding, settlement and link records.

## Authority
- Owns route authentication and authorization, body bounds, rate limits, Idempotency-Key transport, refusal statuses and the off-by-default mount.
- Excludes identity, balances, prices, reward validation, funding decisions and who holds operator credentials.

## Scope

- This directory.

## Contracts

Inputs:
- Operations of [accounts](../accounts/CATSCAN.md), the [ledger](../ledger/CATSCAN.md), [rewards](../rewards/CATSCAN.md) and [Community Access](../community-access/CATSCAN.md); explicit limits; quote-terms and operator-authority ports.

Outputs:
- `/v1` routes from [router.js](router.js), mounted by [mount.js](mount.js) when `REPLOID_EARNING_ROUTES=enabled`.

## Invariants
- Account and device come from the session; operator actors from the credential; neither from a body.
- Spending, attempt binding, claims and delivery evidence need a session bound to an active device.
- Clients never author quote terms.
- Unauthenticated bodies are never parsed; bodies parsed upstream are refused.
- No local-development or loopback bypass; never mounted under `/pool`.
- Production refuses missing or test-only sign-in providers and memory stores.

## Acceptance
- Evidence: [HTTP route tests](../../tests/integration/earning-routes.test.js) over memory and Firestore stores.
- Limits: real sign-in, payment and search providers, shared rate limiting and installed hosts need their own acceptance.

## Non-goals
- UI, real providers, credential issuance or pricing.

## Freedom
Preserve these boundaries and pass acceptance.
