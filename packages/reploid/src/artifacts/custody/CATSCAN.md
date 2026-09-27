# CATSCAN: Artifact Custody

Parent: [Reploid Browser Library](../../../CATSCAN.md)

## Target
Exchange authorized model shards and retain useful pieces across network participants without redundant downloads where verified custody permits reuse.

## Authority
Owns authorized chunk requests, integrity, checkpoints and artifact reconstruction. Custody does not grant execution or redistribution authority; Doppler verifies final Pack bytes.

## Scope
This directory and unchartered descendants.

## Contracts
Inputs: immutable policy and explicit host ports.
Outputs: bounded operations, state, failures and retained evidence.
The exchange composition discovers bounded file inventories and binds per-file
v2 grants to the actual requester and supplier. Host ports pin expected file
identity and verify final bytes; inventory possession grants no redistribution.

## Invariants
- Imports are inert and application independent.
- Candidates cannot expand permissions or approve their own output.
- Cancellation does not claim termination of borrowed work.
- Preserve record identities and recovery compatibility.
- Storage shards do not establish computational partitions. Retention and redistribution remain bounded by participant grants; placement cannot infer execution permission from possession.
- Advertisements do not acquire bytes. Explicit offers bound supply budgets and
  simultaneous transfers. Dedicated byte channels reuse signed chunk custody and
  checkpoint validation. Stop revokes outstanding supply; close settles owned work.

## Acceptance
Evidence: [contract tests](../../../../../tests/unit/pool-peer-pack-custody.test.js).
Exchange composition: [exchange tests](../../../../../tests/unit/custody-exchange.test.js).
Run tests/unit/pool-peer-pack-custody.test.js, tests/e2e/peer-pack-custody.spec.js from the repository root.

## Non-goals
Application catalogs, credentials, product UI, scientific truth and deployment claims.

## Freedom
Preserve these boundaries and executable acceptance.
