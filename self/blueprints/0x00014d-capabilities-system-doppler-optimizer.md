# Blueprint 0x00014d: Doppler Runtime Optimizer

**Objective:** Search runtime-owned Doppler configuration under a frozen parity and benchmark contract.

**Target Upgrade:** capabilities/system/doppler-optimizer.js

**Affected Artifacts:** /capabilities/system/doppler-optimizer.js

---

### 1. Intent
Persist every candidate, accepted or rejected receipt, selection decision, promotion descriptor, canary result, and rollback result. Doppler owns contract validation and measurement. Reploid owns orchestration and durable history.

### 2. Architecture
`DopplerToolbox` forwards the public Doppler tooling API. `DopplerOptimizer` enumerates candidates, evaluates them sequentially, and stores candidates under `/shadow/doppler` with receipts under `/artifacts/doppler`. A selected candidate becomes a hashed runtime-profile file. It does not become active until `Promote` succeeds and a fresh canary receipt accepts it.

### 3. Implementation Notes
- The v1 contract mutates runtime-owned config only. It rejects execution graphs, kernel paths, harness settings, and evaluator policy.
- One candidate failure produces a rejected attempt record and does not erase later candidates.
- The active pointer binds model, profile, candidate, and canary receipt hashes.
- Boot restores only pointers in `active` state. A stale `canary` pointer never activates implicitly.
- Canary rejection restores the previous pointer or the base runtime and writes a rollback receipt.

### 4. Verification Checklist
- [x] Candidate and receipt persistence has unit coverage
- [x] Evaluation failures remain visible and the search continues
- [x] Promotion requires exact candidate bytes and human approval
- [x] Canary acceptance and rollback have regression coverage

*Last updated: July 2026*
