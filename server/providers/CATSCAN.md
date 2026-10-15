# CATSCAN: Provider Adapters

Parent: [Hosted Services](../CATSCAN.md)

## Target

The owner's adopted providers behind existing ports: Supabase Auth email magic links and Stripe Checkout one-time top-ups.

## Authority
- Owns Supabase token and sign-in-state verification, Stripe requests, webhook signatures, status mapping and environment configuration.
- Excludes accounts, sessions, balances, reconciliation, prices, rates, taxes, terms, routes and credential custody.

## Scope

- This directory.

## Contracts

Inputs:
- The [sign-in contract](../accounts/sign-in.js), the [processor port](../payments/processor-contract.js), environment and secrets ([env.js](env.js)).

Outputs:
- [Supabase sign-in](supabase-sign-in.js) and [Stripe Checkout](stripe-processor.js) adapters.

## Invariants
- Keys come from environment or secret storage, never the repository.
- Accounts key on Supabase `sub`, never email.
- Tokens pass allowlisted asymmetric algorithms, JWKS signatures, issuer, audience, expiry and issued-at; each sign-in carries a fresh server-issued state inside the signed token, used once.
- Authentication time comes from `amr`, not a refreshed `iat`.
- Webhooks verify Stripe-Signature over the raw body within tolerance under any configured secret; events only name a session.
- Status comes from fetched sessions, payments, refunds and disputes: succeeded refunds and lost disputes reverse.
- Test and live modes use distinct variables, keys, processor ids and livemode checks.

## Acceptance
- Evidence: [Supabase](../../tests/unit/supabase-sign-in.test.js), [Stripe](../../tests/unit/stripe-processor.test.js) and [route](../../tests/integration/provider-routes.test.js) tests; [live smoke](../../tests/integration/provider-live-smoke.test.js) runs only with test-mode credentials.

## Non-goals
- Taxes, dispute representation, subscriptions, password or OAuth sign-in.

## Freedom
Preserve boundaries; pass acceptance.
