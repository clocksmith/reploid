# Blueprint 0x000086: Telemetry Timeline

**Objective:** Unified append-only event log for audit, performance, and agent state tracking.

**Target Module:** TelemetryTimeline (`infrastructure/telemetry-timeline.js`)

**Prerequisites:** Utils, VFS, EventBus (optional)

**Affected Artifacts:** `/infrastructure/telemetry-timeline.js`, `/.logs/timeline/*.jsonl`

---

### 1. The Strategic Imperative

Agent operations generate numerous events that must be:
- Captured in chronological order
- Persisted for post-session analysis
- Queryable by type, time range, and severity
- Exportable for external analysis tools

The TelemetryTimeline provides a unified logging substrate.

### 2. The Architectural Solution

Events are stored as JSONL (JSON Lines) files, partitioned by date:

**Module Structure:**
```javascript
const TelemetryTimeline = {
  metadata: {
    id: 'TelemetryTimeline',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const LOG_DIR = '/.logs/timeline';
    const MAX_RECENT = 500;
    const _recent = [];

    return {
      init,         // Create log directory, load recent
      record,       // Add new event
      query,        // Query events by filters
      getRecent,    // Get recent events from memory
      exportRange   // Export date range as JSONL
    };
  }
};
```

### 3. Event Format

```javascript
{
  id: 'evt_abc123',           // Unique identifier
  ts: 1703692800000,          // Unix timestamp (ms)
  type: 'tool:exec',          // Event type
  severity: 'info',           // info | warn | error
  tags: ['tool', 'ReadFile'], // Searchable tags
  payload: { ... }            // Event-specific data
}
```

### 4. Event Types

| Type | Description |
|------|-------------|
| `agent:cycle` | Agent loop iteration |
| `agent:goal` | New goal set |
| `tool:exec` | Tool execution start |
| `tool:result` | Tool execution complete |
| `llm:request` | LLM API call |
| `llm:response` | LLM response received |
| `vfs:write` | File written |
| `vfs:delete` | File deleted |
| `error:*` | Various error events |

### 5. API Surface

| Method | Description |
|--------|-------------|
| `init()` | Initialize, create log dir, load today's events |
| `record(type, payload, options?)` | Record new event |
| `query(filters)` | Query events by type, date range, tags |
| `getRecent(n?)` | Get last N events from memory buffer |
| `exportRange(startDate, endDate)` | Export date range as combined JSONL |

### 6. File Structure

```
/.logs/timeline/
  2024-01-01.jsonl
  2024-01-02.jsonl
  ...
```

Each file contains one JSON object per line, enabling:
- Append-only writes (fast, atomic)
- Line-by-line streaming reads
- Easy date-range queries

### 7. Genesis Level

**TABULA** - Core observability required for agent operation.

---

### 8. Memory Buffer

The `_recent` array holds the last 500 events in memory for fast access. Older events are read from VFS on demand.
