# Blueprint 0x0000A0: pool peer planning

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/peer-planning.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/peer-planning.js`, `pool/peer-capabilities.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A0-pool-peer-planning.md`
**Objective:** Isolate deterministic provider selection and ring-layout policy.

**Target Upgrade:** pool/peer-planning.js

**Affected Artifacts:** /pool/peer-planning.js

---

### 1. Intent
Normalize provider limits, group compatible runtimes, derive stable sort keys, and build hash-bound ring layouts.

### 2. Architecture
Planning consumes Pool policy, workload agreement, and canonical hash contracts. It returns data to assignment orchestration without signing, transport, or storage access.

Normalized operation planning consumes an exact work requirement, verified
provider observations, resolved JSON capability/assignment policy, an explicit
selection instant and a disabled historical projection. It returns an immutable
candidate assessment, rejection reasons, configured metric order, selected
provider, policy digest and requirement digest. It performs no live lookup,
signature verification, transport or execution. Identical inputs produce an
identical plan, independent of advertisement arrival order.

### 3. Implementation Notes
Provider ordering must be deterministic for the same intent and advert set. Homogeneous-runtime policies fail closed when the required group is unavailable.

`pool-config.json.peerJobs` owns capability bounds and assignment preferences.
Providers describe exact model, adapter and expert identities, operations,
permitted input classes, GPU identity, budgets and observed load. Unknown free
physical memory is explicit null. Policy chooses rejection or admission against
declared budgets; the plan preserves that uncertainty. Budgets are willingness,
not attested hardware capacity. Providers check advertised load against their
current executor and inbox state before signing.

`peer-pack-job.js` verifies signed observations before invoking this planner.
The v3 signed intent retains every candidate advertisement, the plan and policy
snapshot. Providers recompute selection before accepting the job. Old v1/v2
archives remain verifiable under their recorded protocol; they cannot start new
execution through the current admission path.

The room owner prepares a signed operation before establishing transport, then
delivers that exact job through `runPrepared`. Connection cancellation and late
resource cleanup use the declared deadline. No new transport implementation or
model-specific room scheduler is introduced.

### 4. Verification Checklist
- [x] Runtime grouping preserves deterministic precedence
- [x] Ring quorum and layout hashes derive from policy
- [x] Multi-provider and ring tests pass
- [x] Four operations and a fifth adapter use the shared operation planner
- [x] Configured residency/load ordering, stale observations, permissions,
  memory uncertainty, duplicate ordering and immutable inputs have focused tests
- [x] Real WebRTC exercises normalized room planning and durable execution;
  model outputs in that browser test remain synthetic

*Last updated: September 2026*
