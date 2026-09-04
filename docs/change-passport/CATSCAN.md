# CATSCAN: Change Passport Documentation

Parent: [Documentation](../CATSCAN.md)

## Target

Preserve Change Passport as an inactive commercial alternative with independent
workflow, evidence, and decision-state contracts.

## Authority

- Owns Change Passport product intent, implementation sequencing, contract
  boundaries, and proof requirements.
- Does not activate changes, grant Poolday authority, prove objective
  correctness, or turn planned work into implemented behavior.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Repository strategy from [GOALS.md](../../GOALS.md).
- Internal causal evidence mechanics from [RSI improvement episodes](../rsi-improvement-episodes.md).

Outputs:
- The alternative workflow in [product intent](product-intent.md).
- Ordered repository deltas and gates in the [implementation plan](implementation-plan.md).
- The external comparison boundary in the [pilot charter](pilot-charter.md)
  and machine-readable [pilot manifest](pilot-manifest.json).
- Deployment configuration and custody boundaries in the
  [runtime contract](runtime-contract.md).

## Invariants

- Evidence validity, decision state, and deployed effect state remain separate.
- Automatic reopening does not imply automatic revocation or rollback.
- External actions require policy-owned authority.
- Poolday owns peer execution and evidence admission, not generic change control.
- Documentation status distinguishes planned, implemented, tested, live, and
  externally validated behavior.

## Acceptance

- The documents remain linked from the documentation index and goals.
- Every implementation milestone names code owners, tests, and live evidence.
- Evidence: [CATSCAN tests](../../tests/unit/catscan.test.js).
- Pilot freeze evidence: [pilot gate tests](../../tests/unit/change-passport-pilot.test.js).

## Non-goals

- Replacing implementation with prose or exposing internal Zero and X surfaces
  as customer dependencies.

## Freedom

Any implementation sequence is permitted if it preserves these boundaries and
passes the declared milestone gates.
