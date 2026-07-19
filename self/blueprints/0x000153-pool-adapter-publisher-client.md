# Blueprint 0x000153: pool adapter publisher client

**Objective:** Expose the governed publication lifecycle through the browser Pool SDK.

**Target Upgrade:** pool/adapter-publisher-client.js

**Affected Artifacts:** /pool/adapter-publisher-client.js

---

### 1. Intent
Give an authenticated publisher one small interface for signing, registering,
listing, fetching, and revoking adapter publications.

### 2. Architecture
The client obtains a publisher role identity and signing key, creates canonical
publication or revocation artifacts, then submits them through `sdk.js`. It
caches only publication metadata needed to construct a later revocation.

### 3. Implementation Notes
The client does not build packs, store adapter bytes, approve requester use, or
activate Doppler. Those authorities remain in their owning modules.

### 4. Verification Checklist
- [x] Publisher role and signing key are explicit
- [x] SDK routes carry signed artifacts only
- [x] Revocation resolves the original publication before signing

*Last updated: July 2026*
