# CATSCAN: Hosted Zero Function

Parent: [Reploid](../CATSCAN.md)

## Target

Expose the bounded Gemini-backed Zero function with explicit authentication, App Check, input, quota, and failure contracts.

## Authority
- Owns the deployed function handler and its server-side request boundary.
- Does not own Zero objectives, browser runtime state, X evaluation, or Poolday evidence.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Function dependencies from [package.json](package.json).
- Requests handled by [index.js](index.js).

Outputs:
- Authenticated bounded responses or explicit failures from [index.js](index.js).

## Invariants
- Authentication, App Check, rate limits, and payload validation fail closed.
- Provider errors cannot be represented as successful Zero results.
- The function cannot widen the calling surface's authority.

## Acceptance
- Function requests enforce their authentication, validation, and response contracts.
- Evidence: [Zero Gemini function tests](../tests/unit/zero-gemini-function.test.js).

## Non-goals
- Acting as a general model proxy or as evidence that Zero improved itself.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
