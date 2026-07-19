# Blueprint 0x000154: pool adapter registry

**Objective:** Maintain private publication metadata and a verified local adapter-byte cache.

**Target Upgrade:** pool/adapter-registry.js

**Affected Artifacts:** /pool/adapter-registry.js

---

### 1. Intent
Resolve adapter artifacts in cache, then peer, then primary-origin order without allowing
an unverified source to reach Doppler.

### 2. Architecture
The registry verifies signed publications, hashes bytes before caching, stores
acquisition evidence, and deletes bytes on signed revocation.
`acquireAdapterForAssignment()` checks the assignment requirement at every
source boundary. Browser discovery lists only signed public publications for an
exact base-model identity. The registry resolves the one signed primary origin,
uses the SDK to obtain assignment-bound private delivery when required, then
verifies bytes before caching. Preservation mirrors never become silent runtime
fallbacks.
Every acquisition record binds the assignment's route-decision hash.

### 3. Implementation Notes
The default registry is memory-local. Optional read/write/delete callbacks own
durable browser storage. Publication metadata is distinct from adapter bytes.

### 4. Verification Checklist
- [x] Corrupt or substituted bytes fail closed
- [x] Cache, peer, and origin produce receipt-visible source evidence
- [x] Revocation removes cached execution material
- [x] Ephemeral private URLs are not stored as artifact identity

*Last updated: July 2026*
