# Infrastructure Directory

**Purpose**: Support services for the REPLOID system.

## Contents

| File | Purpose |
|------|---------|
| `event-bus.js` | Pub/sub event system for module communication |
| `di-container.js` | Dependency injection container |
| `browser-apis.js` | Browser Web API integration |
| `rate-limiter.js` | API rate limiting |
| `audit-logger.js` | Security audit logging to VFS |
| `hitl-controller.js` | Human-in-the-loop oversight modes |
| `circuit-breaker.js` | Failure tracking and recovery |
| `observability.js` | Metrics and performance monitoring |

---

## Module Details

### event-bus.js

Central pub/sub for decoupled communication:

```javascript
EventBus.emit('agent:status', { state: 'RUNNING' });
EventBus.on('tool:file_written', (data) => { ... });
```

Key events: `agent:*`, `tool:*`, `worker:*`, `vfs:*`, `reflection:*`

### di-container.js

Dependency injection for module resolution:

```javascript
container.register('VFS', vfsInstance);
const vfs = container.resolve('VFS');
```

### hitl-controller.js

Human-in-the-loop oversight with multiple modes:

| Mode | Behavior |
|------|----------|
| **AUTONOMOUS** | No approval required |
| **HITL** | Queue actions for approval |
| **EVERY_N** | Checkpoint every N steps |

### audit-logger.js

Comprehensive execution logging:

- Tool calls with sanitized arguments
- Duration and success/failure status
- Persisted to `/.logs/audit/YYYY-MM-DD.jsonl`
- Exportable for compliance and debugging

### circuit-breaker.js

Failure tracking and automatic recovery:

- Track consecutive failures per tool
- Trip breaker after threshold exceeded
- Emit `tool:circuit_open` for UI warning
- Auto-reset after cooldown period

### rate-limiter.js

API flood prevention with configurable limits per endpoint.

---

## Integration

Infrastructure modules are the first to be loaded by `boot.js` (Level 1: Foundation). They provide the communication and safety backbone for all other modules.

---

*Last updated: December 2025*
