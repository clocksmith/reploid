# Blueprint 0x000083-ERST: Error Store

**Module:** `ErrorStore`
**File:** `infrastructure/error-store.js`
**Purpose:** Persist errors to VFS for display in Status tab

**Genesis Level:** tabula

---

## Purpose

The Error Store provides persistent error and warning storage in the VFS, replacing volatile in-memory error handling. Errors survive page reloads and can be reviewed in the Status tab. The store integrates with EventBus to automatically capture errors from tool execution, agent failures, and circuit breaker events.

---

## API / Interface

### Error Management

```javascript
// Add an error
await ErrorStore.addError({
  source: 'ToolRunner',
  message: 'Tool not found: FooBar',
  stack: error.stack,
  metadata: { toolName: 'FooBar' }
});

// Add a warning (lower severity)
await ErrorStore.addWarning({
  source: 'SchemaRegistry',
  message: 'Schema validation failed, using defaults'
});

// Get all errors
const errors = await ErrorStore.getErrors();
// Returns: [{ id, ts, level, source, message, stack, metadata }, ...]

// Get error count
const count = await ErrorStore.getCount();
// Returns: { errors: 5, warnings: 3, total: 8 }

// Clear all errors
await ErrorStore.clearErrors();
```

---

## Implementation Details

### Storage Location

Errors are persisted to `/.system/errors.json` in the VFS:

```javascript
const ERROR_PATH = '/.system/errors.json';
const MAX_ERRORS = 100;
```

### Error Format

```javascript
{
  id: 'err_abc123',           // Unique identifier
  ts: 1703500000000,          // Timestamp (ms since epoch)
  level: 'error',             // 'error' | 'warning'
  source: 'ToolRunner',       // Component that raised the error
  message: 'Tool not found',  // Human-readable message
  stack: '...',               // Stack trace if available
  metadata: {}                // Additional context
}
```

### Bounded Storage

The store maintains a maximum of 100 errors to prevent unbounded growth:

```javascript
const addError = async (error) => {
  const errors = await load();

  errors.push({
    id: generateId('err'),
    ts: Date.now(),
    level: 'error',
    ...error
  });

  // Keep only the most recent MAX_ERRORS
  while (errors.length > MAX_ERRORS) {
    errors.shift();
  }

  await persist(errors);
  EventBus.emit('error:stored', { id: errors[errors.length - 1].id });
};
```

### EventBus Integration

The ErrorStore wires into EventBus to automatically capture errors from various sources:

```javascript
// Wire up event listeners on initialization
const init = () => {
  EventBus.on('tool:error', async (data) => {
    await addError({
      source: 'ToolRunner',
      message: data.message,
      stack: data.stack,
      metadata: { tool: data.toolName }
    });
  });

  EventBus.on('agent:error', async (data) => {
    await addError({
      source: 'AgentLoop',
      message: data.message,
      stack: data.stack,
      metadata: { iteration: data.iteration }
    });
  });

  EventBus.on('circuit:open', async (data) => {
    await addWarning({
      source: 'CircuitBreaker',
      message: `Circuit opened: ${data.service}`,
      metadata: { failures: data.failures, service: data.service }
    });
  });
};
```

### Event Subscriptions

| Event | Source | Level |
|-------|--------|-------|
| `tool:error` | ToolRunner | error |
| `agent:error` | AgentLoop | error |
| `circuit:open` | CircuitBreaker | warning |

### Events Emitted

| Event | When |
|-------|------|
| `error:stored` | After an error/warning is persisted |
| `errors:cleared` | After clearErrors() is called |

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| 0x000003 | Utils | ID generation, logging |
| 0x000011 | VFS | Persistence to /.system/errors.json |
| 0x000058 | EventBus | Event subscription and emission |

---

## Genesis Level

**tabula** - Core infrastructure module, part of the immutable genesis kernel. Cannot be modified without HITL approval.

---

**Status:** Implemented
