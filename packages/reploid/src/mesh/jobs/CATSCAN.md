# CATSCAN: Complete Peer Jobs

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target
Provide reusable complete peer jobs with explicit host ports and bounded lifecycle.

## Authority
Owns bounded request, provider, cancellation, replay and episode verification algorithms. The host supplies pinned operation contracts, policy, consent, model admission and execution ports. Transport delivery is bounded at-least-once.

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
Evidence: [contract tests](../../../../../tests/e2e/peer-pack-jobs.spec.js).
Run tests/unit/pool-peer-pack-job.test.js, tests/e2e/peer-pack-jobs.spec.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
