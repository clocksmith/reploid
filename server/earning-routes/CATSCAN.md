# CATSCAN: Earning Routes

Parent: [Hosted Services](../CATSCAN.md)

## Target

Authenticated HTTP for accounts, devices, quotes, reservations, attempt reports, balances, reward claims and operator funding, settlement and links.

## Authority
- Owns route authentication/authorization, body bounds, rate limits, Idempotency-Key bindings, refusal statuses, the off-by-default mount.
- Excludes identity, balances, prices, outcomes, reward validation, funding decisions, operator credential holders.

## Scope

- This directory.

## Contracts

Inputs:
- Operations of [accounts](../accounts/CATSCAN.md), the [ledger](../ledger/CATSCAN.md), [rewards](../rewards/CATSCAN.md) and [Community Access](../community-access/CATSCAN.md); explicit limits; quote-terms and operator-authority ports.

Outputs:
- `/v1` routes from [router.js](router.js), mounted by [mount.js](mount.js) when `REPLOID_EARNING_ROUTES=enabled`.

## Invariants
- Account and device come from the session, operator actors from the credential, neither from bodies.
- Spending, attempts, reports, claims and delivery evidence need an active device's session; attempts bind and report only from the accepting device.
- Clients never author quote terms, outcomes or claimed route summaries.
- An Idempotency-Key binds route, caller and canonical request; a different request conflicts, even in progress; callers share no results. Only definite no-effect failures free it; ambiguous ones reconcile under the same component key.
- Unauthenticated bodies are never parsed; upstream-parsed ones are refused.
- No local-development or loopback bypass; never mounted under `/pool`.
- Production refuses missing/test-only sign-in providers and memory stores.

## Acceptance
- Evidence: [route](../../tests/integration/earning-routes.test.js) and [execution](../../tests/integration/earning-execution.test.js) tests on memory and Firestore.
- Limits: real sign-in, payment and search providers, shared rate limiting and installed hosts need separate acceptance.

## Non-goals
- UI, real providers, credential issuance, pricing.

## Freedom
Preserve boundaries; pass acceptance.
