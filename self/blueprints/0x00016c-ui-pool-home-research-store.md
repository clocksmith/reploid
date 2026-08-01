# Blueprint 0x00016c: Pool Home Research Store

**Objective:** Keep signed public research evidence available across browser reloads and coordinator outages without weakening immutability.

**Target Upgrade:** ui/pool-home/research-store.js

**Affected Artifacts:** /ui/pool-home/research-store.js, /ui/pool-home/research-view.js, /ui/pool-home/view.js, /ui/pool-home/controls.js

---

### 1. Intent
Preserve a signed submission before compute begins, merge coordinator evidence by record hash, and expose review, graph, discovery, task approval, and participation-quality projections in Records.

### 2. Architecture
The adapter owns room-scoped localStorage, signature verification, idempotent append, collision rejection, local-first publication, and remote hydration. The view owns rendering and signed human interactions.

### 3. Failure Behavior
Coordinator failure leaves a verified local record and reports synchronization as pending. Reload recovery carries the immutable submission with the preserved public sequence request. Invalid remote records never enter local state.

### 4. Verification Checklist
- [x] Records remain room-isolated
- [x] Publication persists locally before remote I/O
- [x] Duplicate hashes are idempotent
- [x] Remote evidence merges only after signature and hash validation
- [x] Human task execution requires an explicit signed approval

*Last updated: August 2026*
