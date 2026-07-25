# Blueprint 0x000161: pool peer ledger

**Objective:** Own signed peer ledger event creation and deterministic local projection.

**Target Upgrade:** pool/peer-ledger.js

**Affected Artifacts:** /pool/peer-ledger.js

---

### 1. Intent
Create credit, debit, and reputation messages only for accepted agreements and reduce an unordered event set without double counting.

### 2. Architecture
Ledger reason policy comes from Pool config; signing comes from the peer protocol. The reducer sorts and deduplicates before projecting points and reputation.

### 3. Implementation Notes
Event identity prefers the signed message hash and uses a stable semantic fallback only for legacy local records.

### 4. Verification Checklist
- [x] Accepted agreements create balanced provider/requester events
- [x] Duplicate events do not change projection
- [x] Local ledger UI and peer tests pass

*Last updated: July 2026*
