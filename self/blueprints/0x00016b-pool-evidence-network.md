# Blueprint 0x00016b: Pool Evidence Network

**Objective:** Preserve public protein research inputs, compute provenance, and human interpretation as separately signed immutable evidence, then derive useful governed discovery views.

**Target Upgrade:** pool/evidence-network.js

**Affected Artifacts:** /pool/evidence-network.js, /pool/inference-receipt.js, /pool/sdk.js, server/pool/routes.js, server/pool/store.js, server/pool/firebase-store.js

---

### 1. Intent
Make the complete product journey visible and executable: submit, compute, review, connect, and discover. Keep model results distinct from attributable human claims.

### 2. Architecture
Three domain-separated record kinds bind public submissions, receipt-backed results, and human claims. Record hashes exclude only the signature and every mutation becomes a new linked record. Coordinator GET routes expose public room evidence; publication stays authenticated and role-bound.

### 3. Discovery Projection
The browser derives an evidence graph, text search, exact-model compatible cosine similarity, accepted-evidence reranking, deterministic clustering, bounded task proposals, approval state, and quality/durability rewards. These are rebuildable projections over signed records.

### 4. Trust Boundary
Compute receipts do not prove honest hardware. Human claims do not become model facts. Public vectors require explicit publication consent. Similarity rejects model, artifact, runtime, workload, execution-mode, or dimension mismatches. Review acceptance requires an independent identity root.

### 5. Verification Checklist
- [x] Signed records fail verification after content mutation
- [x] Result and claim edges remain inspectable
- [x] Similarity excludes incompatible embeddings
- [x] Discovery work remains proposed until separately approved
- [x] Evidence rewards require independent acceptance and durability
- [x] Coordinator publication is authenticated and public discovery is read-only

*Last updated: August 2026*
