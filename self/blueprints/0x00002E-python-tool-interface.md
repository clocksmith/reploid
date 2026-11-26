# Blueprint 0x00002E: Python Tool Interface

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00002E-python-tool-interface.md`

## Retired design

This design proposed `/capabilities/cognition/python-tool.js`, a tool that exposed the Pyodide runtime of [0x00002D](0x00002D-pyodide-runtime-orchestration.md) to the agent. It does not exist. The design is retired, not planned, because it conflicts with the JavaScript-only rule in AGENTS.md, enforced by `npm run verify:js-only`. Agent tools are JavaScript modules loaded by the tool runner ([0x00000A](0x00000A-tool-runner-engine.md)).
