# Blueprint 0x000033: Tool Usage Analytics

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000033-tool-usage-analytics.md`

## Retired design

This design proposed `/capabilities/cognition/tool-analytics.js`, a module that tracked per-tool call counts, durations and failure rates. That module does not exist; the tool runner and stylesheet the old metadata cited do not implement it. Per-tool calls, time and errors are counted by `self/capabilities/performance/performance-monitor.js` from `agent:tool:end` events, described in [0x000023](0x000023-performance-monitoring-stack.md).
