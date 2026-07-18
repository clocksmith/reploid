# Blueprint 0x00014f: X Optimization Room

**Objective:** Make runtime-profile search, evidence review, promotion, and rollback legible in the X workspace.

**Target Upgrade:** ui/proto/optimization.js

**Affected Artifacts:** /ui/proto/optimization.js

---

### 1. Intent
Show the editable frozen contract, all completed candidates, parity verdicts, median improvement, confidence interval, variance, raw receipt data, and the active profile.

### 2. Architecture
The panel reads `DopplerOptimizer` state and subscribes to optimization events. Run and stop control the search. Promote stages the selected accepted candidate, invokes `ToolRunner.execute('Promote')`, and requests canary activation only after HITL approval succeeds.

### 3. Implementation Notes
- Rejected and failed attempts remain visible.
- Only accepted candidates enable Promote.
- Receipt JSON remains inspectable without rewriting the evidence into prose.
- The panel supports narrow columns with a horizontally scrollable result table.

### 4. Verification Checklist
- [x] Accepted and rejected rows render in unit tests
- [x] Malformed contract JSON cannot start a run
- [x] Promotion flows through ToolRunner and canary activation

*Last updated: July 2026*
