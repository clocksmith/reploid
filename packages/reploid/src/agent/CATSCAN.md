# CATSCAN: Agent Execution

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide reusable agent execution with explicit host ports and bounded lifecycle.

## Authority
Owns the common turn scheduler, cancellation and settlement, dispatch, response contracts and checkpoints. Lab and task strategies supply context, planning and optional cognition; adapters cannot introduce another execution loop.

## Scope
This directory and unchartered descendants.

## Contracts
Inputs: immutable policy and explicit host ports.
Outputs: bounded operations, state, failures and retained evidence.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/agent-lifecycle.test.js).
Run tests/integration/agent-loop.test.js, tests/unit/self-runtime.test.js, tests/unit/agent-lifecycle.test.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
