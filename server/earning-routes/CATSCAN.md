# CATSCAN: Earning Routes

Parent: [Hosted Services](../CATSCAN.md)

## Target

Authenticated HTTP for accounts, devices, quotes, reservations, reports, balances, offers, claims, top-ups, payment notifications and operator funding, settlement and links.

## Authority
- Owns route authentication/authorization, body bounds, rate limits, Idempotency-Key bindings, refusal statuses, the off-by-default mount.
- Excludes identity, balances, prices, outcomes, reward validation, funding decisions, operator credential holders.

## Scope

- This directory.

## Contracts

Inputs:
- Operations of [accounts](../accounts/CATSCAN.md), [ledger](../ledger/CATSCAN.md), [rewards](../rewards/CATSCAN.md), [payments](../payments/CATSCAN.md) and [Community Access](../community-access/CATSCAN.md); explicit limits; quote-terms and operator-authority ports.

Outputs:
- `/v1` routes from [router.js](router.js), [session-routes.js](session-routes.js) and [provider-routes.js](provider-routes.js); [mount.js](mount.js) mounts them when `REPLOID_EARNING_ROUTES=enabled`.

## Invariants
- Account and device come from the session, operator actors from the credential, neither from bodies.
- Spending, attempts, reports, claims and delivery evidence need an active device's session; attempts bind and report only from the accepting device.
- Clients never author quote, offer or checkout terms, outcomes or route summaries.
- An Idempotency-Key binds route, caller and canonical request; a different request conflicts. Only definite no-effect failures free it; ambiguous ones reconcile under the same component key.
- Unauthenticated bodies are never parsed; upstream-parsed ones are refused.
- No local-development or loopback bypass; never mounted under `/pool`.
- Production refuses missing or test-only sign-in, test-only payments, memory stores.

## Acceptance
- Evidence: [route](../../tests/integration/earning-routes.test.js), [execution](../../tests/integration/earning-execution.test.js), [provider](../../tests/integration/provider-routes.test.js) and [composition](../../tests/integration/earning-composition.test.js) tests on memory and Firestore.
- Limits: live providers, shared rate limiting, installed hosts await acceptance.

## Non-goals
- UI, provider adapters, credential issuance, pricing.

## Freedom
Preserve boundaries; pass acceptance.
