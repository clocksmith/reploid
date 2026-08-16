# CATSCAN: Poolday Evidence Runtime

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Govern public-protein adjudication evidence.

## Authority
- Owns Poolday evidence admission.
- Excludes truth, relays, RSI, private sequences.

## Scope

- This tree.

## Contracts

Inputs:
- Product boundaries from [Poolday product intent](../../docs/poolday/product-intent.md).
- Runtime policy from [pool-config.json](pool-config.json).

Outputs:
- Receipts: [inference-receipt.js](inference-receipt.js). State: [research-cycle.js](research-cycle.js).
- Checkpoints: [discovery-contract.js](discovery-contract.js). Actions: [discovery-candidate-action.js](discovery-candidate-action.js).
- Records: [evidence-network.js](evidence-network.js). Campaign: [protein-uncertainty-campaign.js](protein-uncertainty-campaign.js). North star: [adjudication-north-star.js](adjudication-north-star.js). Promotion: [scientific-policy-promotion.js](scientific-policy-promotion.js). Value: [realized-action-value.js](realized-action-value.js).

## Invariants
- Receipts prove only their signed record and identities.
- Archive and decision memory remain distinct.
- Agreement and context matches never prove truth or relevance; reuse requires local review.
- Declared source duplicates count once; only accepted corrections or authorized revocations supersede.
- Candidate actions stay outside memory and authorize nothing.
- Numeric uncertainty needs a versioned method and cohort; metrics remain a vector.
- Imports bind provenance; orders bind execution and public scope; labs bind capability and safety; policies bind resolution. None proves truth.
- Campaign order counts disagreement, not volume or biological priority.
- Zero proposes, X evaluates frozen cohorts, and Poolday admits; promotion authorities remain distinct.
- Realized value requires approved actions, reviewed outcomes, evaluation, causal records, and independent acceptance.

## Acceptance
- Model, evidence, cycle, action, replay, adjudication, promotion, and value contracts pass.
- Evidence: [pool](../../tests/unit/pool-contract.test.js), [cycle](../../tests/unit/pool-research-cycle.test.js), [action](../../tests/unit/pool-discovery-candidate-action.test.js), [replay](../../tests/unit/pool-discovery-contract.test.js), [adjudication](../../tests/unit/pool-adjudication-experiment.test.js), [promotion](../../tests/unit/pool-scientific-policy-promotion.test.js), and [value](../../tests/unit/pool-realized-action-value.test.js) tests.

## Non-goals
- Maximizing inference, peers, or generic decentralized compute.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
