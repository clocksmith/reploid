# Blueprint 0x000148: Zero Trace View

**Objective:** Keep Zero trace cards mapped to runtime phases without duplicating controller logic.

**Target Upgrade:** ui/zero/trace-view.js

**Affected Artifacts:** /ui/zero/trace-view.js

---

### 1. Intent
`ui/zero/trace-view.js` owns the trace card model for the Zero runtime UI. It converts runtime events into four operator-facing card types:

- Model Input: context sent to the provider, shown as deltas instead of repeating the full prompt.
- Model Response: text returned by the provider, including tool requests. This is not execution.
- Tool Run: actual tool execution, ordered results, failures, and durations.
- Runtime Event: provider, throttle, cooldown, warning, and error state.

The split prevents Decision/Action overlap: a model response may request a tool, but only a tool run executes it.

### 2. Architecture
The module exports `createZeroTraceView()`. The factory receives HTML escaping and truncation helpers from the UI controller, then keeps trace-local state for:

- model context delta snapshots,
- streaming response aggregation,
- per-cycle tool run state,
- per-cycle runtime status state,
- expanded trace row keys,
- scroll anchoring.

`ui/zero/index.js` remains the page controller. It subscribes to EventBus events, updates runtime strip state, and delegates trace rendering to this module.

### 3. Implementation Notes
- Do not render the initial system prompt as its own card.
- Preserve expanded rows when new rows render above them.
- Preserve the visible scroll anchor during trace updates.
- Keep failed Tool Run cards open; collapse successful tool runs.
- Keep Model Response summaries focused on requested tool kinds or DONE/PARK/IDLE directives.
- Keep Tool Run bodies focused on executed tool results, not model text.

### 4. Verification Checklist
- [x] Zero UI tests assert Model Input, Model Response, Tool Run, and Runtime Event cards.
- [x] Zero UI tests assert context deltas, preserved expansion, preserved scroll anchor, and ordered tool results.
- [x] Module verifier requires this file in VFS manifest and blueprint registry.

*Last updated: July 2026*
