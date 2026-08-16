# Poolday Discovery Contract

Status: target product contract. This document does not claim that every field,
projection, gate, or workflow is implemented.

A Discovery Contract is the signed, evolving object that connects an uncertain
question to the next action and to the evidence required for a provisional or
independently replicated conclusion.

It is an epistemic control contract, not a truth certificate. Signatures prove
attribution under the declared identity scheme. Receipts prove
assignment-bound execution evidence. Independent agreement proves
reproducibility within a declared contract. None proves biological truth or
honest hardware execution.

## Implemented Research Room subset

The current `poolday.governed_research_cycle/v1` projection implements a
strict subset of this target contract:

- signed sequence and question anchors with deterministic clarity gaps;
- exact receipt-backed result provenance and reproduction checks bound to
  embedded provider-signed receipts, distinct receipt identities, distinct
  provider identities, and distinct provider keys;
- independent review states for acceptance, rejection, revision, replication,
  and disputed reviewer decisions;
- fail-closed accepted room memory with correction, revocation, dispute, and
  single-provider result exclusion;
- governance actions over provisional records;
- scientific actions whose `basisHashes` are restricted to accepted memory;
- exact signed task approvals that become stale when the projected rationale,
  basis, target, or ranking policy changes;
- a deterministic next-question brief with explicit uncertainty, human
  approval, and no execution authority;
- v1 history preservation and fail-closed quarantine for records that cannot
  satisfy the current admission contract;
- domain-separated `poolday.discovery_contract_checkpoint/v1` records that
  bind the question, stable contract identity, named admission policy, parent
  checkpoint hashes, exact projection contract artifact, complete ordered
  archive inputs, active inputs, deterministic state, and checkpoint signer;
- exact checkpoint replay with missing, signature-invalid, cross-room,
  non-canonical, stale, revoked-active-input, and projection-identity rejection;
- deterministic child checkpoints that preserve prior revisions and record
  reopening caused by contradiction, correction, revocation, failed
  replication, active-input invalidation, or removal from decision memory;
- immutable checkpoint lineage that requires a child checkpoint instead of
  direct checkpoint revocation;
- monotonic child lineage that retains every parent archive input and rejects
  an unchanged child input set;
- browser-local persistence, coordinator validation, reload recovery, and one
  checkpoint control inside the Research Room history disclosure.

The projection is defined by
[`discovery-contract.js`](../../self/pool/discovery-contract.js) and
[`research-cycle.js`](../../self/pool/research-cycle.js), with record and link
invariants in [`evidence-network.js`](../../self/pool/evidence-network.js).
Calibrated information gain, complete laboratory independence, closure, and
policy promotion remain target work. A signed checkpoint freezes a replayable
evidence state. It does not close the scientific question or certify truth.

## Design laws

1. Preserve source records. Build contract state as a deterministic projection
   over signed append-only records.
2. Represent alternatives. A contract with one preferred answer and no explicit
   alternative is incomplete unless the admission policy records why.
3. Separate observation from interpretation. Model output, human claim,
   experimental outcome, review decision, and policy evaluation use distinct
   record kinds and signature domains.
4. Predeclare decisions. Predictions, falsifiers, action selection rules,
   metrics, baselines, replication targets, and closure criteria freeze before
   the corresponding outcome is available.
5. Preserve failure. Negative, failed, ambiguous, contradictory, and revoked
   records remain in lineage even when excluded from active projections.
   Qualified public imports bind source version, conditions, transformations,
   license, retrieval provenance, and finding state. Failed attempts remain in
   retrieval and action basis but do not count as completed replicas.
6. Require independence where claimed. Replication and review policy compares
   identity roots, institutions, protocol custody, model lineage, data sources,
   and shared failure modes as applicable.
7. Make scoring replayable. Every action score binds its method, version,
   parameters, input record hashes, and cost assumptions.
8. Keep activation governed. A candidate policy cannot change Poolday selection
   behavior until it passes the Zero to X to Poolday promotion boundary.

## Contract envelope

Every contract version contains or derives these envelope fields:

| Field | Meaning |
| --- | --- |
| `contractId` | Stable content-derived identity for the bounded question and admission context. |
| `revisionHash` | Hash of this projected version or signed checkpoint. |
| `parentRevisionHashes` | Prior revisions merged or superseded by this version. The implemented checkpoint field is `parentCheckpointHashes`. |
| `roomId` | Poolday evidence room that owns publication and hydration scope. |
| `questionHash` | Signed question record that anchors the contract. |
| `policyId` | Poolday admission and evidence policy used for this revision. |
| `projectionId` | Exact versioned projection contract. The implemented checkpoint also binds the canonical projection-manifest artifact hash. |
| `inputRecordHashes` | Complete ordered input set for deterministic replay. |
| `activeInputRecordHashes` | Inputs eligible for the current projection after revocation and downstream invalidation. |
| `createdAt` | Signed checkpoint time. It does not replace source timestamps. |
| `author` | Checkpoint signer or policy authority. Source records retain their own authors. |
| `signature` | Domain-separated signature over the checkpoint payload. |

Poolday can derive ordinary live views without signing each render. Any revision
used for action allocation, evaluation, provisional acceptance, closure, or
promotion must freeze its projection identity and inputs.

## Required state

### Question and decision context

The question must be bounded enough to admit an observation or decision. The
contract records:

- target protein, family, mutation set, or public dataset identity;
- biological system, conditions, scope, and exclusions;
- requester intent, consent, privacy class, safety class, and budget;
- decision that the answer is expected to change;
- known blind spots and out-of-scope interpretations.

### Competing hypotheses

Each hypothesis records:

- a condition-specific statement;
- rationale and linked prior evidence;
- alternatives and compatibility relations;
- discriminating observations;
- predicted observations and falsifiers;
- current support and uncertainty with method identity;
- status such as active, weakened, provisionally supported, rejected, or
  reopened.

Hypothesis status is a projection from evidence and policy. It is not an
editable fact.

### Evidence and uncertainty

Evidence records identify source, version or content hash, retrieval method,
transformations, conditions, uncertainty, license or consent, and lineage.

The uncertainty projection must distinguish at least:

- uncertainty within a model or measurement;
- disagreement between models, evidence sources, reviewers, or laboratories;
- missing evidence and untested alternatives;
- uncertainty caused by protocol, controls, conditions, or analysis;
- uncertainty about whether the result changes the next decision.

Poolday must not invent calibrated probabilities when only ordinal confidence or
disagreement is available. The representation records the calibration method and
evaluation cohort whenever it exposes a numeric probability.

### Candidate next actions

The implemented `poolday.discovery_candidate_action/v1` contract admits a
computation, retrieval, review, assay, or replication. More specialized
critique, perturbation, and structural work must use one of those admitted
classes with an exact workload or protocol contract. Each proposal binds:

| Field | Meaning |
| --- | --- |
| `actionId` | Stable identity for the proposed action contract. |
| `actionKind` | Admitted computation, review, experiment, or replication class. |
| `targetHypothesisHashes` | Hypotheses the outcome can distinguish. |
| `protocolHash` | Exact workload or laboratory protocol, including controls and readouts. |
| `predictedObservations` | Outcome expectations grouped by hypothesis. |
| `falsifiers` | Observations that weaken each affected hypothesis. |
| `expectedInformationGain` | Declared estimate with units, method, inputs, and calibration evidence. |
| `scientificCost` | Vector of compute, money, labor, instrument, sample, and time costs. |
| `decisionChangeProbability` | Estimated probability that the outcome changes the next choice. |
| `latency` | Declared result latency or distribution when known. |
| `feasibility` | Required capability, availability, materials, and failure risks. |
| `independence` | Required separation from prior providers, reviewers, data, models, or laboratories. |
| `safety` | Admission class, hazards, operator constraints, and approval requirements. |
| `score` | Replayable policy output. It is never stored without its scoring identity. |
| `status` | Proposed, approved, claimed, running, completed, failed, cancelled, or superseded. |

No single ratio is universally valid across heterogeneous costs. A Poolday policy
may rank a Pareto set, apply requester budgets, or use a declared utility
conversion. The UI must expose the components and the chosen policy.

The current public-protein slice signs these contracts as governance proposals,
not executable allocations. It separates measurement variance, model
uncertainty, cross-source disagreement, missing alternatives, protocol risk,
and decision-change uncertainty. A numeric probability is rejected unless it
binds a versioned calibration method, metric, and independently accepted frozen
cohort; ordinal and set-valued representations remain available without that
claim. The current ranking policy is
`poolday.signed_candidate_action_heuristic/v1`: it deterministically retains
its version, parameters, input hashes, cost assumptions, calibration-evidence
set, raw value components, and all six raw cost components. It preserves
rejected actions and shows the selected candidate and approval state in the
primary Research Room and signed Discovery Contract checkpoint. The heuristic
is not calibrated information gain and neither selection nor approval executes
or allocates the action.

Candidate-action state is frozen by
`poolday.discovery_contract_projection/v2`. Historical v1 checkpoints retain
their original state shape and artifact identity and remain replayable; the
projection upgrade requires a new linked checkpoint instead of silently
changing v1 semantics.

### Outcome and candidate epistemic update

Every completed or failed action produces a signed outcome that records:

- assignment and claimant identity;
- exact model, workload, protocol, controls, conditions, and analysis identity;
- raw or content-addressed observations and transformations;
- positive, negative, ambiguous, or failed classification;
- failure category and control state;
- measurement uncertainty;
- blindness and reveal state when applicable;
- replication lineage and relevant shared dependencies;
- consent, custody, and publication scope.

The outcome can propose changes to hypothesis support, uncertainty, action
ranking, closure state, retrieval policy, or future evaluation data. Those
changes are candidate epistemic updates. Poolday applies them only through the
declared projection and evidence policy.

### Replication and closure

Closure is a governed state, not record deletion. The contract predeclares:

- number and kind of independent replications;
- acceptable protocol equivalence and required protocol diversity;
- control and uncertainty thresholds;
- conclusion label and decision scope;
- criteria for provisional acceptance, continued uncertainty, rejection, and
  reopening;
- contradictions or revocations that automatically reopen the contract;
- authority allowed to sign a closure checkpoint.

A closed contract remains challengeable. New evidence creates a linked revision
and can move it to reopened without erasing the prior decision or its basis.

The implemented `poolday.research_resolution_policy/v1` record freezes the
bounded conclusion and scope, outcome-class mappings, uncertainty thresholds,
review and replication counts, continued-uncertainty triggers, all mandatory
reopening triggers, and closure-eligibility constraints before any work order.
It requires independent acceptance before a current laboratory claim and stays
outside scientific decision memory. The current projection exposes the frozen
criteria but does not evaluate them, decide a conclusion, or provide closure
authority. Its signed timestamp is not proof that the author lacked prior
outcome access.

## Action selection

Poolday selects actions under an admitted, versioned scientific policy. The
minimum comparison procedure is:

1. Freeze the active contract revision and candidate action set.
2. Reject actions that fail consent, safety, capability, budget, protocol, or
   independence gates.
3. Estimate the observation distribution and expected uncertainty change for
   each remaining action.
4. Record cost components, latency, feasibility, and decision-change
   probability.
5. Produce a replayable ranking or Pareto set with the policy identity.
6. Require human approval where the policy, safety class, cost, or physical
   action demands it.
7. Allocate the approved action without granting the executor scientific-policy
   or closure authority.
8. Compare predicted value with realized value after outcome review.

The implemented `poolday.realized_action_value/v1` contract makes step 8
append-only. It requires an independently approved exact candidate action, an
independently accepted frozen cohort evaluation, every evaluated outcome and
its current accepting review, the evaluation's accepting review, the complete
measured metric vector, and explicit causal contribution records. A distinct
assessor signs the measurement, and another independent acceptance is required
before the reward projection grants one deduplicated usefulness credit per
candidate-action and contribution pair. The record preserves metric tradeoffs
and grants no scientific closure or causal-truth authority.

Early systems without calibrated information-gain estimates must label their
ranking as a heuristic. They must retain the raw features needed to compare the
heuristic against future calibrated policies.

## Measured improvement

A completed contract can enter a frozen historical or prospective evaluation
cohort. The cohort binds questions, candidate policies, baseline policy, hidden
or future outcomes, cost accounting, and metrics before evaluation.

The implemented `poolday.annotation_adjudication_experiment/v3` freeze makes
that ordering executable for the first product proof. It binds the exact
baseline action-selection policy artifact and input and budget contracts,
eligible action kinds, ranking method and status, deterministic tie break, and
stop rule. It separately declares either blinded historical outcomes with a
committed manifest or prospective outcomes unavailable at freeze, an evidence
cutoff no later than the signed freeze, a reveal rule, and a version-pinned
contamination audit. Baseline and candidate must receive paired tasks, the same
input order and evidence cutoff, and hash-bound resource, failure, timeout, and
seed controls. Historical v1 and v2 experiment records remain inspectable but
cannot satisfy the current north-star freeze gate. The declaration is accountable
evidence of the intended boundary; it cannot prove that a person did not peek.

The same v3 contract freezes a separate
`poolday.adjudication_campaign_measurement_plan/v1`. It maps five distinct
metric definitions to information gained per action, contradiction-resolution
cost, duplicate work avoided, uncertainty calibration error, and held-out
protein-family performance. Those metrics must also remain distinct from the
quality and effort success metrics. Direction is fixed by the measured concept;
unit, source, aggregation, validity conditions, noise model, sample floor, and
confidence level remain explicit.

V3 also freezes `poolday.adjudication_north_star_policy/v1`. This binds a
separate lower-is-better metric for median normalized cost to a predeclared
independently replicated conclusion. It preserves raw compute, money, labor,
instrument, sample, and elapsed-time amounts, binds the conversion artifact and
normalized unit, charges failed and unresolved cases, and fixes the stop rule.
It separately binds retain, revise, reject, and unresolved conclusion states;
the acceptance and replication minimum; named independence dimensions; paired
median aggregation, interval method, confidence level, improvement threshold,
and missing-case treatment. Peers, jobs, receipts, records, claims, and total
compute are fixed as operational metrics that cannot satisfy success.

The v3 evaluation reports baseline, candidate, paired sample count, and oriented
effect interval for every frozen metric. Its signed north-star evidence binds
case, raw-cost, conclusion-audit, independence-audit, and conversion-audit
manifests. A passing conclusion requires complete real-world paired cases,
independently replicated conclusions in both arms, the quality-or-effort gate,
and the frozen cost-improvement bound. Incomplete evidence is inconclusive. The
system preserves the vector rather than inventing one fitness number.

Candidate policies are judged on:

- real-world cost to a predeclared independently replicated conclusion;
- uncertainty reduction or calibration under the declared representation;
- number of actions required to reach the same decision;
- contradiction and failure detection;
- duplicate work avoided through prior negative or failed evidence;
- generalization across held-out protein families and conditions;
- replication success and independence quality;
- safety, revocation, and rollback preservation.

Record count, signature count, peer count, total compute, and unmeasured
consensus do not establish improvement.

## Surface authority and activation

| Surface | Authority |
| --- | --- |
| Poolday `/` | Own admitted records, contract projections, action allocation, replication state, closure checkpoints, and active scientific policy. |
| Zero `/zero` | Produce candidate decompositions, tools, estimators, and action-selection methods. It cannot activate them in Poolday. |
| X `/x` | Stage and evaluate candidate methods and policies in Shadow. It cannot use its own candidate as the sole evaluator. |

Promotion requires frozen evidence, evaluator separation, human approval,
Poolday-owned configuration and user contracts, prospective operational proof,
and a tested revocation and rollback path.

The implemented internal contract in
[`scientific-policy-promotion.js`](../../self/pool/scientific-policy-promotion.js)
hash-binds the Zero proposal, family-disjoint historical and prospective
cohort, X evaluator, paired raw observations, full seven-role metric vector,
safety and rollback exercises, human approval, Poolday admission artifacts,
and every frozen prospective checkpoint. The proposer, evaluator, human
approver, and Poolday owner must be distinct. Its terminal result is eligibility
for Poolday-owned activation, not activation itself. The promotion schema and
its tests do not demonstrate a passing real candidate, a realized-value record
from a real room, or improved Research Room outcomes.

## Initial protein contract profile

The first profile accepts only explicitly public protein questions and public
evidence. ESM-2 embeddings provide the currently admitted representation layer.
Qualified imported evidence uses `poolday.public_protein_evidence/v1` across
sequence, structure, domain, annotation, publication, assay, negative-result,
and failed-attempt records. Assay findings distinguish positive, negative, and
ambiguous completed observations from failed attempts that claim no
observation. All forms remain provisional until independent review. Signed
laboratory qualification profiles bind declared institution, versioned
capability evidence, protocol custody, safety limits, availability, consent,
and conflicts, but do not establish external authorization or capability.
Current work orders bind their protocol, controls, conditions, readouts,
normalization, planned analysis, named failure policy, custody, blinding, and
public publication scope before a qualified laboratory may claim them. The
order also freezes multiple required replication-independence dimensions.
Signed outcomes bind institution, instrument, sample, preparation, and analysis
execution identities; a replication link is rejected unless every declared
dimension differs under the same protocol. These signed comparisons do not
prove physical independence. The order remains unallocated and confers no
authority.

The current order schema additionally permits only the declared public,
non-pathogenic, non-clinical lane, explicitly public synthetic or
public-reference samples, independent human safety review, and no medical use,
private samples, biological-interpretation authority, or laboratory authority.
Laboratory claims must match the exact safety classification. These are
machine-checked declarations, not proof of biosafety or operator conduct.
Other model views, private evidence, independently verified laboratory
qualification, calibrated action scoring, and closure authority require
separate Poolday admission and surface-claim evidence.

The implemented `poolday.protein_uncertainty_campaign_queue/v1` projection
orders exact public sequences by the count of four declared disagreement
dimensions: embeddings repeated under one exact model contract, normalized
public annotations at one scope and canonical residue interval, independent reviewer decisions, and comparable completed
experimental findings under the same canonical conditions. The browser
reverifies the bounded input records and independently replays the projection.
Cross-contract vectors are never compared, failed attempts never become
completed findings, and evidence volume cannot increase the score. The score is
an uncalibrated organizing heuristic, not biological importance, truth, action
value, or execution authority.

---

*Last updated: August 2026*
