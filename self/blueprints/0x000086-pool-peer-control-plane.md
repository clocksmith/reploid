# Blueprint 0x000086: pool peer control plane

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-control-plane.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-control-plane.js`, `pool/peer-pack-job.js`, `pool/peer-pack-provider.js`, `pool/peer-pack-requester.js`, `pool/peer-pack-job-channel.js`, `pool/peer-pack-episode.js`

**Former Blueprint Paths:** `self/blueprints/0x000086-pool-peer-control-plane.md`
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

Complete Pack jobs reuse signed peer envelopes and assignment identities with
application-pinned models and explicit public-input consent. The provider must
authorize the request before execution and again before publishing output.
Installed adapters own operation semantics; adding an operation does not change
the job protocol. The legacy public catalog and ring planner remain their own
admission path.

The dedicated reliable WebRTC channel fragments signed messages into bounded
frames and accounts for application frame bytes. Whole-message signatures,
request and assignment hashes, and both stream digest chains are checked before
requester acceptance. Partial output is provisional. A frozen reference and
comparison policy bind the signed acceptance; archived verification uses its
original instant.

Cancellation invalidates requester acceptance immediately and requests provider
cooperation. The physical executor remains occupied while work drains. Signed
delivery retries reuse the same attempt and replay bounded retained responses.
A cancellation received before its delayed request prevents that request from
starting. These records are memory-resident and expire; this is bounded
at-least-once delivery, not exactly-once execution across process restarts.

See [complete Pack jobs](../../docs/poolday/complete-pack-jobs.md) for API,
limits, admission and evidence boundaries.

### 4. Verification Checklist
- [x] Prompt remains outside discovery messages
- [x] Assignment binds route, advert, profile, and limits
- [x] Agreement rejects receipts from a different route

*Last updated: September 2026*
