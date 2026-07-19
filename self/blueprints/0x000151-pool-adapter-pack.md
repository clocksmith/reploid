# Blueprint 0x000151: pool adapter pack

**Objective:** Define and verify the immutable adapter artifact used across Poolday.

**Target Upgrade:** pool/adapter-pack.js

**Affected Artifacts:** /pool/adapter-pack.js, /pool/artifact-origin.js

---

### 1. Intent
Bind LoRA bytes and shape to one exact base model, runtime envelope, promotion
chain, distribution plan, and Doppler load manifest.

### 2. Architecture
`sealAdapterPack()` canonicalizes the contract and adds `packHash`.
`verifyAdapterPack()` replays the hash and promotion checks. Compact adapter
requirements let schedulers compare exact packs without carrying adapter bytes.
Version 2 binds both the training checkpoint and the served RDRR base: source
repository/revision, tokenizer, weight pack, manifest variant, and conversion
config digest. Distribution contains one immutable primary-origin descriptor
and explicit preservation mirrors.

### 3. Implementation Notes
Pack identity excludes mutable discovery state. `active`, `cached`, and
`fetchable` belong to provider requirements. Only `active` satisfies the runtime
execution gate.

### 4. Verification Checklist
- [x] Exact bytes, base model, runtime, and evidence are hash-bound
- [x] Shadow packs fail promoted verification
- [x] Runtime and discovery state use distinct predicates
- [x] Converted-base identity fails closed across requester, scheduler, and provider
- [x] Mutable origin URLs and silent mirror fallback are forbidden

*Last updated: July 2026*
