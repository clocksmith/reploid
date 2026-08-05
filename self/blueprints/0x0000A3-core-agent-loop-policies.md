# Blueprint 0x0000A3: core agent loop policies

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/agent-loop-policies.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/agent-loop-policies.js`

**Former Blueprint Paths:** `self/blueprints/0x0000A3-core-agent-loop-policies.md`
**Objective:** Separate deterministic AgentLoop limits, context, throttle, retry, and wait policy from orchestration.

**Target Upgrade:** core/agent-loop-policies.js

**Affected Artifacts:** /core/agent-loop-policies.js

---

### 1. Intent
Normalize configuration aliases, enforce iteration and request envelopes, compact managed-provider context, and parse provider recovery signals.

### 2. Architecture
This dependency-free policy module accepts resolved values and returns data. AgentLoop owns storage, events, timers, model calls, and mutable run state.

### 3. Implementation Notes
Explicit sources use last-wins precedence before defaults. Context compaction retains system, goal, prior compaction, and recent-message anchors.

### 4. Verification Checklist
- [x] Legacy and canonical throttle keys resolve correctly
- [x] Managed context and iteration caps fail within declared bounds
- [x] AgentLoop integration and policy tests pass

*Last updated: July 2026*
