# CATSCAN: Verification Evidence

Parent: [Reploid](../CATSCAN.md)

## Target

Produce reproducible evidence about declared behavior, boundaries, regressions, and failure handling.

## Authority
- Owns test harnesses, fixtures, assertions, and test-only support code.
- Does not own product intent, production behavior, deployment status, or claims beyond the exercised conditions.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Component acceptance contracts from the applicable CATSCAN chain.
- Executable code and fixtures under test.

Outputs:
- Test results that identify the exact exercised contract and environment.

## Invariants
- Tests must not pass by weakening the intended assertion or silently skipping the failing boundary.
- Mocks, forecasts, local runs, browser runs, and production observations remain distinguishable.
- A passing test proves only its declared conditions.

## Acceptance
- The CATSCAN validator detects malformed authority graphs and validates the real repository graph.
- Evidence: [CATSCAN tests](unit/catscan.test.js), [public evidence](unit/pool-public-protein-evidence.test.js), [campaign](unit/pool-protein-uncertainty-campaign.test.js), [north star](unit/pool-adjudication-experiment.test.js), [action](unit/pool-discovery-candidate-action.test.js), [replay](unit/pool-discovery-contract.test.js), [promotion](unit/pool-scientific-policy-promotion.test.js), [realized value](unit/pool-realized-action-value.test.js), and the [room journey](e2e/pool-evidence-journey.spec.js).
- Visual change evidence: [Visual Change Passport integration](integration/visual-change-passport.test.js) and the physical-browser [dogfood verifier](../scripts/verify-visual-change-passport-dogfood.js).

## Non-goals
- Defining intent from existing behavior or presenting test coverage as complete product validation.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
