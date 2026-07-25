# Blueprint 0x000160: pool peer agreement

**Objective:** Isolate receipt-to-assignment agreement rules from control-plane orchestration.

**Target Upgrade:** pool/peer-agreement.js

**Affected Artifacts:** /pool/peer-agreement.js

---

### 1. Intent
Select the workload agreement value and report every receipt field that diverges from its signed assignment.

### 2. Architecture
The module consumes model, signature-domain, sequence, and adapter contracts. The compatibility facade uses its pure checks before signature and quorum aggregation.

### 3. Implementation Notes
Agreement compares exact model and adapter identity, requires acquisition evidence, and applies workload-specific hash fields without transport or UI dependencies.

### 4. Verification Checklist
- [x] Assignment identity mismatches are explicit
- [x] Text and sequence agreement fields remain workload-specific
- [x] Peer control-plane regression tests pass

*Last updated: July 2026*
