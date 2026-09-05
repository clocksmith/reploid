# Blueprint 0x0000A8: Pool Evidence Network

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/discovery-action-value.js`, `/self/pool/evidence-network.js`, `/self/pool/inference-receipt.js`, `/self/pool/model-evidence-view.js`, `/self/pool/peer-room.js`, `/self/pool/research-cycle.js`, `/self/pool/sdk.js`, `/server/pool/firebase-store.js`, `/server/pool/routes.js`, `/server/pool/store.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/discovery-action-value.js`, `pool/evidence-network.js`, `pool/evidence-record-contract.js`, `pool/evidence-normalization.js`, `pool/evidence-records.js`, `pool/evidence-verification.js`, `pool/evidence-admission.js`, `pool/evidence-queries.js`, `pool/model-evidence-view.js`, `pool/peer-room.js`, `pool/research-cycle.js`, `pool/sdk.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A8-pool-evidence-network.md`
**Objective:** Preserve public protein research inputs, compute provenance, experimental outcomes, and human interpretation as separately signed immutable evidence, then derive governed Discovery Contract views without converting evidence into automatic truth.

**Target Upgrade:** pool/evidence-network.js

**Affected Artifacts:** /pool/evidence-network.js, /pool/inference-receipt.js, /pool/sdk.js, server/pool/routes.js, server/pool/store.js, server/pool/firebase-store.js

---

### 1. Intent
Make the product journey visible and executable: question, hypothesize, retrieve,
compute, review, experiment, replicate, evaluate, and reopen or close. Keep model
results, human claims, experimental outcomes, and scientific-policy evaluations
distinct.

### 2. Architecture
Domain-separated record kinds bind public submissions, receipt-backed results,
human claims, hypotheses, prior evidence, predictions, work orders, work claims,
outcomes, prospective cohorts, evaluations, and revocations. Record hashes
exclude only the signature and every mutation becomes a new linked record.
Coordinator GET routes expose public room evidence; publication stays
authenticated and role-bound.

`evidence-network.js` preserves the public named and default imports. Its
implementations are separated by responsibility: `evidence-record-contract.js`
owns kinds and shared identities; `evidence-normalization.js` owns field
normalization; `evidence-records.js` constructs signed records;
`evidence-verification.js` verifies them; `evidence-admission.js` applies review,
correction, revocation, and link rules; `evidence-queries.js` builds read-only
projections. These owners form an acyclic graph and never import the facade.
The research cycle consumes admission directly. None is a second evidence store.

### 3. Current Discovery Projection
The browser derives an evidence graph, text search, exact-model compatible cosine
similarity, accepted-evidence reranking, deterministic clustering, bounded task
proposals, approval state, question lifecycles, disagreement views, review state,
accepted memory, and quality or durability rewards. The governed cycle projects
the question, independent execution, provenance, disagreement, review, memory,
and next-question stages. These are rebuildable projections over signed records.

The Records workspace also projects per-question exact-model evidence. A result
binds its own exact model contract to its receipt while the signed submission
remains the question and sequence anchor. The projection joins model sources only
by those durable identities and by declared protein residue coordinates. It does
not compare raw embeddings, average vectors, or interpret tokenizer-local token
IDs as shared residue proposals. Until a signed shared semantic observation or an
adjudicated outcome exists, it explicitly reports agreement and disagreement as
not assessed rather than inferring either one.

### 4. Target Discovery Contract Projection
The target projection freezes one bounded question, competing hypotheses,
uncertainty, candidate next actions, predicted observations, falsifiers,
scientific-cost components, action-value estimates, outcomes, replication state,
and closure criteria. Ranking binds its policy, method, version, inputs, cost
assumptions, and calibration evidence. Early heuristic ranking stays labeled as
heuristic.

The canonical field and lifecycle contract lives in
[`docs/poolday/discovery-contract.md`](../../docs/poolday/discovery-contract.md).
This blueprint does not mark target scoring or closure capabilities as
implemented.

### 5. Trust Boundary
Compute receipts do not prove honest hardware. Human claims do not become model
facts. Experimental outcomes do not become biological truth. Public vectors
require explicit publication consent. Similarity rejects model, artifact,
runtime, workload, execution-mode, or dimension mismatches. Review and
replication claims require the declared independence evidence. A signed record
is eligible to change a projection; it does not change the projection merely by
existing.

### 6. Verification Checklist
- [x] Signed records fail verification after content mutation
- [x] Result and claim edges remain inspectable
- [x] Similarity excludes incompatible embeddings
- [x] Cross-model Records projection preserves exact-contract isolation and reports unassessed agreement explicitly
- [x] Discovery work remains proposed until separately approved
- [x] Signed task approval binds the exact projected task contract
- [x] Evidence rewards require independent acceptance and durability
- [x] Reusable compute memory requires distinct receipt and provider identities
- [x] Independent execution is derived only from embedded provider-signed receipts with distinct provider identities and keys
- [x] Authentic peer agreements can publish v2 research results without inventing a server-verifier decision
- [x] Signed v1 history remains inspectable but cannot inherit v2 execution or approval claims
- [x] Coordinator publication is authenticated and public discovery is read-only
- [x] Advisory next-action ranking binds its heuristic policy, version, input records, and separate scientific-cost components without allocating work or claiming calibration
- [ ] Calibrated action-value estimates bind replayable methods, inputs, cost assumptions, and frozen evaluation evidence
- [ ] Candidate actions compare uncertainty reduction against declared scientific cost
- [ ] Replication and closure use predeclared independent evidence criteria
- [ ] Scientific-policy promotion measures prospective performance against a frozen baseline

*Last updated: August 2026*
