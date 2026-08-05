# Blueprint 0x000098: pool artifact router

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/artifact-router.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/artifact-router.js`

**Former Blueprint Paths:** `self/blueprints/0x000098-pool-artifact-router.md`
**Objective:** Select an exact compatible provider and artifact source with a deterministic, receipt-bound verdict.

**Target Upgrade:** pool/artifact-router.js

**Affected Artifacts:** /pool/artifact-router.js

---

### 1. Intent
Turn model and adapter selection into an inspectable eligibility and ranking
decision rather than opportunistic file transfer.

### 2. Architecture
The router filters exact model, runtime, workload, adapter, policy, identity,
capacity, and resource constraints. It then ranks active, cached, and fetchable
artifacts before evidence, transfer time, latency, cost, and deterministic tie.

### 3. Constraints
Only fully promoted and published adapters are routable. Every provider still
runs the full model. Base-model peer shard relay is not part of the live path.

### 4. Verification Checklist
- [x] Rejected candidates retain stable reason codes
- [x] Candidate order does not change the decision hash
- [x] Assignment, acquisition, transfer, and receipt bind the route hash

*Last updated: July 2026*
