# Blueprint 0x000163: pool peer planning

**Objective:** Isolate deterministic provider selection and ring-layout policy.

**Target Upgrade:** pool/peer-planning.js

**Affected Artifacts:** /pool/peer-planning.js

---

### 1. Intent
Normalize provider limits, group compatible runtimes, derive stable sort keys, and build hash-bound ring layouts.

### 2. Architecture
Planning consumes Pool policy, workload agreement, and canonical hash contracts. It returns data to assignment orchestration without signing, transport, or storage access.

### 3. Implementation Notes
Provider ordering must be deterministic for the same intent and advert set. Homogeneous-runtime policies fail closed when the required group is unavailable.

### 4. Verification Checklist
- [x] Runtime grouping preserves deterministic precedence
- [x] Ring quorum and layout hashes derive from policy
- [x] Multi-provider and ring tests pass

*Last updated: July 2026*
