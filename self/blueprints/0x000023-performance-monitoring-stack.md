# Blueprint 0x000023: Performance Monitoring Stack

**Classification:** Canonical Full Specification

**Implementation Status:** In-Progress

**Verified Artifacts:** `/self/capabilities/performance/performance-monitor.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/performance/performance-monitor.js`

**Former Blueprint Paths:** `self/blueprints/0x000023-performance-monitoring-stack.md`
**Objective:** Keep in-session counts of tool calls, model calls, tokens, latency, errors and heap use, so the agent and the operator can see where a run spends time.

**Prerequisites:** [0x00004F](0x00004F-event-bus-infrastructure.md) (event bus), [0x000008](0x000008-agent-cognitive-cycle.md) (agent cycle)

This blueprint also covers the monitoring parts of the retired [0x000033](0x000033-tool-usage-analytics.md) (tool usage analytics) and [0x000034](0x000034-api-cost-tracker.md) (cost tracking). Token cost estimates are made by `self/infrastructure/observability.js` ([0x00006D](0x00006D-observability.md)); rate limits by [0x000029](0x000029-rate-limiting-strategies.md).

---

### 1. Module

`self/capabilities/performance/performance-monitor.js` registers `PerformanceMonitor` (genesis level `substrate`, dependencies `Utils`, `EventBus`, optional `TelemetryTimeline`). Its factory returns `{ init, getMetrics, getMemoryStats, getLLMStats, getReport, generateReport, destroy }`. All data is in memory and lost on reload.

### 2. Inputs

`init()` subscribes to three events:

| Event | Emitted by | Recorded |
| --- | --- | --- |
| `agent:tool:end` | `self/infrastructure/tool-executor.js` with `{ tool, cycle, workerId, durationMs, success }` | per tool: `calls`, `totalTime`, `errors` (when `success === false`) |
| `agent:error` | the agent loop | session error count |
| `llm:complete` | `packages/reploid/src/agent/lab-strategy-generation.js` with `{ model, provider, latency, inputTokens, outputTokens, tokens, ... }` | call count, token totals, last 50 latencies, last call time |

When `performance.memory` exists (Chromium), it samples heap size every 30 s and keeps the last 120 samples. Tool ends, errors and model completions are also written to `TelemetryTimeline` when that module is present.

### 3. Outputs

- `getMetrics()` returns `{ session: { uptime }, tools, errors }`.
- `getLLMStats()` returns `{ calls, tokens: { input, output, total }, avgLatency, errorRate, lastCall }`.
- `getMemoryStats()` returns `{ current, history, max }`.
- `getReport()` returns a short summary; `generateReport()` formats it as Markdown.
- `destroy()` stops heap sampling.

### 4. Known gaps

- Nothing increments the model error counter, so `errorRate` is always 0.
- `destroy()` does not remove the event subscriptions made by `init()`; calling `init()` twice double-counts.
- There is no charting view, no `tool:start` timing and no persistence. The metrics view of the retired [0x000024](0x000024-metrics-proto-visuals.md) does not exist.

### 5. Verification conditions

- One `agent:tool:end` with `success: false` adds one call and one error to that tool.
- `llm:complete` without `tokens` adds `inputTokens + outputTokens` to the total.
- After `destroy()`, no further heap samples are taken.
