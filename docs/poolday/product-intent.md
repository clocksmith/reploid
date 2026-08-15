# Poolday Product Intent

Poolday is the internal documentation name for the main Reploid product
surface. The public UI uses the Reploid name.

This document applies the repository mission in [`GOALS.md`](../../GOALS.md) to
Poolday's purpose and the authority boundary between Poolday, Zero, and X.
Exact enabled models, policies, trust
tiers, routes, and transport requirements remain owned by
[`pool-config.json`](../../self/pool/pool-config.json) and the
[browser inference contract](../browser-inference-pool.md).

## Product goal

Reploid's first product goal is to test whether a proof-carrying Research Room
improves adjudication of disputed family or domain annotations in a named
public protein catalog. The broader continuously improving protein-evidence
network remains a target hypothesis until that comparison succeeds. Reploid is
not a generic science platform, a distributed model demonstration, or a system
that mistakes authenticated execution for biological truth.

A researcher begins with an explicitly public protein sequence and a bounded
question. The target discovery object preserves:

1. Verified, independently reproducible model outputs.
2. Model-specific similarity and residue evidence.
3. Agreement, disagreement, and stated uncertainty across qualified evidence.
4. The most informative justified next computation, review, bounded mutation
   set, or experiment.
5. A durable record of what succeeded, failed, remained ambiguous, contradicted
   earlier evidence, or changed the conclusion.

Poolday maintains a governed account of this evidence. It may propose a next
action, but it does not assert that a proposal is biologically correct or that
an experiment has been performed or validated.

"Proof-carrying" means that a decision carries inspectable signatures,
provenance, contracts, protocols, outcomes, independence evidence, and measured
evaluations. It does not mean proof of biological truth, honest browser code,
hardware-attested execution, or guaranteed scientific correctness.

## Optimization objective

The governing objective is:

```text
reduce the verified cost of resolving protein uncertainty
```

Scientific cost can include browser compute, money, researcher time, laboratory
work, instrument access, samples, and elapsed time. Poolday must preserve the
components instead of collapsing incomparable costs into an unexplained score.

Network activity is not the objective. Peer count, jobs, receipts, records,
model count, and total compute remain operational measures. A contribution
improves the network only when later evidence shows fewer unnecessary
computations or experiments, earlier disagreement detection, better retrieval,
more informative residue selection, less repeated failed work, or stronger
independent reproduction.

## Product outcome

The target product journey begins when a researcher submits a bounded question
about an explicitly public protein sequence with explicit intent and consent.
Poolday creates or extends a signed [Discovery Contract](./discovery-contract.md).
The contract represents competing hypotheses, exact model evidence, current
uncertainty, candidate next actions, predicted observations, falsifiers, action
value, and replication or closure criteria.

Qualified model contracts, opted-in browser providers, reviewers, and
participating laboratories can contribute candidate epistemic updates. Each
update remains an attributable claim. Poolday admits it into the governed state
only under the declared provenance, independence, review, and evaluation policy.

### Governed Research Room cycle

The implemented Research Room slice projects one deterministic feedback cycle
over verified, room-scoped signed records:

1. A human signs a public sequence and question. The question can bind
   conditions, desired observation, decision context, scope, exclusions, and
   known unknowns. Missing structure remains an explicit clarification gap.
2. Peers execute the exact model contract. An accepted execution-agreement
   claim requires at least two embedded provider-signed receipts, distinct
   receipt identities, distinct provider identities, and distinct provider
   keys. Public Research requests select a policy that guarantees at least two
   providers. The requester re-verifies the signed receipt evidence before
   publishing the research result.
3. Results preserve exact model, receipt, provider, runtime, output, consent,
   and provenance identities.
4. The room exposes agreement, disagreement, question gaps, missing receipts,
   and provisional evidence without treating similarity as agreement.
5. Independent reviewers can accept, reject, request revision, request
   replication, or attach a separately reviewed correction. Conflicting latest
   reviewer decisions project as disputed.
6. Only independently accepted active evidence enters reusable room memory.
   Receipt-backed results also require independent execution. Revoked records,
   disputed records, replication requests, single-provider results, and records
   superseded by accepted corrections remain visible but excluded.
7. The complete room archive and decision memory are separate projections over
   the same immutable records. Archive state preserves provisional, disputed,
   rejected, failed, corrected, revoked, superseded, and quarantined material.
   Decision memory admits only evidence allowed by the named room policy.
8. Exact public sequence identity can retrieve evidence from other public
   rooms. The browser re-verifies every signed record and its room-local links.
   Origin acceptance remains provenance only. A versioned source with declared
   license metadata can be attached as a new provisional current-room record,
   but it still requires current-room review before admission. Family and
   domain records qualify for automatic attachment only when their signed
   annotation identity binds a declared namespace term and ontology release to
   the exact sequence, retains the source coordinate system, and projects a
   canonical one-based closed residue interval. Historical free-text
   annotations remain in the archive but require manual qualification. An
   attachment also signs the origin and current question identities, public
   reuse consent, and a field-by-field comparison of question, decision
   context, conditions, scope, exclusions, and desired observation. Textual
   agreement is not relevance. A separate independent current-room review must
   explicitly determine the source relevant before decision-memory admission.
9. Governance actions can respond to provisional records, but scientific next
   actions must identify accepted-memory basis hashes. A signed approval binds
   the exact projected task contract, including rationale, basis hashes, and
   ranking policy. Every proposed action carries no allocation or execution
   authority.

New records use `poolday.research_evidence/v2`. Signed v1 history remains
inspectable after reload but cannot inherit v2 independent-execution or exact
task-approval status. Records that fail verification or admission are moved to
the room's quarantine cache rather than silently deleted from local history.

The source projections are [`research-cycle.js`](../../self/pool/research-cycle.js),
[`evidence-network.js`](../../self/pool/evidence-network.js), and
[`room-projection.js`](../../self/ui/pool-home/room-projection.js).
This slice does not implement calibrated biological action value, laboratory
qualification, scientific closure, or autonomous policy promotion.

The immediate supported value remains:

```text
get a result you can inspect and govern
```

The current approved supporting claim remains:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

The receipt is evidence about an assignment and its declared execution
artifacts. It is not proof of honest browser code or hardware-attested GPU
execution.

## Deliberately separate model ensemble

The four-model plan has separate roles and separate promotion authority.

| Model | Role | Current state |
| --- | --- | --- |
| ESM-2 35M | Fast protein similarity, retrieval, and clustering baseline. | Enabled baseline only. |
| AMPLIFY 120M | Independent protein representation and bounded masked-residue proposals. Its logits mean model-specific residue plausibility, not mutation fitness. | Disabled pending qualification and scientific value evidence. |
| ESMC 300M | Larger independent representation for retrieval, residue localization, and useful disagreement with ESM-2. | Disabled pending browser memory and incremental-value evidence. |
| Nucleotide Transformer v2 50M | Separately governed later DNA lane. | Disabled pending privacy, reference-coordinate, scientific-fitness, licensing, and product-use gates. |

Models do not work together by averaging vectors. Each exact model contract owns
its own representation index because its vectors occupy a distinct coordinate
system. Poolday joins evidence only through durable identities: sequence and
question hashes; exact checkpoint, weights, tokenizer, manifest, conversion,
runtime, and execution identities; protein residue or DNA coordinates;
hypotheses and predicted observations; reviews; outcomes; corrections; and
replications.

Every model contract freezes the checkpoint revision, conversion digest,
manifest and artifact hashes, tokenizer identity, shard set, alphabet,
normalization, ambiguity policy, sequence limits, dimensions, pooling, output
capabilities, dtype lane, WebGPU requirements, execution graph, runtime
version, license, and claim boundary. Any identity mismatch blocks comparison,
routing, receipt acceptance, evidence publication, and promotion.

## Model promotion boundary

Promotion is independent and fail-closed. Node WebGPU conversion, loading, or
numerical parity does not qualify a model for Poolday. Authentic browser
qualification must bind immutable hosted artifacts, complete hash verification,
WebGPU execution, OPFS persistence and restoration, receipt integrity,
cancellation, stale-result rejection, corruption handling, interruption
recovery, and independent reproduction to the release source, model bytes,
runtime, browser, GPU, policy, and output.

Technical qualification alone is insufficient. Each model also needs frozen,
adjudicated, family-disjoint scientific evaluation. AMPLIFY must demonstrate
useful residue-plausibility evidence without fitness claims. ESMC must show
incremental decision value or useful disagreement beyond ESM-2. Nucleotide
Transformer must pass its own DNA evaluation and cannot inherit protein-model
authority.

The promotion order is:

1. Re-establish ESM-2 as the frozen baseline with persisted clean-release
   browser evidence.
2. Admit AMPLIFY only after browser execution and bounded residue evidence pass.
3. Admit ESMC only after memory behavior and incremental value pass.
4. Consider Nucleotide Transformer only through its independent DNA and
   licensing gate.

## The Discovery Contract

The Discovery Contract is the target atomic product object. It binds:

1. A bounded question and its declared decision context.
2. Competing hypotheses, including a none-of-the-above alternative when
   applicable.
3. Current evidence, contradictions, uncertainty, provenance, and blind spots.
4. Candidate computations, reviews, experiments, and replications.
5. Predicted observations and falsifiers for the affected hypotheses.
6. Expected information gain, cost, latency, feasibility, independence, safety,
   and probability of changing the next decision.
7. Outcomes, protocol conditions, failures, and the resulting candidate
   epistemic update.
8. Predeclared replication, provisional acceptance, rejection, reopening, and
   closure criteria.

The contract evolves through signed append-only records and reproducible
projections. No participant edits prior evidence in place. Corrections,
revocations, superseding versions, and changed conclusions remain linked and
inspectable.

## User roles

| Role | Product job |
| --- | --- |
| Requester | Submit a bounded question, constraints, consent, and decision context. Inspect and accept or reject admitted work. |
| Contributor | Opt in an eligible browser and execute assignments under declared capacity and policy limits. |
| Agent | Propose hypotheses, versioned prior evidence, predictions, and work orders through signed contracts. Agents cannot issue human review decisions, approve work, admit memory, or close a question. |
| Reviewer or curator | Attach separately signed critiques, sources, corrections, confidence, experimental context, and bounded follow-up proposals. |
| Laboratory or instrument operator | Claim approved physical work, execute a signed protocol, and report positive, negative, failed, or ambiguous outcomes with conditions and controls. |
| Independent evaluator | Measure prospective decision-policy performance against a frozen baseline and held-out outcomes. |

Contributors earn credit only under the declared evidence and evaluation policy.
Participation does not grant publisher, adapter-creation, scientific-policy, or
closure authority.

## Product principles

1. Lead with the most informative next action and the evidence that justifies it.
2. Keep competing hypotheses explicit. Preserve disagreement when the evidence
   does not justify resolution.
3. Bind every computation to the assignment, exact model artifacts, workload,
   runtime profile, policy, route, provider signature, and requester decision.
4. Bind every experiment to its protocol, conditions, controls, readouts,
   analysis identity, uncertainty plan, operator identity, and consent.
5. Keep execution consent explicit. A browser, reviewer, or laboratory
   contributes only after accepting bounded work and publication terms.
6. Fail closed when model, artifact, workload, identity, policy, protocol,
   receipt, or lineage evidence does not match.
7. Treat positive, negative, failed, ambiguous, corrected, and contradictory
   outcomes under the same provenance and review rules.
8. Keep model facts, human claims, experimental outcomes, and policy evaluations
   separate. None becomes truth or training data merely by being signed.
9. Require demonstrated prospective improvement before a scientific decision
   policy enters Poolday.
10. Keep experimental Zero and X evidence separate from Poolday product evidence
    until a capability passes the promotion boundary below.

## P2P boundary

P2P is infrastructure. It supports provider discovery, direct payload transit,
availability, bounded at-least-once relay delivery, and quorum comparison. It is
not the product claim and does not turn Poolday into a decentralized compute
marketplace.

Servers may provide authentication, rendezvous, compatibility coordination,
public anchoring, or rebuildable projections. They do not perform the claimed
browser-local model execution. A relay acknowledgement proves recipient receipt
of that relay record only. It does not prove exactly-once delivery, scientific
validity, or final contract acceptance.

## Current product boundary

- Poolday is the main Reploid product surface.
- The configured launch model is the enabled ESM-2 35M protein-sequence model.
  The exact model, manifest, tokenizer, artifact, workload, and runtime identity
  come from `pool-config.json`.
- AMPLIFY, ESMC, and Nucleotide Transformer have disabled exact contracts. Their
  catalog presence is not execution, browser qualification, scientific-fitness
  evidence, licensing approval, or permission to select them.
- Public Poolday execution currently accepts only explicitly public protein
  sequences for ESM-2. The separately governed DNA contract does not make DNA
  execution a current product capability. Poolday returns model outputs and
  evidence, not biological, medical, or fitness interpretation.
- Each selected provider loads and executes the complete model. Poolday does
  not claim tensor, layer, attention, or KV-cache sharding.
- The public protein collection supports exact-contract flat similarity,
  evidence-aware reranking, deterministic clustering, text search, and
  approval-gated discovery tasks. Poolday is not a managed vector database.
- Poolday supports signed human review of public protein evidence. It is not a
  biological interpretation or diagnosis tool, and submitted human claims do
  not become model facts.
- The full Discovery Contract, calibrated action-value ranking, scientific-cost
  accounting, prospective policy comparison, laboratory qualification, and
  contract closure workflow remain target capabilities unless separately listed
  as supported in the surface claim index.

See the [claim boundary](./claims-and-nonclaims.md),
[biological sequence lane](./biological-sequence-lane.md), and
[retrieval direction](./receipt-backed-retrieval.md) for supported behavior and
promotion gates.

## Reploid surface hierarchy

Reploid contains three browser surfaces with separate authority:

| Surface | Current authority | Active-science role |
| --- | --- | --- |
| Poolday `/` | Assignments, routes, receipts, agreement, requester acceptance, points, reputation, and admitted public evidence. | Own durable Discovery Contracts, uncertainty projections, action routing, replication state, and promoted scientific policy. |
| Zero `/zero` | Zero-local tools, state, verification, and recovery evidence. | Propose hypothesis decompositions, analyses, uncertainty estimators, experiment-ranking methods, and contradiction detectors. |
| X `/x` | Candidate, validation, promotion, quarantine, replay, and rollback evidence. | Evaluate candidate scientific decision policies in Shadow against frozen historical and prospective contracts. |

Zero or X evidence never substantiates a Poolday claim by itself. Zero proposes.
X evaluates. Poolday admits and governs.

## Scientific-policy promotion boundary

Zero and X are discovery engines for candidate automation, self-improvement, and
new capabilities. A candidate scientific policy must remain in Shadow until it
shows a measured improvement against a predeclared baseline and held-out
contracts.

```text
Zero candidate method or policy
  -> X Shadow evaluation on frozen contracts
  -> independent evidence and evaluator separation
  -> safety, revocation, and rollback coverage
  -> human approval
  -> Poolday-owned policy, configuration, and user contract
  -> prospective Poolday operational proof
  -> governed product capability
```

Evaluation asks whether the candidate selected more discriminating actions,
reached the same conclusion with fewer resources, identified contradictions or
failure earlier, generalized across held-out protein families, and preserved
safety and rollback. A candidate cannot approve its own evaluator.

Before promotion, the behavior remains experimental. After promotion, Poolday
must support the capability through its own configuration, admission rules,
receipts, tests, user-visible evidence, revocation path, and rollback path.

## First product proof

The first product proof is one named public-protein catalog and curator role
adjudicating one recurring disputed family or domain annotation decision. The
exact catalog and role remain user-owned choices; repository code and product
copy must not silently select them.

`poolday.annotation_adjudication_experiment/v1` freezes those choices together
with the current workflow and handoffs, exact baseline and candidate revisions,
a content-hashed family-disjoint paired cohort, metric definitions and noise
models, an exact blinded evaluator identity and artifact, and acceptance,
rejection, and reopening rules. The only passing paths are:

1. adjudication quality improves while curator effort remains within its frozen
   comparability margin; or
2. curator effort improves while adjudication quality remains within its frozen
   non-inferiority margin.

`poolday.annotation_adjudication_evaluation/v1` binds every frozen metric to the
same paired sample count, an oriented effect interval, complete missing-case and
regression accounting, a content-hashed raw result manifest, and the exact
predeclared evaluator. The conclusion is derived from lower interval bounds and
the frozen thresholds. An undersized sample is inconclusive. The experiment
author cannot evaluate the experiment, and an evaluation cannot use an
unreviewed experiment contract.

Until an independently accepted evaluation passes one frozen path, the broader
protein uncertainty network remains a target hypothesis. Even a passing record
supports only the named workflow and cohort; it does not establish biological
truth, global catalog value, or a general product moat.

## North-star metric

The primary product metric is:

```text
verified cost required to resolve a bounded protein uncertainty relative to a
fixed baseline research policy
```

Before real-world laboratory campaigns are available, software-only evaluation
uses frozen historical or hidden outcomes. It measures information gained per
action, uncertainty calibration, contradiction-resolution cost, duplicate work
avoided through reusable negative evidence, and prospective performance on
unseen protein families. It does not treat these evaluation measures as proof of
biological function or mutation fitness.

## Authority order

| Question | Canonical source |
| --- | --- |
| Reploid's repository mission and durable strategic goals | [`GOALS.md`](../../GOALS.md) |
| How Poolday applies the mission and relates to Zero and X | This document |
| Discovery Contract fields, lifecycle, scoring boundary, and closure rules | [Discovery Contract](./discovery-contract.md) |
| Exact enabled model, policy, trust, and transport configuration | [`pool-config.json`](../../self/pool/pool-config.json) |
| Current runtime, peer, coordinator, and deployment behavior | [Browser inference contract](../browser-inference-pool.md) |
| Supported public language and nonclaims | [Claims and nonclaims](./claims-and-nonclaims.md) |
| Work queue and proof state | [`self/pool/TODO.md`](../../self/pool/TODO.md) |

Cross-project strategy may frame markets and future products, but it does not
override these project-owned sources.

---

*Last updated: August 2026*
