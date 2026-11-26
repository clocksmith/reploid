# Blueprint 0x000079: Python REPL Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000079-python-repl-panel.md`

## Retired design

This blueprint described a Pyodide-backed Python REPL panel at
`/self/ui/panels/python-repl-panel.js`. No such file exists, and the design conflicts with
the repository's JavaScript-only rule (`npm run verify:js-only`): Reploid ships no Python and
starts no Python runtime. It is retired and is not a work item. Interactive code execution
in `self/` goes through JavaScript tools and the verification sandbox described in
[`0x000040-verification-manager.md`](0x000040-verification-manager.md).
