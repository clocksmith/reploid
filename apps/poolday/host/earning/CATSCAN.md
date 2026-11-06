# CATSCAN: Earning Client

Parent: [Product Host](../CATSCAN.md)

## Target
Connect browser/native hosts to earning routes: partition-attempt spending and contributor claims.

## Authority
- Owns sign-in through an injected provider port, session-bound device registration, durable outbox, partition quote acceptance, output acknowledgments, evidence and claim submission.
- Excludes prices, terms, outcomes, rewards, identity decisions, disclosure permissions and UI.

## Scope
This directory.

## Contracts
Inputs: explicit `reploid.earning-client/v1` config; provider/storage/fetch/spending-decision ports; host participant identity; partition route summaries, activity, receipts and failure codes; resident admissions; custody delivery records; whole-model claim references from countersigned execution receipts (resolved by the service to its own kept settlement, never contributor-authored charges).
Outputs: requests to [earning routes](../../../../server/earning-routes/CATSCAN.md).

## Invariants
- Off unless configured; no default service, provider or spending.
- Only the host spending port accepts quotes; spending adds no disclosure review nor replaces stored remote permission.
- Attempts bind exact route recipients after disclosure check and before input leaves the device; refused bindings send nothing.
- Acknowledge only outputs matching signed final-stage receipts.
- Explicit retries reuse their failed attempt's open acceptance; other sends get new quotes.
- Store reports, evidence and claims before sending with stable Idempotency-Keys; remove from outbox only on definite answers.
- Conversation text never travels.

## Acceptance
Evidence: [execution](../../../../tests/integration/earning-execution.test.js), [evidence](../../../../tests/integration/earning-evidence.test.js), [native wiring](../../../../tests/unit/native-earning.test.js). Real providers, UI and installed hosts qualify separately.

## Non-goals
Pricing, settlement decisions, reward validation, UI copy.

## Freedom
Preserve boundaries; pass acceptance.
