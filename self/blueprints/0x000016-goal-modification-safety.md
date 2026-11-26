# Blueprint 0x000016: Safe Goal Modification Patterns

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** `/core/goal-modifier.js`

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000016-goal-modification-safety.md`
**Objective:** Let the agent refine and decompose its goal during a run without changing what the operator asked for.

**Prerequisites:** [0x000005](0x000005-state-management-architecture.md) (state), [0x000006](0x000006-pure-state-helpers.md) (pure state helpers), [0x000008](0x000008-agent-cognitive-cycle.md) (agent cycle)

This blueprint also holds the goal ideas of the retired [0x000052](0x000052-goal-panel.md) (goal panel) and [0x00005B](0x00005B-recursive-goal-decomposition.md) (recursive decomposition).

---

### 1. What exists

`StateManager.setGoal(goalText)` (`self/core/state-manager.js`) applies `StateHelpersPure.pushGoal` (`self/core/state-helpers-pure.js`): the first goal becomes `currentGoal` (`{ id, text, created, subgoals: [] }`) and every later call appends a subgoal. It saves state, records `SET_GOAL` through the audit logger when present, and emits `goal:set`. Nothing checks whether a subgoal serves the goal, and nothing distinguishes a refinement from a change of direction.

`goal-modifier.js` does not exist.

### 2. Proposed goal record

```json
{
  "seed": "the operator's goal, immutable for the run",
  "working": "the seed plus refinements",
  "subgoals": [{ "id": "...", "text": "...", "parent": null }],
  "history": [{ "cycle": 10, "kind": "refine | subgoal | pivot", "from": "...", "to": "...", "reason": "..." }]
}
```

### 3. Rules

1. The seed goal never changes during a run. Only the operator sets it.
2. The agent may add refinements and subgoals. Each is logged in `history` with its reason.
3. A pivot (a working goal that no longer follows from the seed) is a proposal. It takes effect only when the operator accepts it.
4. A model may score how well a change fits the seed. The score is shown to the operator and can block a change; it never applies one.
5. A reset returns the working goal to the seed and keeps the history.
6. Decomposition into parallel subtasks uses typed sub-agents from `self/core/worker-manager.js` ([0x000047](0x000047-worker-pool-parallelization.md)). The agent does not rewrite its own decomposition method without the same operator adoption required for any other change.

### 4. Verification conditions

- An attempt to change `seed` from agent code is refused.
- A pivot is not applied until the operator accepts it.
- Every refinement, subgoal and pivot appears in `history` with its cycle and reason.
