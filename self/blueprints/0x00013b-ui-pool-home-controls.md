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

Home is one persistent workspace. The left drawer owns request configuration.
The right drawer owns device capability, contribution, room, and activity state.
Both drawers use the same vertical disclosure sections and do not switch the
center canvas to another page. The legacy routes remain compatible entry points.

The topology shares its WebGPU device evidence with a bounded capability probe.
The probe combines supported limits with a short arithmetic kernel and assigns
Basic, Standard, Advanced, or High capacity. Model contracts declare a minimum
score, so the assessment controls provider-model eligibility and contribution
budgets instead of acting as a decorative benchmark. Unsupported WebGPU is a
separate state and cannot start a provider.

### 3. Implementation Notes
Text remains the default lane. Sequence remains disabled until a qualified
Poolday sequence artifact exists. Adapter registry failure or an empty exact-
model population fails closed in the picker and never falls back to a base-model
job under an adapter label.
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
- [x] Request and compute drawers use consistent vertical disclosure sections

*Last updated: July 2026*
