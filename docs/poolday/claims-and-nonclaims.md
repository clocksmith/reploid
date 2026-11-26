# Poolday Claims And Nonclaims

For what "Poolday" names, see the [glossary](../glossary.md#1-overview). This page
covers the coordinator and research lane on the specialist routes described in
this folder's [README](README.md); the coordinator journeys were retired on
2026-11-26.

The [public product contract](../product-specification.md) owns requirements;
[architecture](../open-mesh-architecture.md) owns participation and component
boundaries. The old [product-intent path](product-intent.md) preserves links.
This page does not set the roadmap or broaden qualification.

## Claim

The [claim index](../status/surface-claim-index.json) gives evidence by surface.
The [route table](../product-specification.md#5-contribution-and-execution)
distinguishes local solo support, a physically checked remote-solo case, and
unqualified local + peer and remote-only splits. Do not transfer a result
across routes, model versions, or deployments. [Wire visibility](../wire-visibility.md)
explains why transport encryption does not hide input from its executor.

The coordinator lane's configured claim string (`claim` in
[`shared/pool/pool-config.json`](../../shared/pool/pool-config.json)) is:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

It describes scoped mechanisms of the retired coordinator lane, not a set of
features qualified together in the current public service. The mechanisms are
defined where they are implemented:

- receipts, quorum, canaries, challenges, reputation, requester countersignatures
  and policy classes: [coordinator protocol](coordinator-protocol.md);
- signed public protein submissions, results and human claims:
  [protein sequence lane](biological-sequence-lane.md);
- Research Room records, accepted memory, checkpoints, candidate actions,
  laboratory claims, work orders, resolution policies, frozen experiments and
  promotion eligibility: [Discovery Contract](discovery-contract.md);
- the bounded evidence collection and retrieval direction:
  [receipt-backed retrieval](receipt-backed-retrieval.md).

Check the claim index and a route's receipts before calling any of them shipped.

## Nonclaims

Poolday does not provide:

- guaranteed honest browser execution
- trusted hardware attestation
- proof that browser JavaScript was not modified
- proof that a provider did not simulate a result
- proof that a GPU performed the computation
- trustless compute
- a managed vector database; the evidence collection compares only explicitly
  published embeddings made by the same exact model contract and dimensions
- model-generated biological meaning or diagnosis
- conversion of submitted human claims into model facts
- private-sequence protection in the public evidence collection
- proof that an action is maximally informative
- proof that the campaign disagreement score measures biological importance,
  truth, expected action value, or a complete public-protein registry
- proof of laboratory authorization, biosafety, instrument access, capacity, or
  demonstrated capability from a signed laboratory qualification claim
- allocation or execution authority from an accepted work order or laboratory
  claim
- proof of physical independence from declared-different execution-context
  hashes
- scientific acceptance, rejection, or closure from a frozen resolution policy
- biosafety, harmlessness, non-medical use, public-sample provenance, or lack of
  laboratory authority merely because a work order declares the permitted scope
- proof that the candidate-action heuristic is calibrated information gain or
  a calibrated probability that the decision will change
- proof that a projected next question is scientifically correct
- proof that the presence of a frozen campaign metric constitutes a measured
  gain before the paired evaluator publishes its raw-manifest-bound result
- proof that a signed north-star manifest is accurate, that declared
  independence is physical, or that a real-world cost improvement occurred
  before a complete independently accepted v3 evaluation exists
- autonomous authority to approve, allocate, execute, or promote a next action
- proof that a scientific conclusion is true or independently replicated
- proof that a signed Discovery Contract checkpoint closes a question,
  validates an annotation, or makes its projected state biologically true
- proof that a declared external license is accurate or permits a particular use
- proof that a declared ontology term is correct, semantically equivalent to a
  term in another namespace, or biologically valid for the bound residues
- proof that matching declared context text makes evidence scientifically
  relevant; contextual relevance remains an attributable reviewer judgment
- proof that a larger version string, newer timestamp, or duplicate import
  supersedes or independently corroborates an earlier source
- proof that Reploid has passed the first-market experiment merely because the
  experiment schema and projection exist
- proof that signing a blinded or not-available outcome declaration establishes
  that no human accessed, leaked, or inferred held-out outcomes
- proof of scientific-policy improvement or activation from the presence of
  candidate, cohort, evaluation, or promotion-eligibility schemas and tests
- proof of biological causality, global usefulness, or scientific closure from
  an accepted realized action-value record or its reward credit
- generalization from one passing catalog workflow or cohort to other catalogs,
  curator roles, protein families, or commercial adoption
- completeness beyond the explicitly reported bounded registry snapshot

A receipt proves that a provider key signed an assignment-bound artifact.
It does not prove untampered browser execution or hardware-attested GPU computation.
Distinct provider keys do not prove distinct people, devices, or organizations.

## Copy rule for the coordinator lane

Copy that describes the retired coordinator lane on its specialist routes may use
its mechanism terms: receipt-backed, audit-backed, deterministically comparable,
reputation-backed, challengeable, policy-controlled. These terms are not required
in current product copy, which follows the
[product specification](../product-specification.md).

No copy may imply hardware-backed or tamper-proof execution.

## Network-value rejection conditions

A network-value claim remains unsupported when:

- authorized peer delivery is less reliable or economical than ordinary
  mirrors and supplies no distinct availability value;
- more providers improve neither capacity, recovery, economics, result
  comparison, nor later selection;
- retained evidence does not change or improve later work;
- useful workloads cannot tolerate duplicated whole-model execution;
- participants will not contribute lawful artifact custody or bounded compute;
- the network requires claims of physical independence or honest hardware that
  its evidence cannot establish.

*Last updated: November 2026*
