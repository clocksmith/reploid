# Blueprint 0x00005B: Recursive Goal Decomposition

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00005B-recursive-goal-decomposition.md`

## Retired design

This design proposed `recursive-goal-decomp.js` and `/capabilities/cognition/goal-decomposer.js`, which split goals into subgoals and then rewrote the splitting method from success patterns. Neither exists. Goal handling is consolidated in the Proposed [0x000016](0x000016-goal-modification-safety.md); typed sub-agents for parallel subtasks are spawned by `self/core/worker-manager.js` ([0x000047](0x000047-worker-pool-parallelization.md)).
