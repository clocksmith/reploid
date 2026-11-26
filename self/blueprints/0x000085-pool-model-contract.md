# Blueprint 0x000085: pool model contract

Owner: apps/poolday (see [apps/poolday/CATSCAN.md](../../apps/poolday/CATSCAN.md)). The source file lives in `shared/pool/` (served at `/self/pool/`), whose modules keep the [Poolday Evidence Runtime](../../apps/poolday/pool/CATSCAN.md) contracts ([shared/CATSCAN.md](../../shared/CATSCAN.md)).

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/model-contract.js`, `/self/pool/executable-pack.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/model-contract.js`, `pool/executable-pack.js`

**Former Blueprint Paths:** `self/blueprints/0x000085-pool-model-contract.md`
**Objective:** Select only enabled, immutable model artifacts with an explicit workload contract.

**Target Upgrade:** pool/model-contract.js

**Affected Artifacts:** /pool/model-contract.js

---

### 1. Intent
Keep model identity, supported workloads, execution modes, WebGPU requirements,
sequence capabilities, and adapter compatibility in one catalog-owned
contract. Unknown identities and undeclared workloads fail closed.
Required WebGPU features are checked before artifact download or model load.

### 2. Architecture
A catalog model may support text generation, embedding,
`sequence.embedding.v1`, or `sequence.masked_logits.v1`. Each workload maps to
one full-model browser execution mode. Sequence requests additionally bind an
alphabet, input hash and length, disclosure class, sensitivity, and bounded
output selection.

Signed executable Pack requirements bind schema, immutable root, envelope,
artifact closure, operation, and accepted TargetPlans. Public Doppler sessions
and receipts must match all fields. A caller-supplied Pack cannot self-admit an
unqualified catalog entry. Legacy model contracts remain identifiable as legacy.
The execution-contract registry also admits exact Capsule v2/v3 bindings through
their declared public API. Formats never alias identity fields or signed bytes.
The existing `executablePack` application field and peer protocol remain stable.

### 3. Implementation Notes
A biological model enters the enabled catalog only after its exact Doppler
release, hosted manifest, tokenizer, shards, hashes, and browser receipts are
qualified. ESM-2 35M (`esm2-t12-35m-ur50d-f32-af32`) meets that bar: it is
enabled and is the `launchModelId` in
[`shared/pool/pool-config.json`](../../shared/pool/pool-config.json). AMPLIFY
120M, ESM C 300M, and Nucleotide Transformer v2 50M remain disabled. Adding a
workload name without those artifacts is not support.
Every catalog workload maps to one full-model execution mode. Split routes,
where peers run different layer ranges of one model, are not yet qualified for
public use (see the [README](../../README.md) and [INTENT.md](../../INTENT.md));
KV sharding and distributed attention are outside this contract.
Gemma 3 270M requires `shader-f16` because its published kernel path has no
declared f32 capability remap; incompatible browsers must choose another model
instead of downloading an artifact they cannot execute. Its catalog
`artifactIdentity` mirrors only fields declared by the immutable hosted
manifest; richer provenance is not inferred at registration time.

### 4. Verification requirements
- [x] Multi-workload capability checks are explicit
- [x] Required WebGPU features block incompatible model loads before download
- [x] Sequence execution mode is deterministic
- [x] Sequence requests validate against model capability
- [x] Adapter requirements bind the exact base model and manifest

*Last updated: July 2026*
