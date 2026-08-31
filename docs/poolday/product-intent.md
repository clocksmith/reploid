# Poolday Product Intent

Poolday is Reploid's peer-to-peer Doppler execution product. The public UI uses
the Poolday name; Reploid remains the implementation owner.

This document applies the repository mission in [`GOALS.md`](../../GOALS.md) to
Poolday's purpose and the authority boundary between Poolday, Zero, and X.
Exact enabled models, policies, trust
tiers, routes, and transport requirements remain owned by
[`pool-config.json`](../../self/pool/pool-config.json) and the
[browser inference contract](../browser-inference-pool.md).

## Product goal

Poolday's product goal is to make one browser-peer execution lifecycle ordinary
and inspectable:

```text
request -> peer executes -> result compared -> requester accepts -> receipt retained
```

A requester selects a signed Doppler Pack, supplies input, reviews disclosure
and execution requirements, submits a job, watches assignment and progress,
and receives a comparable result. A contributor chooses eligible Packs and
resource limits, downloads the exact Pack, executes locally, and returns the
result with a signed receipt. Recent jobs preserve recovery and verification
state after refresh, disconnect, peer loss, timeout, or cancellation.

The primary interface contains only Run a model, Share compute, and Recent
jobs. Network availability is a compact, meaningful indicator. Recent jobs
Advanced details contain execution receipts, comparison evidence, peer
identities, retries, and recovery only. Research Room-1 is a separate
non-primary route for hypotheses, scientific policies, cohorts, adjudication,
and laboratory evidence; generic Pack execution does not inherit those fields.

The current enabled Pack remains the pinned ESM-2 35M public-sequence contract.
That narrow implementation boundary does not redefine Poolday as a protein
product or authorize claims for unqualified models, private inputs, hardware
attestation, or honest browser execution.

The proof-carrying Research Room-1 remains an optional governed workflow over
Poolday receipts. It tests whether those receipts improve adjudication of
disputed family or domain annotations in a named public protein catalog; it is
not the primary navigation or the definition of Poolday.

When the optional Research Room is used, a researcher begins with an explicitly
public protein sequence and a bounded question. The target discovery object preserves:

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

Network activity alone is not the objective. Peer count, jobs, receipts,
records, model count, and total compute remain operational measures. Product
success requires successful qualified jobs, recoverable failures, comparable
results, explicit requester decisions, retained receipts, and repeated use.
Scientific value remains a separate Research Room claim requiring its own evidence.

## Research Room outcome

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
Current laboratory claims bind a public institution identity hash, versioned
capability evidence, exact protocol custody, declared safety oversight and
limitations, bounded availability, publication consent, and conflicts into one
signed profile. The profile proves only what its author declared and signed; it
does not prove institutional authorization, biosafety, capability, capacity, or
access to an instrument.

Current `poolday.research_resolution_policy/v1` records freeze a bounded target
hypothesis and decision scope before any work order. They separately define
provisional-acceptance and rejection outcome mappings, continued-uncertainty
triggers, mandatory reopening triggers, uncertainty thresholds, replication
and reviewer counts, and closure-eligibility conditions. An independent review
is required before a qualified laboratory may claim later work. The projection
does not evaluate those conditions or grant acceptance, rejection, or closure
authority; the signed chronology is also not proof that an author lacked prior
outcome access.

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
   New qualified imports use `poolday.public_protein_evidence/v1` for public
   sequence, structure, domain, annotation, publication, assay, negative-result,
   and failed-attempt evidence. Each record binds a versioned source, explicit
   conditions, at least one versioned transformation, declared license, source
   identity, retrieval method and time, and a finding state. Negative and
   ambiguous findings remain evidence. A failed attempt claims no observation,
   remains retrievable, and never satisfies a completed-replica target.
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
   Repeated origin records with the same declared evidence kind, source
   reference, version or content hash, and normalized annotation identity are
   one candidate source, not independent evidence. Every signed origin remains
   in the archive, while decision memory counts an accepted declared source at
   most once. A version label or later timestamp never supersedes evidence by
   itself; only linked accepted correction or authorized revocation records do.
9. Governance actions can respond to provisional records, but scientific next
   actions must identify accepted-memory basis hashes. A signed approval binds
   the exact projected task contract, including rationale, basis hashes, and
   ranking policy. Every proposed action carries no allocation or execution
   authority.
10. A signed candidate-action contract can propose a computation, retrieval,
    review, assay, or replication. It binds affected hypotheses, predicted and
    falsifying observations, exact workload or protocol hashes, feasibility,
    independence, safety, public consent, six separate scientific-cost
    components, and declared expected-value inputs. Candidate uncertainty names
    measurement variance, model uncertainty, cross-source disagreement,
    missing alternatives, protocol risk, or decision-change uncertainty.
    Numeric probabilities additionally require a versioned calibration method
    and independently accepted frozen cohort; otherwise the representation is
    ordinal or set-valued. The current deterministic ranking remains explicitly
    heuristic and carries no allocation or execution authority.
11. The Room can disclose a bounded public-protein disagreement queue. It
    locally reverifies the coordinator's signed replay inputs and reproduces
    `poolday.protein_uncertainty_campaign_queue/v1`. Ranking counts four binary
    dimensions only: exact-contract embedding disagreement, normalized public
    annotation disagreement at one scope and residue interval, independent reviewer disagreement, and completed
    experimental disagreement under identical canonical conditions. It never
    compares vectors across contracts or counts failed attempts as completed.
    The queue is an uncalibrated organizing heuristic, not biological priority,
    truth, expected action value, allocation, or execution authority.

New records use `poolday.research_evidence/v2`. Signed v1 history remains
inspectable after reload but cannot inherit v2 independent-execution or exact
task-approval status. Records that fail verification or admission are moved to
the room's quarantine cache rather than silently deleted from local history.

The source projections are [`research-cycle.js`](../../self/pool/research-cycle.js),
[`evidence-network.js`](../../self/pool/evidence-network.js),
[`protein-uncertainty-campaign.js`](../../self/pool/protein-uncertainty-campaign.js),
and [`room-projection.js`](../../self/ui/pool-home/room-projection.js).
This slice does not implement calibrated biological information gain,
independent verification of laboratory qualifications, scientific closure, or
autonomous policy promotion.

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
| Laboratory or instrument operator | Sign a public qualification profile, claim approved physical work under exact protocol custody, and report positive, negative, failed, or ambiguous outcomes with conditions and controls. The signed profile is not external authorization. |
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
4. Bind every experiment before any laboratory claim to its exact protocol,
   conditions, controls, readouts, normalization, analysis identity, allowed
   failures, custody, public publication scope, uncertainty plan, operator
   identity, and consent. Freeze the required replication-independence
   dimensions in the order. Keep the order unallocated until independent review.
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
  approval-gated discovery tasks. Its bounded disagreement queue is replayed
  from signed inputs and remains explicitly uncalibrated. Poolday is not a
  managed vector database.
- Poolday supports signed human review of public protein evidence. It is not a
  biological interpretation or diagnosis tool, and submitted human claims do
  not become model facts.
- Poolday supports canonical signed laboratory qualification claims binding
  institution identity, versioned capability evidence, protocol custody,
  declared safety limits, availability, publication consent, and conflicts.
  These declarations are not independently verified institutional authority,
  safety certification, instrument access, or demonstrated capability.
- Current work orders bind the exact protocol, controls, conditions, readouts,
  normalization, planned analysis hashes, allowed failure categories, custody
  artifact and policies, blinding, complete-publication scope, and at least two
  replication-independence dimensions. Signed outcomes bind institution,
  instrument, sample-batch, preparation-batch, and analysis-execution hashes.
  A replication is link-admissible only when every dimension frozen by its
  order differs from the original under the same exact protocol. These are
  signed identity comparisons, not proof of physical independence. Orders
  remain unallocated, require independent acceptance before a qualified
  laboratory claim, and grant no execution or laboratory authority.
- Current governed work orders also fail closed unless they declare the public,
  non-pathogenic, non-clinical lane; explicitly public synthetic or public
  reference samples; independent human safety review; no medical use; and no
  biological-interpretation or laboratory authority. A current laboratory
  claim must use the exact same safety classification. These are enforced scope
  declarations, not biosafety inspection or proof that a protocol is safe.
- Resolution policies can freeze provisional acceptance, continued uncertainty,
  rejection, reopening, and closure-eligibility criteria before work begins.
  They are governance records excluded from scientific decision memory. The
  current projection exposes the criteria and independent-review state but has
  no scientific closure authority and does not assert that a criterion was met.
- Signed replayable Discovery Contract checkpoints are supported for the
  current governed Research Room subset. Calibrated action-value ranking,
  scientific-cost accounting, prospective policy comparison, independent
  laboratory qualification, and contract closure remain target capabilities
  unless separately listed as supported in the surface claim index.

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

The internal
[`scientific-policy-promotion.js`](../../self/pool/scientific-policy-promotion.js)
contract implements this ordering as four hash-bound records: a
`poolday.zero_scientific_policy_candidate/v1` proposal, a frozen
`poolday.x_scientific_policy_shadow_cohort/v1`, a paired
`poolday.x_scientific_policy_shadow_evaluation/v1`, and a
`poolday.scientific_policy_promotion/v1` decision. It requires distinct Zero
proposer, X evaluator, human approver, and Poolday owner identities. It also
requires the full frozen metric vector, passing prospective checkpoints, human
approval, Poolday configuration and user-contract hashes, safety review,
revocation, and tested rollback. A passing decision is only
`promotion_eligible_not_activated`; exact Poolday-owned active configuration is
a separate gate.

Before promotion, the behavior remains experimental. After promotion, Poolday
must support the capability through its own configuration, admission rules,
receipts, tests, user-visible evidence, revocation path, and rollback path.
No current candidate has passed this process or established prospective product
improvement.

After a bounded candidate action produces reviewed outcomes, a
`poolday.realized_action_value/v1` record can bind its exact independent
approval, frozen cohort evaluation, evaluation review, outcome reviews,
complete metric vector, and named causal contribution records. The value
assessor cannot credit its own record. The reward projection grants one
deduplicated realized-usefulness credit per candidate-action and contribution
pair only after another independent reviewer accepts the value record.
Operational activity counters remain separate. This records accountable
downstream usefulness; it does not prove biological causality, truth, closure,
or globally transferable value.

## First scientific product proof

The first scientific product proof is one named public-protein catalog and
curator role adjudicating one recurring disputed family or domain annotation
decision. The exact catalog and role remain user-owned choices; repository code
and product copy must not silently select them.

`poolday.annotation_adjudication_experiment/v3` freezes those choices together
with the current workflow and handoffs, exact baseline and candidate revisions,
a content-hashed family-disjoint paired cohort, metric definitions and noise
models, an exact blinded evaluator identity and artifact, and acceptance,
rejection, and reopening rules. V2 also binds the baseline action-selection
artifact, input and budget contracts, action set, ranking and stop rule; the
hidden-historical or prospective-future outcome boundary and evidence cutoff;
and paired input, resource, failure, timeout, and seed controls. V1 and v2
history remain inspectable but cannot satisfy the current north-star freeze
gate. A signed
access declaration is attributable evidence, not proof that nobody saw an
outcome. The contract also freezes five distinct supporting metrics:
information gained per action, contradiction-resolution cost, duplicate work
avoided, uncertainty calibration error, and held-out family performance. Each
keeps its unit, direction, measurement source, aggregation, validity conditions,
noise model, sample floor, and confidence level. They remain a tradeoff vector
separate from the quality-or-effort gate.

V3 additionally freezes one lower-is-better north-star metric for median
normalized cost to a predeclared independently replicated conclusion. The
policy preserves raw compute, money, labor, instrument, sample, and elapsed-time
amounts, fixes their conversion artifact and reporting unit, charges failed and
unresolved cases, and binds the stop rule. It freezes the conclusion states and
replication minimum, required independence dimensions, paired-median and
interval method, missing-case treatment, confidence level, and improvement
threshold. Peers, jobs, receipts, records, claims, and total compute are
operational measures and have no success authority. The quality-or-effort gate
is:

1. adjudication quality improves while curator effort remains within its frozen
   comparability margin; or
2. curator effort improves while adjudication quality remains within its frozen
   non-inferiority margin.

`poolday.annotation_adjudication_evaluation/v3` binds every frozen metric to the
same paired sample count, an oriented effect interval, complete missing-case and
regression accounting, a content-hashed raw result manifest, and the exact
predeclared evaluator. Its north-star evidence binds case, raw-cost,
conclusion-audit, independence-audit, and conversion-audit manifests. Passing
requires one quality-or-effort path plus complete real-world paired evidence and
the frozen north-star cost improvement. An undersized, missing, unresolved, or
insufficiently replicated comparison is inconclusive. The experiment author
cannot evaluate the experiment, and an evaluation cannot use an unreviewed
experiment contract. A signed evaluator report is accountable evidence, not
biological truth or proof that every declared independence fact is physical.

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
