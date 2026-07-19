# Blueprint 0x000122: pool inference receipt

**Objective:** Bind provider execution to an inspectable, workload-specific signed receipt.

**Target Upgrade:** pool/inference-receipt.js

**Affected Artifacts:** /pool/inference-receipt.js

---

### 1. Intent
Make model, runtime, input, output, adapter, device, and policy claims
independently verifiable without placing private input or unbounded output data
in the receipt.

### 2. Architecture
All workloads bind model and manifest identity, input and generation hashes,
transcript hash, provider signature, and runtime profile. Text adds output and
token hashes. Embedding adds `vectorHash`. Biological sequence work adds a
request hash, sequence metadata, per-output hashes, and
`sequenceResultHash`.

Adapter execution adds exact pack/publication identity, requester-use approval,
active state, and verified cache, peer, or origin acquisition evidence.

### 3. Implementation Notes
Quorum selects its agreement field from the workload. Raw prompts, sequences,
embedding vectors, token vectors, and logits are not signed receipt fields.
Requester acceptance binds the compact agreement, receipt set, and point split.

### 4. Verification Checklist
- [x] Receipt construction recomputes sequence-result identity
- [x] Browser and server verification require matching sequence evidence
- [x] Commit-reveal binds the workload-specific result hash
- [x] Adapter acquisition evidence remains mandatory

*Last updated: July 2026*
