# Blueprint 0x00015c: pool adapter canary publication

**Objective:** Publish signed adapter runtime evidence without making an unpromoted adapter routable.

**Target Upgrade:** `pool/adapter-canary-publication.js`

**Affected Artifacts:** `/pool/adapter-canary-publication.js`, `/pool/adapter-canaries`

---

### 1. Contract

`reploid.pool.adapter-canary-publication/v1` binds:

- the immutable custody registry and artifact bytes;
- the exact base-model and conversion identity;
- the Doppler package version and npm integrity;
- one Chromium/WebGPU runtime receipt;
- the publisher identity and signature;
- a claim boundary that excludes model quality and promotion.

The schema requires `routable: false` and `promotion.state: canary_only`. It
forbids `pack`, `packHash`, and `adapterRequirement`. No function converts a
canary publication into a provider advertisement or assignment requirement.

### 2. Storage And Routes

Canaries use the separate `adapter_canary_publications` collection.

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/pool/adapter-canaries` | Verify signature and publisher role, then store immutable evidence |
| `GET` | `/pool/adapter-canaries` | List public canary evidence |
| `GET` | `/pool/adapter-canaries/:publicationHash` | Read one immutable publication |

Normal `/pool/adapters` routes continue to require a promoted AdapterPack and
human promotion receipt.

### 3. Runtime Gate

`scripts/run-adapter-runtime-canary.js` loads the exact hosted Qwen artifact in
Chromium, captures base logits, activates the exact NER adapter, proves changed
finite logits and valid structured output, unloads the adapter, unloads the
model, and writes a receipt. This proves runtime interoperability only.

### 4. Verification Checklist

- [x] Contract rejects routable fields and quality promotion
- [x] Store and routes remain separate from AdapterPack routing
- [x] Publisher signature and exact artifact identities are verified
- [x] Focused contract, route, and SDK tests cover the boundary

*Last updated: July 2026*
