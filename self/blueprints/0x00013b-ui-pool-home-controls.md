# Blueprint 0x00013b: ui pool home controls

**Objective:** Describe implementation for ui/pool-home/controls.js.

**Target Upgrade:** ui/pool-home/controls.js

**Affected Artifacts:** /ui/pool-home/controls.js, /ui/pool-home/view.js,
/ui/pool-home/index.js, /styles/poolday.css, /pool/pool-config.json

---

### 1. Intent
Bind Home, Run, Contribute, and Records controls to the Poolday contracts they
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

Home is one persistent workspace. The bottom composer owns the high-frequency
task choice and submission. It exposes Text and Protein before a visitor opens
either rail. The left Request drawer owns the lower-frequency request Model and
answer Checks. The right Network drawer owns current execution context:
Connection, This device, and Activity. Connection combines room and
participation because both define how the browser joins the network.
This device combines capability and sharing because the start/stop action must
remain beside its readiness, model, cache, and health feedback. Both drawers use
the same vertical disclosure sections and do not switch the center canvas to
another page. The legacy routes remain compatible entry points.

The topology shares its WebGPU device evidence with a bounded capability probe.
The probe combines supported limits with a short arithmetic kernel and assigns
Basic, Standard, Advanced, or High capacity. Model contracts declare a minimum
score, so the assessment controls provider-model eligibility and contribution
budgets instead of acting as a decorative benchmark. Unsupported WebGPU is a
separate state and cannot start a provider.

### 3. Implementation Notes
Text remains the default lane. Protein selects the enabled ESM-2 35M sequence
artifact, reveals explicit public-input confirmation beside the composer, and
submits the raw sequence plus the governed sequence request over the peer-room
input path.
Adapter registry failure or an empty exact-model population fails closed.
Runtime adapter support and an empty publication registry remain distinct
technical states, but an unavailable adapter mode is not rendered as an
actionable composer lane. The composer reveals its secondary Adapter mode only
when registry discovery finds a promoted pack for the selected text model.
Task selection controls its explanation, placeholder, eligible request models,
and conditional adapter or sequence field. The request Model control reaches
the signed job requirements. Checks reaches the selected routing and
verification policy. Collapsed section summaries expose the current selection
or state without duplicating the primary mode control.
Only enforceable controls are exposed: concurrency, output tokens, adapter cache,
artifact relay, result verification, and advertised network capacity.
Capability thresholds are conservative when the kernel cannot be measured.
Rechecking does not load model weights, and contribution clamps the signed
advert to both the person's limits and the measured tier defaults.

Both control drawers remain available beside the topology on large and small
laptops. Their sections collapse independently and retain their local disclosure
state. On phones the drawers become focused sheets while the composer remains
reachable above the canvas.

### 4. Verification Checklist
- [x] Adapter selection reaches peer job model requirements
- [x] Requester approval remains prompt- and model-bound
- [x] Base-model-only providers cannot capture adapter work
- [x] Request-only mode cannot create a provider delegation
- [x] Visible limits reach the signed advert and assignment gate
- [x] Activity views preserve the topology, lane, prompt, and model state
- [x] WebGPU evidence produces one of four capacity tiers
- [x] Provider model options enforce declared minimum capability scores
- [x] Desktop, laptop, and mobile layouts retain all primary actions
- [x] Request and Network drawers use consistent vertical disclosure sections
- [x] Composer Task, Request Model, and Checks reach the submitted peer job
- [x] Sequence selects ESM-2 and submits a public protein sequence request
- [x] Adapter empty state distinguishes runtime support from pack publication
- [x] First-time visitors can choose Text or Protein without opening a rail
- [x] Adapter mode appears only when a promoted exact-model pack is available
- [x] Room and participation share one Connection section
- [x] Device capability and sharing share one This device section
- [x] Collapsed rail summaries expose current selections and states

*Last updated: July 2026*
