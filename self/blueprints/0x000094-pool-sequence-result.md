# Blueprint 0x000094: pool sequence result

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/sequence-result.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/sequence-result.js`

**Former Blueprint Paths:** `self/blueprints/0x000094-pool-sequence-result.md`
**Objective:** Reduce Doppler biological-sequence tensors into bounded, verifiable Poolday results.

**Target Upgrade:** pool/sequence-result.js

**Affected Artifacts:** /pool/sequence-result.js

---

### 1. Intent
Validate the exact Doppler sequence-output contract before a provider signs a
receipt. Reject malformed shapes, model-alphabet mismatches, invalid tokens,
and non-finite values.

### 2. Architecture
The reducer hashes canonical little-endian Float32 vectors and token IDs. It
uses a bounded min-heap to select requested masked-token candidates without
copying full logits into a receipt. `sequenceResultHash` binds the compact
metadata and all tensor hashes used for peer agreement.

### 3. Implementation Notes
The requester may receive explicitly requested vectors over its selected peer
channel. Signed receipts contain hashes and dimensions, not raw sequences,
full vectors, or full logits.

### 4. Verification Checklist
- [x] Alphabet, token, and tensor shapes fail closed
- [x] Float32 hashing is deterministic
- [x] Masked-logit selection stays bounded by top-K
- [x] Full logits never enter signed receipts

*Last updated: July 2026*
