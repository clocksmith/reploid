# Blueprint 0x000150: pool adapter pack publisher

**Objective:** Convert one human-promoted NeuralCompiler entry into an immutable Poolday adapter pack.

**Target Upgrade:** pool/adapter-pack-publisher.js

**Affected Artifacts:** /pool/adapter-pack-publisher.js

---

### 1. Intent
Bridge local promotion evidence into the transport-neutral pack contract. This
module builds and seals a pack; it does not publish network metadata or grant
execution authority.

### 2. Architecture
Read the trained-adapter admission record and hash-bound human approval, verify
their adapter and evidence identities, then call `sealAdapterPack()` with exact
base-model, runtime, distribution, and runtime-manifest inputs.

### 3. Implementation Notes
Reject missing promotion, mismatched adapter hashes, or a human approval that
does not bind the Doppler and Gamma receipts. Signed network publication belongs
to `adapter-publication.js`.

### 4. Verification Checklist
- [x] Shadow entries cannot be packed
- [x] Human approval and evidence hashes are revalidated
- [x] Pack construction and network publication remain separate

*Last updated: July 2026*
