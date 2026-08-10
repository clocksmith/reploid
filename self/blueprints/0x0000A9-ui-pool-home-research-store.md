# Blueprint 0x0000A9: Pool Home Research Store

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/pool-home/controls.js`, `/self/ui/pool-home/requester-controls.js`, `/self/ui/pool-home/research-panels.js`, `/self/ui/pool-home/research-store.js`, `/self/ui/pool-home/research-view.js`, `/self/ui/pool-home/room-projection.js`, `/self/ui/pool-home/room-view.js`, `/self/ui/pool-home/view.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/pool-home/requester-controls.js`, `ui/pool-home/research-panels.js`, `ui/pool-home/research-store.js`, `ui/pool-home/research-view.js`, `ui/pool-home/room-projection.js`, `ui/pool-home/room-view.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A9-ui-pool-home-research-store.md`
**Objective:** Keep signed public research evidence available across browser reloads and coordinator outages without weakening immutability.

**Target Upgrade:** ui/pool-home/research-store.js

**Affected Artifacts:** /ui/pool-home/research-store.js, /ui/pool-home/research-view.js, /ui/pool-home/view.js, /ui/pool-home/controls.js

---

### 1. Intent
Preserve a signed submission before compute begins, merge coordinator evidence by record hash, and expose review, graph, discovery, task approval, and participation-quality projections in Records.

### 2. Architecture
The adapter owns room-scoped localStorage, signature verification, idempotent append, collision rejection, local-first publication, and remote hydration. The view owns rendering and signed human interactions.

### 3. Failure Behavior
Coordinator failure leaves a verified local record and reports synchronization as pending. Reload recovery carries the immutable submission with the preserved public sequence request. Invalid remote records never enter active local state. Rejected local or remote records are preserved in a room-scoped quarantine cache with their rejection reason instead of being silently deleted during hydration.
Verified local evidence renders as soon as local hydration completes; the
workspace does not wait for coordinator synchronization before exposing its
recoverable local history.

### 4. Verification Checklist
- [x] Records remain room-isolated
- [x] Publication persists locally before remote I/O
- [x] Duplicate hashes are idempotent
- [x] Remote evidence merges only after signature and hash validation
- [x] Human task execution requires an explicit signed approval bound to the
  exact current task contract
- [x] Accepted single-provider compute remains visible but outside room memory
- [x] Rejected hydration records remain recoverable in a separate quarantine cache
- [x] Local verified history renders before remote synchronization completes

*Last updated: August 2026*
