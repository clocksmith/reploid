# Blueprint 0x000167: ui pool home network projection

**Objective:** Convert room relay summaries into a pure, render-independent network visual model.

**Target Upgrade:** ui/pool-home/network-projection.js

**Affected Artifacts:** /ui/pool-home/network-projection.js

---

### 1. Intent
Normalize peers, providers, messages, recent activity, availability, and simulation/hybrid/live mode.

### 2. Architecture
The projection consumes a relay summary and the declared visual node capacity. DOM updates and browser events remain in the view adapter.

### 3. Implementation Notes
Provider identities sort ahead of other peers, duplicate identities collapse, and unavailable summaries cannot report stale live counts.

### 4. Verification Checklist
- [x] Projection is deterministic and DOM-free
- [x] Simulation, hybrid, live, and unavailable states are covered
- [x] Pool navigation tests pass

*Last updated: July 2026*
