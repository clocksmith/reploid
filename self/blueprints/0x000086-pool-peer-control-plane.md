# Blueprint 0x000086: pool peer control plane

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-control-plane.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-control-plane.js`, `pool/peer-pack-job.js`, `pool/peer-pack-job-policy.js`, `pool/peer-pack-provider.js`, `pool/peer-pack-requester.js`, `pool/peer-pack-job-channel.js`, `pool/peer-pack-episode.js`, `pool/operation-acceptance.js`, `pool/operation-room-network.js`, `pool/operation-participation.js`, `infrastructure/pack-job-storage.js`

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
requester acceptance. Partial output is provisional. Verification jobs bind a frozen reference and
comparison policy. Ordinary generation binds execution identity and policy without
a reference answer; acceptance does not claim correctness. Archived verification
uses its original instant.

The v2 job intent binds its numbered attempt, exact adapter set, input class,
resolved operation definition, comparison rules and remote-job policy. The
signed archive retains those policy snapshots and digests. Live admission uses
current resolved configuration; offline verification restores the original
rules with a compatible installed adapter implementation. Legacy v1 jobs remain
verifiable offline, without authorizing new v1 execution.

The v3 intent adds declared resource requirements and a deterministic provider
plan. Its signed advertisements carry observed capabilities and budgets. The
control-plane facade exposes normalized operation signing and provider planning
alongside the legacy catalog protocol. The requester client can prepare a job
before the room connects and then send that exact envelope. Live v3 admission
recomputes the plan from its signed candidates and current resolved policy;
offline v2 verification retains its original policy semantics.

`pool-config.json.peerJobs` owns retry, protocol and persistence bounds.
`peer-pack-job-policy.js` validates and freezes that configuration. Infrastructure
receives a resolved persistence policy; it does not choose domain policy.
The journal commits `accepted` before executor preparation and `running` through
the hook immediately preceding public Doppler `executeOperation()`. Completion
and cancellation commit before delivery. Failed or abandoned runs become
`interrupted`; deadlines become `expired`, retained until the configured cleanup
instant. A new run requires a new numbered attempt. Declaration siblings expose
the policy, attempt binding and six-state record contracts.

Cancellation invalidates requester acceptance immediately and requests provider
cooperation. The physical executor remains occupied while work drains. Signed
delivery retries reuse the same attempt and replay bounded retained responses.
A cancellation received before its delayed request prevents that request from
starting. Infrastructure persists atomic attempt claims and signed responses in
native IndexedDB before execution and delivery. A replacement writer fences
unfinished work and emits a failure after replaying the verified partial stream;
it cannot rerun that attempt. Completed streams replay after signature and
operation verification. Storage corruption or exhaustion denies execution.
Browser storage and key continuity bound recovery; eviction, deletion and
identity replacement remain outside this guarantee. Delivery remains bounded
at-least-once, without exactly-once execution or immediate GPU termination claims.

See [complete Pack jobs](../../docs/poolday/complete-pack-jobs.md) for API,
limits, admission and evidence boundaries.

### 4. Verification Checklist
- [x] Prompt remains outside discovery messages
- [x] Assignment binds route, advert, profile, and limits
- [x] Agreement rejects receipts from a different route

*Last updated: September 2026*

The v4 intent resolves exact signed adapter publications and base identities before
planning. The provider checks current publication admission before acquisition,
before operation execution, before acceptance and before durable replay. Adapter
bytes reuse the existing authorized custody owner and persist by verified chunk.
Doppler owns activation, tensor application, cleanup and adapter execution identity.
The room composition reuses existing rendezvous, signing, WebRTC and framing.
A signed connection ticket contains identities only; task text travels through
the data channel after the requester has approved the exact task.
