# CATSCAN: Poolday Evidence Runtime

Parent: [Browser Runtime](../CATSCAN.md)

## Target

Distribute, execute, coordinate; adjudicate public-protein evidence.

## Authority
- Owns discovery/admission, assignment, recovery and accounting integration.
- Composes package transport/jobs/custody with host policy. Swarm stays distinct.
- Doppler owns Pack signatures/integrity, verified caching/execution.
- Excludes truth, relays, RSI, private delegation.

## Scope

- Subtree.

## Contracts

Inputs:
- [Product intent](../../docs/poolday/product-intent.md).
- [Runtime policy](pool-config.json).

Outputs:
- [Custody](peer-pack-custody.js), [local document retrieval](document-search.js).
- [Receipts](inference-receipt.js), [state](research-cycle.js), [checkpoints](discovery-contract.js), [actions](discovery-candidate-action.js).
- [Records](evidence-network.js), [campaign](protein-uncertainty-campaign.js), [adjudication](adjudication-north-star.js), [promotion](scientific-policy-promotion.js), [value](realized-action-value.js).
- Forecasts reuse [assignments](peer-assignment.js), signatures and requester acceptance.
  Applications own pins/semantics/review, not catalog admission.
- [Jobs](peer-pack-job.js), [acceptance](peer-pack-episode.js): pins, public consent, bounds.

## Invariants
- Receipts prove signed records/identities only.
- Adapters own input/output/comparison; networking is operation-independent.
- JSON owns policy; Doppler owns mathematics.
- Private inputs default local; custody never authorizes execution.
- Archive/decision memory remain distinct.
- Agreement/context never prove truth/relevance; reuse requires review.
- Declared-source duplicates count once; only accepted corrections/authorized revocations supersede.
- Candidate actions authorize nothing; remain outside memory.
- Numeric uncertainty requires versioned methods/cohorts; vector metrics.
- Provenance-bound imports: orders/public execution, labs/capability/safety, policies/resolution; never truth.
- Campaigns order disagreement, not volume or biological priority.
- Scientific-policy: Zero proposes; independent X evaluates frozen cohorts; Poolday separately admits.
- Value requires approved actions, reviewed outcomes, evaluation, causality, independent acceptance.

## Acceptance
- [Operations](../../tests/unit/pool-pack-operation.test.js), [jobs](../../tests/unit/pool-peer-pack-job.test.js), [WebRTC](../../tests/e2e/peer-pack-jobs.spec.js) pass.
- Evidence: [custody](../../tests/unit/pool-peer-pack-custody.test.js), [pool](../../tests/unit/pool-contract.test.js), [cycle](../../tests/unit/pool-research-cycle.test.js), [action](../../tests/unit/pool-discovery-candidate-action.test.js), [replay](../../tests/unit/pool-discovery-contract.test.js), [adjudication](../../tests/unit/pool-adjudication-experiment.test.js), [promotion](../../tests/unit/pool-scientific-policy-promotion.test.js), and [value](../../tests/unit/pool-realized-action-value.test.js) tests.

## Non-goals
- Volume as improvement.
- Arbitrary layer splitting, hardware attestation, private-sequence admission.

## Freedom
Preserve boundaries/acceptance.
