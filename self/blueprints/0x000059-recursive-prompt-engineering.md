# Blueprint 0x000059: Recursive Prompt Engineering

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000059-recursive-prompt-engineering.md`

## Retired design

This design proposed `recursive-prompt-engineer.js` and `/capabilities/cognition/prompt-evaluator.js`, which rewrote the agent's system prompt between runs based on scored results. Neither exists; the agent loop the old metadata cited does not implement it. Prompt evolution is [0x000067](0x000067-gepa-prompt-evolution.md) (GEPA), and prompt assembly is [0x000001](0x000001-system-prompt-architecture.md). An improved score informs the operator; it does not adopt a prompt.
