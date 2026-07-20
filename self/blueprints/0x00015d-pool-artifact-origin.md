# Blueprint 0x00015d: pool artifact origin

**Objective:** Validate immutable adapter origins before acquisition or signed delivery.

**Target Upgrade:** pool/artifact-origin.js

**Affected Artifacts:** /pool/artifact-origin.js

---

### 1. Intent

Represent public Hugging Face objects and private generation-bound GCS objects
without storing temporary signed URLs in durable adapter records.

### 2. Architecture

Origin validation requires an immutable repository revision for Hugging Face or
an exact object generation for GCS. Paths reject traversal, empty segments, and
backslashes. Acquisition code compares the requested origin with the signed
AdapterPack origin before fetching bytes.

### 3. Implementation Notes

Signed delivery URLs are assignment-bound and transient. Receipts retain the
stable origin identity, artifact digest, and acquisition source instead of the
credential-bearing URL.

### 4. Verification Checklist
- [x] Immutable public and private origins have distinct validation
- [x] Path injection and mutable revisions fail closed
- [x] Private delivery retains generation identity

*Last updated: July 2026*
