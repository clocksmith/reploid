# CATSCAN: Artifact Custody

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target
Provide reusable artifact custody with explicit host ports and bounded lifecycle.

## Authority
Owns authorized chunk requests, integrity, checkpoints and artifact reconstruction. Custody does not grant execution or redistribution authority; Doppler verifies final Pack bytes.

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
Evidence: [contract tests](../../../../../tests/unit/pool-peer-pack-custody.test.js).
Run tests/unit/pool-peer-pack-custody.test.js, tests/e2e/peer-pack-custody.spec.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
