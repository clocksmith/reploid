# Blueprint 0x000050: Sentinel Finite State Machine

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000050-sentinel-fsm.md`

## Retired design

This design proposed `/core/sentinel-fsm.js`, a finite-state machine that drove a Sentinel agent through fixed states so that changes could not be applied before approval. That module does not exist, and no Sentinel code exists in the repository. The agent cycle is [0x000008](0x000008-agent-cognitive-cycle.md); approval gates are [0x000049](0x000049-hitl-controller.md).
