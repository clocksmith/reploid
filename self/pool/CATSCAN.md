# CATSCAN: Poolday Evidence Runtime

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Test model distribution, whole-job execution, and reviewed coordination separately;
optional public-protein adjudication.

## Authority
- Owns discovery, authorization, assignment, transport, recovery, accounting, admission.
- Doppler owns Pack signatures, final integrity, verified cache, execution.
- Excludes truth, relays, RSI, private sequences.

## Scope

- This tree.

## Contracts

Inputs:
- [Product intent](../../docs/poolday/product-intent.md).
- [Runtime policy](pool-config.json).

Outputs:
- Custody: [source](peer-pack-custody.js).
- [Receipts](inference-receipt.js), [state](research-cycle.js), [checkpoints](discovery-contract.js), [actions](discovery-candidate-action.js).
- [Records](evidence-network.js), [campaign](protein-uncertainty-campaign.js), [adjudication](adjudication-north-star.js), [promotion](scientific-policy-promotion.js), [value](realized-action-value.js).

## Invariants
- Receipts prove signed records/identities only.
- Adapters own input/output/comparison; networking is operation-independent.
- Private inputs default local; custody never authorizes execution.
- Archive and decision memory remain distinct.
- Agreement/context never prove truth/relevance; reuse requires review.
- Declared source duplicates count once; only accepted corrections or authorized revocations supersede.
- Candidate actions authorize nothing; remain outside memory.
- Numeric uncertainty requires versioned methods/cohorts; metrics remain vectors.
- Imports bind provenance; orders bind execution and public scope; labs bind capability and safety; policies bind resolution. None proves truth.
- Campaigns order disagreement, not volume or biological priority.
- Zero proposes, X evaluates frozen cohorts, and Poolday admits; promotion authorities remain distinct.
- Realized value requires approved actions, reviewed outcomes, evaluation, causal records, and independent acceptance.

## Acceptance
- Named tests pass.
- [Operation/extension tests](../../tests/unit/pool-pack-operation.test.js).
- Evidence: [custody](../../tests/unit/pool-peer-pack-custody.test.js), [pool](../../tests/unit/pool-contract.test.js), [cycle](../../tests/unit/pool-research-cycle.test.js), [action](../../tests/unit/pool-discovery-candidate-action.test.js), [replay](../../tests/unit/pool-discovery-contract.test.js), [adjudication](../../tests/unit/pool-adjudication-experiment.test.js), [promotion](../../tests/unit/pool-scientific-policy-promotion.test.js), and [value](../../tests/unit/pool-realized-action-value.test.js) tests.

## Non-goals
- Volume as improvement.
- Model splitting, hardware attestation, or private-sequence admission.

## Freedom
Any mechanism preserving boundaries and acceptance.
