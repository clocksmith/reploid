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
- exact receipt-backed result provenance and distinct-receipt reproduction
  checks;
- independent review states for acceptance, rejection, revision, replication,
  and disputed reviewer decisions;
- fail-closed accepted room memory with correction and revocation exclusion;
- governance actions over provisional records;
- scientific actions whose `basisHashes` are restricted to accepted memory;
- a deterministic next-question brief with explicit uncertainty, human
  approval, and no execution authority.

The projection is defined by
[`research-cycle.js`](../../self/pool/research-cycle.js), with record and link
invariants in [`evidence-network.js`](../../self/pool/evidence-network.js).
Signed contract checkpoints, calibrated information gain, complete laboratory
independence, closure, and policy promotion remain target work.

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
| `parentRevisionHashes` | Prior revisions merged or superseded by this version. |
| `roomId` | Poolday evidence room that owns publication and hydration scope. |
| `questionHash` | Signed question record that anchors the contract. |
| `policyId` | Poolday admission and evidence policy used for this revision. |
| `projectionId` | Exact projection implementation and version. |
| `inputRecordHashes` | Complete ordered input set for deterministic replay. |
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

An action can request a computation, retrieval, critique, independent review,
perturbation analysis, assay, structural experiment, or replication. It binds:

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

Early systems without calibrated information-gain estimates must label their
ranking as a heuristic. They must retain the raw features needed to compare the
heuristic against future calibrated policies.

## Measured improvement

A completed contract can enter a frozen historical or prospective evaluation
cohort. The cohort binds questions, candidate policies, baseline policy, hidden
or future outcomes, cost accounting, and metrics before evaluation.

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

## Initial protein contract profile

The first profile accepts only explicitly public protein questions and public
evidence. ESM-2 embeddings provide the currently admitted representation layer.
Other model views, private evidence, laboratory work, calibrated action scoring,
and closure authority require separate Poolday admission and surface-claim
evidence.

The profile prioritizes questions where compatible model outputs, public
annotations, reviewers, or experiments disagree. Cases where every available
source agrees can still enter the network, but agreement alone does not make the
case informative or closed.

---

*Last updated: August 2026*
