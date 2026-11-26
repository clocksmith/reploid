# Blueprint 0x000036: Tool Documentation Generator

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000036-tool-documentation-generator.md`

## Retired design

This design proposed `/capabilities/cognition/tool-doc-generator.js`, which turned tool schemas into Markdown reference pages under `/docs/tools/`. That module does not exist. Tool schemas are held by `self/core/schema-registry.js` ([0x00006B](0x00006B-schema-registry.md)), and the agent lists them at run time with `self/tools/ListTools.js`. No current blueprint covers generated tool documentation.
