# Blueprint 0x000125: pool model contract

**Objective:** Select only enabled, immutable model artifacts with an explicit workload contract.

**Target Upgrade:** pool/model-contract.js

**Affected Artifacts:** /pool/model-contract.js

---

### 1. Intent
Keep model identity, supported workloads, execution modes, WebGPU requirements,
sequence capabilities, and adapter compatibility in one catalog-owned
contract. Unknown identities and undeclared workloads fail closed.

### 2. Architecture
A catalog model may support text generation, embedding,
`sequence.embedding.v1`, or `sequence.masked_logits.v1`. Each workload maps to
one full-model browser execution mode. Sequence requests additionally bind an
alphabet, input hash and length, disclosure class, sensitivity, and bounded
output selection.

### 3. Implementation Notes
Biological models stay outside the enabled catalog until their exact Doppler
release, hosted manifest, tokenizer, shards, hashes, and browser receipts are
qualified. Adding a workload name without those artifacts is not support.
Model splitting, KV sharding, and distributed attention remain rejected.

### 4. Verification Checklist
- [x] Multi-workload capability checks are explicit
- [x] Sequence execution mode is deterministic
- [x] Sequence requests validate against model capability
- [x] Adapter requirements bind the exact base model and manifest

*Last updated: July 2026*
