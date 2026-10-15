# CATSCAN: Earning Client

Parent: [Runtime Host](../CATSCAN.md)

## Target

Connect browser and native hosts to the earning routes: spending around partition attempts and contributor claims.

## Authority
- Owns host sign-in through an injected provider port, device registration with its bound session, the durable outbox, quote acceptance around partition attempts, output acknowledgments, evidence and claim submission.
- Excludes prices, terms, outcomes, rewards, identity decisions, disclosure permissions and UI.

## Scope

This directory.

## Contracts

Inputs:
- An explicit `reploid.earning-client/v1` configuration; provider, storage, fetch, spending-decision ports; the host's participant identity.
- Route summaries, activity, receipts and failure codes of partition attempts; resident admission records; custody delivery records.

Outputs:
- Requests to the [earning routes](../../../server/earning-routes/CATSCAN.md).

## Invariants
- Off unless configured; no default service, provider or spending.
- Only the host's spending port accepts a quote; spending adds no disclosure review nor replaces the stored remote permission.
- An attempt binds its exact route recipients after the conversation's disclosure check and before input leaves the device; a refused binding sends nothing.
- Acknowledge only outputs matching signed final-stage receipts.
- Explicit retries reuse their failed attempt's open acceptance; other sends get new quotes.
- Reports, evidence and claims are stored before sending, carry stable Idempotency-Keys, leave the outbox only on definite answers.
- Conversation text never travels.

## Acceptance
- Evidence: [execution](../../../tests/integration/earning-execution.test.js), [evidence](../../../tests/integration/earning-evidence.test.js), [native wiring](../../../tests/unit/native-earning.test.js) tests.
- Limits: real providers, UI, installed hosts need separate acceptance.

## Non-goals
- Pricing, settlement decisions, reward validation, UI copy.

## Freedom
Preserve boundaries; pass acceptance.
