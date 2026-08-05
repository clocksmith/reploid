# Blueprint 0x00009B: pool canonical json

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/canonical-json.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/canonical-json.js`

**Former Blueprint Paths:** `self/blueprints/0x00009B-pool-canonical-json.md`
**Objective:** Give browser and server receipt hashing one deterministic JSON serialization contract.

**Target Upgrade:** pool/canonical-json.js

**Affected Artifacts:** /pool/canonical-json.js

---

### 1. Intent
Serialize JSON-compatible values with recursively sorted object keys while preserving array order and native JSON scalar behavior.

### 2. Architecture
This dependency-free domain primitive is consumed by both browser receipt code and the Node hash adapter. Cryptographic hashing remains environment-owned.

### 3. Implementation Notes
Do not add browser or Node APIs. Any serialization change is a signed-record compatibility change and requires cross-environment hash tests.

### 4. Verification Checklist
- [x] Browser and server use the same canonicalizer
- [x] Object keys sort recursively and arrays retain order
- [x] Pool contract and module-system verification pass

*Last updated: July 2026*
