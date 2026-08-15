# CATSCAN: Evidence Status

Parent: [Documentation](../CATSCAN.md)

## Target

Record current, evidence-linked claim status without turning observations into strategy or stronger assertions.

## Authority
- Owns status registries, observation artifacts, support levels, blockers, and evidence references.
- Does not own product goals, implementation design, or promotion policy.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Claim entries in the [surface claim index](surface-claim-index.json).
- Test, runtime, browser, and deployment artifacts named by each entry.

Outputs:
- Machine-checkable current claim status in [surface-claim-index.json](surface-claim-index.json).

## Invariants
- Supported, partial, blocked, observed, forecast, and unverified states remain distinguishable.
- Missing or stale evidence cannot be presented as current proof.
- An observation is bounded to its recorded environment and artifact identities.

## Acceptance
- Every indexed claim has valid structure, evidence, and bounded language.
- Evidence: [surface claim index tests](../../tests/unit/surface-claim-index.test.js).

## Non-goals
- Choosing product direction or using documentation changes to repair failing behavior.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
