# Blueprint 0x000035: Inter-Tab Coordination

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000035-tab-coordination.md`

## Retired design

This design proposed `/capabilities/communication/tab-coordinator.js`, a BroadcastChannel protocol that kept several Reploid tabs synchronized and resolved write conflicts between them. That module does not exist; the state manager and stylesheet the old metadata cited do not implement it. No current blueprint covers inter-tab coordination.
