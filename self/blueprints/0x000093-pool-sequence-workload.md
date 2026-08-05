# Blueprint 0x000093: pool sequence workload

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/sequence-workload.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/sequence-workload.js`

**Former Blueprint Paths:** `self/blueprints/0x000093-pool-sequence-workload.md`
**Objective:** Define privacy-bounded protein sequence inputs and result agreement for Poolday.

**Target Upgrade:** pool/sequence-workload.js

**Affected Artifacts:** /pool/sequence-workload.js

---

### 1. Intent
Represent protein sequence work without leaking raw sequence data into peer
discovery, coordinator jobs, signed intents, receipts, or quorum records.

### 2. Architecture
The contract normalizes amino-acid text and exposes two workloads:
pooled/token embeddings and bounded masked-token logits. A request binds the
alphabet, sequence hash and length, sensitivity, disclosure rule, requested
outputs, token positions, and top-K bound. The agreement field for both
workloads is `sequenceResultHash`.

### 3. Implementation Notes
Public Poolday accepts only sequences explicitly classified as public. Raw
sequence bytes travel through the selected provider's WebRTC DataChannel. A
different governed contract is required for private, medical, or proprietary
sequence data.

### 4. Verification Checklist
- [x] Normalization and alphabet validation fail closed
- [x] Sequence requests contain no raw input
- [x] Masked-logit output is bounded
- [x] Coordinator prompt submission rejects sequence workloads

*Last updated: July 2026*
