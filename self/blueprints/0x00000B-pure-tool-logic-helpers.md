# Blueprint 0x00000B: Pure Tool Logic Helpers

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00000B-pure-tool-logic-helpers.md`

## Retired design

This design proposed `/core/tool-runner-pure-helpers.js`, a pure module that converted internal tool definitions into the JSON schemas provider APIs expect. That module does not exist. Tool schemas are held by `self/core/schema-registry.js` ([0x00006B](0x00006B-schema-registry.md)); tools are loaded and run by the tool runner ([0x00000A](0x00000A-tool-runner-engine.md)) and created as described in [0x000015](0x000015-dynamic-tool-creation.md).
