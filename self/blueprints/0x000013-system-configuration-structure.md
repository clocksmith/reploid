# Blueprint 0x000013: System Configuration Structure

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000013-system-configuration-structure.md`

## Retired design

This design proposed `/config/system-config.js`, one runtime configuration file the agent could edit to change its own behavior. That file does not exist. Configuration is split across `self/config/` (for example `genesis-levels.json` for module sets, `boot-modes.js` and `vfs-policy.js`); `self/config/CATSCAN.md` maps it. No current blueprint covers a single editable configuration.
