# Blueprint 0x00016b: Pool Evidence Network

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

### 3. Current Discovery Projection
The browser derives an evidence graph, text search, exact-model compatible cosine
similarity, accepted-evidence reranking, deterministic clustering, bounded task
proposals, approval state, question lifecycles, disagreement views, review state,
and quality or durability rewards. These are rebuildable projections over signed
records.

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
- [x] Discovery work remains proposed until separately approved
- [x] Evidence rewards require independent acceptance and durability
- [x] Coordinator publication is authenticated and public discovery is read-only
- [ ] Action-value estimates bind replayable methods, inputs, and cost assumptions
- [ ] Candidate actions compare uncertainty reduction against declared scientific cost
- [ ] Replication and closure use predeclared independent evidence criteria
- [ ] Scientific-policy promotion measures prospective performance against a frozen baseline

*Last updated: August 2026*
