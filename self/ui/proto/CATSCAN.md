# CATSCAN: X Operator Workbench

Parent: [Browser Interfaces](../CATSCAN.md)

## Target

Let operators inspect, compare, quarantine, replay, and promote evaluated substrate candidates without crossing into product admission.

## Authority
- Owns X-facing candidate, telemetry, replay, worker, and VFS inspection controls.
- Does not own candidate generation, evaluator truth, or Poolday policy admission.

## Scope

- Includes this directory and unchartered descendants.

## Contracts

Inputs:
- Evaluation and runtime state projected through [index.js](index.js).
- Candidate comparison state from [optimization.js](optimization.js).

Outputs:
- Operator decisions and explicit requests to governed promotion mechanisms.

## Invariants
- Candidates cannot approve themselves or edit away evaluator evidence.
- Baseline, candidate, rejection, quarantine, and rollback states remain distinguishable.

## Acceptance
- Optimization views preserve candidate evidence and gated operator actions.
- Evidence: [optimization UI tests](../../../tests/unit/doppler-optimization-ui.test.js) and [safe-candidate journey](../../../tests/e2e/x-one-safe-candidate.spec.js).

## Non-goals
- Claiming causal self-improvement without frozen paired evaluation and independent authority.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
