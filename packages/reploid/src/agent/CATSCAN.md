# CATSCAN: Agent Execution

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target

Pursue network objectives: divide work, select models, recruit complementary
participants, inspect results and revise approaches through bounded agents.

## Authority

Owns scheduling, provider fallback, cancellation, settlement, tool authorization,
batches, retries, events, response interpretation and checkpoints. Strategies
supply plans; adapters cannot introduce another execution loop.

## Scope

This directory and unchartered descendants.

## Contracts

Inputs: immutable policy and explicit host ports.
Outputs: bounded operations, state, failures and evidence.

Compatibility entries runtime.js and legacy-loop.js forward exports. Task, lab
and diagnostic strategies use engine.js. Lab formatting runs single attempts;
the engine owns retries and retains timed-out borrowed work until settlement.
Hosts supply diagnostic likelihood provenance, costs, tools and authorization.

## Invariants

- Imports are inert and application independent.
- Candidates cannot expand permissions or approve themselves.
- Cancellation does not prove borrowed-work termination.
- Preserve identities and recovery compatibility.
- Preferences cannot alter likelihoods. Completed observations update beliefs;
  retain uncertainty, dependencies and provenance.
- Decisions include benefit, communication and participant limits. Information
  gain, calibration and actual outcome improvement remain distinct.

## Acceptance

Evidence: [lifecycle tests](../../../../tests/unit/agent-lifecycle.test.js).
From repository root: tests/integration/agent-surface-contract.test.js,
tests/unit/execution-engine.test.js, tests/integration/agent-loop.test.js,
tests/unit/self-runtime.test.js, tests/unit/agent-lifecycle.test.js,
tests/unit/belief-planner.test.js, tests/integration/diagnostic-strategy.test.js,
tests/e2e/diagnostic-strategy.spec.js and tests/diagnostic-planning-comparison.js.
Synthetic comparisons do not prove network benefit or successful repair.

## Non-goals

Application catalogs, credentials, UI, scientific truth or deployment claims.

## Freedom

Preserve boundaries and executable acceptance.
