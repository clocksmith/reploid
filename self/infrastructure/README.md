# Infrastructure Modules

Purpose: Cross-cutting services for boot, runtime coordination, and observability.

## Scope

- Boot infrastructure shared across all genesis levels.
- Support services for safety, telemetry, and system governance.

**Genesis Levels:** TABULA, REFLECTION, and FULL

This directory contains support services and cross-cutting concerns. Modules span multiple genesis levels.

## Boot Infrastructure (Always Loaded)

| Module | File | Description |
|--------|------|-------------|
| DIContainer | `di-container.js` | Dependency injection container |
| BrowserAPIs | `browser-apis.js` | Web API integration layer |
| ReplayEngine | `replay-engine.js` | Execution replay for debugging |

## TABULA Level

| Module | File | Description |
|--------|------|-------------|
| CircuitBreaker | `circuit-breaker.js` | Failure isolation and fast-fail |
| ErrorStore | `error-store.js` | Error aggregation and tracking |
| EventBus | `event-bus.js` | Pub/sub event system |
| TelemetryTimeline | `telemetry-timeline.js` | Execution telemetry |
| ToolExecutor | `tool-executor.js` | Tool execution wrapper |

## REFLECTION Level

| Module | File | Description |
|--------|------|-------------|
| HITLController | `hitl-controller.js` | Human-in-the-loop approval gates |
| RateLimiter | `rate-limiter.js` | API call throttling |
| StreamParser | `stream-parser.js` | Real-time token streaming |

## FULL Level

| Module | File | Description |
|--------|------|-------------|
| AuditLogger | `audit-logger.js` | Security event logging |
| GenesisSnapshot | `genesis-snapshot.js` | Boot state preservation |
| Observability | `observability.js` | Mutations, decisions, and dashboard aggregation |
| TraceStore | `trace-store.js` | Persistent execution traces |

## Related

- [Genesis Levels Config](../config/genesis-levels.json)
- [Blueprint 0x000049: Dependency Injection Container](../blueprints/0x000049-dependency-injection-container.md)
- [Blueprint 0x000058: Event Bus Infrastructure](../blueprints/0x000058-event-bus-infrastructure.md)
