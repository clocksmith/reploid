# Blueprint 0x000083: Error Store

**Objective:** Persist errors to VFS for display in Status tab and post-mortem analysis.

**Target Module:** ErrorStore (`infrastructure/error-store.js`)

**Prerequisites:** Utils, VFS, EventBus (optional)

**Affected Artifacts:** `/infrastructure/error-store.js`, `/.system/errors.json`

---

### 1. The Strategic Imperative

Browser-based agents lose error history on page refresh. The ErrorStore provides:

- Persistent error storage across sessions
- Structured error format with severity levels
- Bounded storage (prevents unlimited growth)
- EventBus integration for real-time UI updates

### 2. The Architectural Solution

The ErrorStore maintains a capped array of error records in VFS:

**Module Structure:**
```javascript
const ErrorStore = {
  metadata: {
    id: 'ErrorStore',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const ERRORS_PATH = '/.system/errors.json';
    const MAX_ERRORS = 100;
    let _errors = [];

    return {
      addError,    // Add new error
      getErrors,   // Get all errors
      getRecent,   // Get last N errors
      clear,       // Clear all errors
      getStats     // Get error counts by type
    };
  }
};
```

### 3. Error Record Format

```javascript
{
  id: 'err_abc123',      // Unique identifier
  ts: 1703692800000,     // Unix timestamp
  type: 'tool:error',    // Error category
  message: 'Failed...',  // Human-readable message
  details: { ... },      // Additional context
  severity: 'error'      // error | warning | info
}
```

### 4. Error Types

| Type | Description |
|------|-------------|
| `tool:error` | Tool execution failure |
| `agent:error` | Agent loop error |
| `llm:error` | LLM API failure |
| `vfs:error` | Filesystem operation failure |
| `parse:error` | Response parsing failure |
| `verification:error` | Code verification failure |

### 5. API Surface

| Method | Description |
|--------|-------------|
| `addError(type, message, details?)` | Add error with optional details |
| `getErrors()` | Get all stored errors |
| `getRecent(n)` | Get last N errors |
| `clear()` | Clear all errors |
| `getStats()` | Get counts grouped by type |

### 6. Genesis Level

**TABULA** - Required for agent observability and debugging.

---

### 7. EventBus Integration

When EventBus is available, errors emit events:
- `error:added` - New error stored
- `error:cleared` - Error store cleared

UI components can subscribe for real-time updates.
