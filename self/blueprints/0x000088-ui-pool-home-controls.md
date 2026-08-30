# Blueprint 0x000088: ui pool home controls

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/pool-home/controls.js`, `/self/ui/pool-home/index.js`, `/self/ui/pool-home/view.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/pool-home/controls.js`, `ui/pool-home/index.js`

**Former Blueprint Paths:** `self/blueprints/0x000088-ui-pool-home-controls.md`
**Objective:** Describe implementation for ui/pool-home/controls.js.

**Target Upgrade:** ui/pool-home/controls.js

**Affected Artifacts:** /ui/pool-home/controls.js, /ui/pool-home/view.js,
/ui/pool-home/index.js, /styles/poolday.css, /pool/pool-config.json

---

### 1. Intent
Bind Run a model, Share compute, and Recent jobs controls to the Poolday contracts they
represent. Workload lanes must change submitted job requirements, not only
presentation state.

### 2. Architecture
Home and Run share one peer-job submission boundary. The adapter lane resolves
a signed publication for the exact selected base model, requires an explicit
pack selection, and lets the requester client create the prompt-bound approval.
Contribute advertises only public packs it can acquire and activate through the
provider client.
Request, Contribute, and Both controls persist one signed participation profile.
Contribution restarts when the signed profile changes so stale adverts cannot
continue under old limits.

Home is one focused Pack job. It shows the enabled signed Doppler Pack, input,
peer-disclosure confirmation, and one Run model action. Independent checking,
research intent, optional Research Room publication, and adapter selection stay
under one Advanced details disclosure. Share compute shows the eligible Pack,
sharing state, and one Start sharing action; limits, readiness, participation,
and debug events stay under Advanced details. Recent jobs leads with the job
ledger; Research Room and protocol machinery stay under Advanced details. The
legacy `/ask`, `/history`, and `/network` paths remain compatibility aliases.

The topology shares its WebGPU device evidence with a bounded capability probe.
The probe combines supported limits with a short arithmetic kernel and assigns
Basic, Standard, Advanced, or High capacity. Model contracts declare a minimum
score, so the assessment controls provider-model eligibility and contribution
budgets instead of acting as a decorative benchmark. Unsupported WebGPU is a
separate state and cannot start a provider.

### 3. Implementation Notes
Home selects the enabled ESM-2 35M sequence artifact and submits the raw sequence
plus the governed sequence request over the peer-room input path. The Request
route retains the extended contract controls for users who need them.
Adapter registry failure or an empty exact-model population fails closed.
Runtime adapter support and an empty publication registry remain distinct
technical states, but an unavailable adapter mode is not rendered as an
actionable composer lane. The composer reveals its secondary Adapter mode only
when registry discovery finds a promoted pack for the selected text model.
The Model Pack control reaches the signed job requirements. Independent check
reaches the selected routing and verification policy.
Only enforceable controls are exposed: concurrency, output tokens, adapter cache,
artifact relay, result verification, and advertised network capacity.
Capability thresholds are conservative when the kernel cannot be measured.
Rechecking does not load model weights, and contribution clamps the signed
advert to both the person's limits and the measured tier defaults.

Primary navigation remains a compact horizontal shell on desktop and mobile.
It contains exactly Run a model, Share compute, Recent jobs, and a subordinate
network-availability indicator.

### 4. Verification Checklist
- [x] Adapter selection reaches peer job model requirements
- [x] Requester approval remains prompt- and model-bound
- [x] Base-model-only providers cannot capture adapter work
- [x] Request-only mode cannot create a provider delegation
- [x] Visible limits reach the signed advert and assignment gate
- [x] Activity views preserve prompt and model state
- [x] WebGPU evidence produces one of four capacity tiers
- [x] Provider model options enforce declared minimum capability scores
- [x] Desktop, laptop, and mobile layouts retain all primary actions
- [x] Home input, Model Pack, and Independent check reach the submitted peer job
- [x] Sequence selects ESM-2 and submits a public protein sequence request
- [x] Adapter empty state distinguishes runtime support from pack publication
- [x] First-time visitors can run the enabled Pack without opening Advanced details
- [x] Home does not render topology or room-governance detail before the primary task
- [x] Primary navigation exposes exactly three product destinations
- [x] Research and protocol controls remain contextual Advanced details
- [x] Share compute uses one Start/Stop sharing control

*Last updated: August 2026*
