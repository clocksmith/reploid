# Blueprint 0x00000C: Sandboxed Tool Worker

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00000C-sandboxed-tool-worker.md`

## Retired design

This design proposed `/core/tool-worker.js`, a Web Worker that ran dynamically created tools away from the main thread. That module does not exist. Tools are loaded and run by the tool runner ([0x00000A](0x00000A-tool-runner-engine.md)). New tool code is checked by the Verification Worker before it loads, as described in [0x000015](0x000015-dynamic-tool-creation.md) and [0x000040](0x000040-verification-manager.md); the worker checks code, it does not host running tools.
