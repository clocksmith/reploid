# Blueprint 0x000010: Static Tool Manifest

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000010-static-tool-manifest.md`

## Retired design

This design proposed `/config/data-tools-static.js`, a static manifest that declared the agent's built-in read tools. That file does not exist and there is no static tool manifest: `self/core/tool-runner.js` loads every tool as a module from `/tools/`, as described in [0x00000A](0x00000A-tool-runner-engine.md).
