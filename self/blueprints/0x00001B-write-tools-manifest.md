# Blueprint 0x00001B: Write Tools Manifest

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00001B-write-tools-manifest.md`

## Retired design

This design proposed `/tools/tools-write.js`, a JSON manifest of the agent's write-capable tools. That file does not exist. Write tools such as `WriteFile.js`, `EditFile.js` and `CreateTool.js` are individual modules in `self/tools/`, loaded by the tool runner ([0x00000A](0x00000A-tool-runner-engine.md)). Tool creation is [0x000015](0x000015-dynamic-tool-creation.md), and the use of tools within a cycle is [0x000008](0x000008-agent-cognitive-cycle.md).
