# Blueprint 0x00009F: pool peer payload

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-payload.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-payload.js`

**Former Blueprint Paths:** `self/blueprints/0x00009F-pool-peer-payload.md`
**Objective:** Own creation and validation of assignment-bound peer input payloads.

**Target Upgrade:** pool/peer-payload.js

**Affected Artifacts:** /pool/peer-payload.js

---

### 1. Intent
Build prompt or sequence payloads with input hashes and reject payloads that do not match assignment, job, generation, or sequence contracts.

### 2. Architecture
The module depends only on Pool payload, receipt hash, model workload, sequence, and peer string contracts. Transport remains outside this layer.

### 3. Implementation Notes
Sequence normalization occurs before hashing. Validation returns all discovered reasons so callers can expose actionable failures.

### 4. Verification Checklist
- [x] Prompt and sequence hashes bind to assignments
- [x] Workload dispatch is explicit
- [x] Payload and sequence regression tests pass

*Last updated: July 2026*
