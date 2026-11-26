# Blueprint 0x00000D: UI Management

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00000D-ui-manager.md`

## Retired design

This design proposed `/ui/ui-manager.js`, one developer-console manager that rendered every panel, handled UI events and displayed agent state. That module does not exist, and the test results and production-readiness the old text reported came from no test or code in this repository. The panel blueprints that were meant to split it apart ([0x000051](0x000051-thought-panel.md) through [0x000056](0x000056-log-panel.md)) are retired with it. The current UI lives under `self/ui/`: the proto UI in `self/ui/proto/`, the Zero views in `self/ui/zero/`, the boot homes and wizard, and the capsule in `self/capsule/index.js`. `self/ui/CATSCAN.md` maps them.
