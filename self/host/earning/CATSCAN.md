# CATSCAN: Earning Client

Parent: [Runtime Host](../CATSCAN.md)

## Target

Connect browser and native hosts to the earning routes: spending around partition attempts and contributor claims.

## Authority
- Owns host sign-in through an injected provider port, device registration with its bound session, the durable outbox, quote acceptance around partition attempts and claim submission.
- Excludes prices, terms, outcomes, rewards, identity decisions, disclosure permissions and UI.

## Scope

This directory.

## Contracts

Inputs:
- An explicit `reploid.earning-client/v1` configuration; provider, storage, fetch and spending-decision ports; the host's participant identity.
- Route summaries, activity and failure codes of partition attempts; resident admission records; custody delivery records.

Outputs:
- Requests to the [earning routes](../../../server/earning-routes/CATSCAN.md).

## Invariants
- Off unless configured; no default service, provider or spending decision.
- Only the host's spending port accepts a quote; spending never adds disclosure review or replaces the stored remote permission.
- An attempt binds its exact route recipients after the conversation's disclosure check and before input leaves the device; a refused binding sends nothing.
- An explicit retry reuses its failed attempt's open acceptance; other sends get new quotes.
- Reports and claims are stored before sending, carry stable Idempotency-Keys and leave the outbox only on a definite answer.
- Conversation text never travels.

## Acceptance
- Evidence: [execution](../../../tests/integration/earning-execution.test.js) and [native wiring](../../../tests/unit/native-earning.test.js) tests.
- Limits: real providers, UI and installed hosts need separate acceptance.

## Non-goals
- Pricing, settlement decisions, reward validation, UI copy.

## Freedom
Preserve boundaries; pass acceptance.
