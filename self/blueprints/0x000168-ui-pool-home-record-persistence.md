# Blueprint 0x000168: ui pool home record persistence

**Objective:** Isolate room-scoped Poolday record persistence from rendering.

**Target Upgrade:** ui/pool-home/record-persistence.js

**Affected Artifacts:** /ui/pool-home/record-persistence.js

---

### 1. Intent
Load and persist receipt rows and peer events through an injected storage provider while preserving stable ledger collection identities.

### 2. Architecture
The adapter owns storage keys, room transitions, limits, legacy peer-ledger migration, and event-hash rebuilding. The view owns presentation.

### 3. Implementation Notes
Storage failures degrade to empty/no-op behavior for hardened browser contexts. Records never leak between room-scoped keys.

### 4. Verification Checklist
- [x] Receipt and peer ledgers remain room-isolated
- [x] Legacy local events migrate only for the default room
- [x] Pool record tests pass

*Last updated: July 2026*
