# Blueprint 0x000129: pool peer control plane

**Objective:** Describe implementation for pool/peer-control-plane.js.

**Target Upgrade:** pool/peer-control-plane.js

**Affected Artifacts:** /pool/peer-control-plane.js

---

### 1. Intent
Create and verify signed peer intents, provider adverts, route-bound assignments,
receipts, agreement, and ledger events without exposing prompt text during
discovery.

### 2. Architecture
The planner verifies participation roles, exact runtime and artifact identity,
provider limits, and policy eligibility. `artifact-router.js` returns a
deterministic route decision. Its hash and the provider advert/profile identity
are included in every assignment and receipt.

### 3. Implementation Notes
Legacy unsigned participation claims are accepted only by explicitly compatible
peer message fixtures. Hosted provider and requester routes require signed
claims. Receipt agreement rejects route-hash drift.

### 4. Verification Checklist
- [x] Prompt remains outside discovery messages
- [x] Assignment binds route, advert, profile, and limits
- [x] Agreement rejects receipts from a different route

*Last updated: July 2026*
