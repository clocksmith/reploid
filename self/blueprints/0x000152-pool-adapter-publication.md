# Blueprint 0x000152: pool adapter publication

**Objective:** Govern adapter publication, requester consent, and revocation with separate signatures.

**Target Upgrade:** pool/adapter-publication.js

**Affected Artifacts:** /pool/adapter-publication.js

---

### 1. Intent
Make a promoted pack discoverable without letting discovery authorize its use.
Publisher identity, requester approval, and revocation remain independent
artifacts with independent signature domains.

### 2. Architecture
A publication embeds the verified pack and publisher metadata. A use approval
binds its hashes to one requester, prompt, and base model. A revocation binds the
publisher to the publication it withdraws.

### 3. Implementation Notes
Registry timestamps and revocation projection are not part of the immutable
publication signature. The signed revocation is the authority for changing
registry state.

### 4. Verification Checklist
- [x] Publications require promoted packs
- [x] Use approval is prompt- and model-bound
- [x] Revocation cannot be forged by a requester or provider

*Last updated: July 2026*
