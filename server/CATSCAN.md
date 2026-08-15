# CATSCAN: Hosted Services

Parent: [Reploid](../CATSCAN.md)

## Target

Provide bounded authentication, rendezvous, relay, proxy, and compatibility services without becoming authority for browser-local claims.

## Authority
- Owns hosted request handling, server-side validation, signaling, relay, and external-service adapters.
- Does not own claimed browser execution, exactly-once delivery, scientific validity, or Research Room decisions.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Requests accepted through [proxy.js](proxy.js) and [reploid-signaling.js](reploid-signaling.js).
- Public inference gates from [public-inference-guard.js](public-inference-guard.js).

Outputs:
- Authenticated, bounded server responses and delivery records.

## Invariants
- Relay acknowledgement proves receipt of that relay record, not final acceptance.
- Authentication and transport success cannot be represented as model or scientific validity.
- Hosted failures remain explicit.

## Acceptance
- Signaling and public-inference admission preserve their declared boundaries.
- Evidence: [signaling integration tests](../tests/integration/signaling-server.test.js) and [public inference admission tests](../tests/integration/public-inference-admission.test.js).

## Non-goals
- Operating a trustless compute marketplace or centralizing browser evidence authority.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
