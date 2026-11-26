# Blueprint 0x000024: Metrics Proto & Charting

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000024-metrics-proto-visuals.md`

## Retired design

This design proposed `/ui/panels/metrics-proto.js`, Chart.js charts of performance metrics. That module does not exist. Metrics are collected by `self/capabilities/performance/performance-monitor.js` ([0x000023](0x000023-performance-monitoring-stack.md)), and the proto UI's telemetry view is `self/ui/proto/telemetry.js`.
