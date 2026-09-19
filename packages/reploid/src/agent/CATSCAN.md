# CATSCAN: Agent Execution

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide reusable agent execution with explicit host ports and bounded lifecycle.

## Authority
Owns shared turn scheduling, provider fallback, cancellation, settlement, tool authorization, bounded batches, retries, events, response interpretation and checkpoints. Strategies supply context and plans; adapters cannot introduce another execution loop.

## Scope
This directory and unchartered descendants.

## Contracts
Inputs: immutable policy and explicit host ports.
Outputs: bounded operations, state, failures and retained evidence.

Compatibility entries `runtime.js` and `legacy-loop.js` forward exports. Task and lab strategies use `engine.js`. Lab tool formatting runs single attempts; the engine owns retries and retains timed-out borrowed work until settlement.

The optional `reploid/diagnostics` entry owns finite belief updates and diagnostic
planning. `diagnostic-strategy.js` supplies plans to the same execution engine.
Hosts supply likelihood provenance, normalized costs, tools and authorization;
the strategy cannot certify calibration, peer independence, or a successful repair.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.
- Diagnostic preferences never modify likelihoods. Only completed host observations
  update beliefs. Information gain and decision value remain separately inspectable.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/agent-lifecycle.test.js).
Run tests/integration/agent-surface-contract.test.js, tests/unit/execution-engine.test.js, tests/integration/agent-loop.test.js, tests/unit/self-runtime.test.js, tests/unit/agent-lifecycle.test.js from the repository root.
Diagnostic evidence: tests/unit/belief-planner.test.js,
tests/integration/diagnostic-strategy.test.js, tests/e2e/diagnostic-strategy.spec.js,
and the synthetic comparison in tests/diagnostic-planning-comparison.js.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
