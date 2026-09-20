# CATSCAN: Peer Transport

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Provide reusable peer transport with explicit host ports and bounded lifecycle.

## Authority
Owns bounded transport setup, delivery and recovery. Has no model, domain, UI, evaluation or adoption authority. Legacy swarm and complete-job assignment protocols remain distinct.

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
- Candidate transfers bind endpoints, room, contract, bytes and expiry. Retried delivery is bounded at-least-once; acknowledgements establish retained preview only.

## Acceptance
Evidence: [contract tests](../../../../tests/unit/p2p-transport-lifecycle.test.js).
Run tests/unit/p2p-transport-lifecycle.test.js, tests/e2e/peer-pack-jobs.spec.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
