# Blueprint 0x00002D: Pyodide Runtime Orchestration

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00002D-pyodide-runtime-orchestration.md`

## Retired design

This design proposed `/core/pyodide-runtime.js` and a Web Worker that ran Python through Pyodide. Neither exists. The design is retired, not planned, because it conflicts with the JavaScript-only rule in AGENTS.md (no Python files and no code that starts a Python runtime), enforced by `npm run verify:js-only`. Agent tools are JavaScript modules loaded by the tool runner ([0x00000A](0x00000A-tool-runner-engine.md)).
