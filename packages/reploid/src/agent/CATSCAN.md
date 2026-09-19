# CATSCAN: Agent Execution

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide reusable agent execution with explicit host ports and bounded lifecycle.

## Authority
Owns the execution engine: turn scheduling, provider invocation and fallback, cancellation and settlement, authorization on every tool attempt, bounded batch and follow-up execution, retry timers, operational events, response interpretation and detached checkpoints. Lab and task strategies supply context, planning and optional cognition; adapters cannot introduce another execution loop.

## Scope
This directory and unchartered descendants.

## Contracts
Inputs: immutable policy and explicit host ports.
Outputs: bounded operations, state, failures and retained evidence.

Compatibility entries `runtime.js` and `legacy-loop.js` only forward exports. `task-strategy.js` and `lab-strategy.js` provide context, plans, optional cognition and presentation; all execution goes through `engine.js`. The lab tool formatter runs single attempts; the engine owns retries and retains timed-out borrowed work until settlement.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/agent-lifecycle.test.js).
Run tests/integration/agent-surface-contract.test.js, tests/unit/execution-engine.test.js, tests/integration/agent-loop.test.js, tests/unit/self-runtime.test.js, tests/unit/agent-lifecycle.test.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
