# Blueprint 0x00009B: pool canonical json

Owner: apps/poolday (see [apps/poolday/CATSCAN.md](../../apps/poolday/CATSCAN.md)). The owned file `shared/pool/canonical-json.js` (served at `/self/pool/canonical-json.js`) is a one-line re-export of `shared/vendor/reploid/artifacts/canonical-json.js`, the delivered copy of the real implementation in [`packages/reploid/src/artifacts/canonical-json.js`](../../packages/reploid/src/artifacts/canonical-json.js). That directory has no CATSCAN of its own; see the [package CATSCAN](../../packages/reploid/CATSCAN.md) and [shared/CATSCAN.md](../../shared/CATSCAN.md) for how `vendor/` delivers package code.

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

### 4. Verification requirements
- [x] Browser and server use the same canonicalizer
- [x] Object keys sort recursively and arrays retain order
- [x] Pool contract and module-system verification pass

*Last updated: July 2026*
