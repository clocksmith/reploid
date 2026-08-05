# Blueprint 0x000087: ui pool home contribution state

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/pool-home/contribution-state.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/pool-home/contribution-state.js`

**Former Blueprint Paths:** `self/blueprints/0x000087-ui-pool-home-contribution-state.md`
**Objective:** Describe implementation for ui/pool-home/contribution-state.js.

**Target Upgrade:** ui/pool-home/contribution-state.js

**Affected Artifacts:** /ui/pool-home/contribution-state.js

---

### 1. Intent
Keep browser-local contribution state and recent receipt counters available to
the Poolday Home presentation.

### 2. Architecture
`contribution-state.js` owns the in-memory live state and local receipt history.
`view.js` renders that snapshot as readable status text and optional activity
metrics. The status text itself carries the restrained state color treatment.
Do not add a separate decorative state lamp or duplicate the written state.

### 3. Implementation Notes
- Render no global status when contribution is not enabled.
- Use the explicit labels `Starting`, `Available`, `Answering`, and
  `Needs attention`.
- Keep decoration subordinate to the readable label. State must remain clear
  without color.
- Show hour, day, and recent-work metrics only when data exists.

### 4. Verification Checklist
- [x] Non-contributing tabs render no global status
- [x] Contributing tabs expose state through text and `data-contribution-state`
- [x] Status presentation contains no redundant decorative state lamp
- [x] Optional metrics render only when populated

*Last updated: July 2026*
