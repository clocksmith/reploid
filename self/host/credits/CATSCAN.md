# CATSCAN: Browser Credits

Parent: [Runtime Host](../CATSCAN.md)

## Target

A browser signs in, sees its balance and journal, tops up and spends credits under its own standing limit.

## Authority
- Owns choosing the sign-in provider from the page server's published service, the local test sign-in port, this profile's registered participant identity, the account model and the spending decision.
- Excludes prices, outcomes, rewards, identity decisions, disclosure permissions and UI markup.

## Scope

This directory.

## Contracts

Inputs:
- `GET /v1/client` from the page's own server; the [earning client](../earning/CATSCAN.md); [Supabase sign-in](../supabase-sign-in.js).

Outputs:
- `openBrowserEarning` and `deferredEarning` in [browser.js](browser.js) for the product session and the Settings [credits panel](../../ui/pool-home/account-panel.js).

## Invariants
- Off unless the page's server publishes the service; failures leave the product unchanged.
- Supabase when offered; local test sign-in only on loopback pages.
- One persistent participant identity per profile registers the device; the swarm requests as it, so routes name the paying account.
- Quotes above the person's standing limit, or with none set, are declined before anything is sent.
- Checkout pages open only over https or the service's own origin.
- Provider sign-out ends the device's service session.
- Conversation text never travels.

## Acceptance
- Evidence: [composition](../../../tests/integration/earning-browser.test.js), [identity](../../../tests/unit/product-session-registered-identity.test.js), [deadline](../../../tests/unit/earning-first-output.test.js) and [panel](../../../tests/unit/account-panel.test.js) tests.
- Limits: live Supabase and Stripe, installed browsers and physical devices await acceptance.

## Non-goals
- Pricing, settlement, reward validation, product copy.

## Freedom
Preserve boundaries; pass acceptance.
