# CATSCAN: Pool Evidence Records

Parent: [Poolday Evidence Runtime](../CATSCAN.md)

## Target

Implement signed research evidence behind its stable entries: normalization, records, verification, admission and queries.

## Authority
- Owns signed record construction, verification, link admission, accepted memory and read-only projections.
- The parent's `evidence-*.js` entries keep the public names; callers import entries or [the facade](../evidence-network.js), never these modules.
- Cannot grant disclosure, adoption, closure or execution.

## Scope

This directory.

## Contracts

Inputs: [record contract](../evidence-record-contract.js); [evidence policy](policy.json) for author roles, limits, thresholds and reward points.

Outputs: implementations re-exported by the parent's evidence entries.

## Invariants
- One owner per helper: [primitives](primitives.js) holds text, hash, list, ordering, consent and content-hash helpers.
- JSON owns policy; JavaScript orchestrates.
- Every record kind signs through [record signing](record-signing.js); record hashes exclude only the signature.
- Modules import the record contract and each other, never the entries or the facade; the graph stays acyclic.
- Verification is not review; records change projections only through admission.
- Record shapes, hashes, reasons and error messages stay stable when modules move.

## Acceptance
- Evidence: [facade](../../../../tests/unit/evidence-facade.test.js), [network](../../../../tests/unit/pool-evidence-network.test.js), [lifecycle](../../../../tests/unit/pool-research-lifecycle.test.js) pass.

## Non-goals
A second evidence store, biological truth, model arithmetic.

## Freedom
Any module split that preserves these boundaries and passes acceptance.
