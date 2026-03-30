# Blueprint 0x000086: Telemetry Timeline

**Objective:** Unified append-only event log for audit, performance, and agent state changes.

**Target Module:** `TelemetryTimeline` (TTML)

**Implementation:** `/infrastructure/telemetry-timeline.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000011` (VFS/IndexedDB Storage), `0x000058` (Event Bus)

**Category:** Infrastructure

**Genesis:** spark

---

### 1. The Strategic Imperative

Observability is essential for understanding agent behavior, debugging issues, and ensuring auditability. Without centralized telemetry:
- **No unified audit trail** of agent actions and decisions
- **No performance metrics** for tool execution and cycle timing
- **No structured logging** for post-mortem analysis
- **No export capability** for replay and external analysis

The Telemetry Timeline provides a structured, append-only log of all significant events in the agent lifecycle, persisted to VFS for durability and queryable for analysis.

### 2. The Architectural Solution

The `/infrastructure/telemetry-timeline.js` implements an **append-only event log** with in-memory buffer, VFS persistence, and EventBus integration.

#### Module Structure

```javascript
const TelemetryTimeline = {
  metadata: {
    id: 'TelemetryTimeline',
    version: '1.0.0',
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: true,
    type: 'infrastructure',
    genesis: 'spark'
  },

  factory: async (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    // Private state
    const _recentBuffer = [];
    const MAX_BUFFER_SIZE = 500;
    const LOG_PATH_PREFIX = '/.logs/timeline/';

    /**
     * Record an event to the timeline
     */
    const record = async (type, payload, options = {}) => {
      const entry = {
        id: generateId('evt'),
        ts: Date.now(),
        type,
        payload,
        metadata: {
          cycle: options.cycle || null,
          source: options.source || 'unknown',
          correlationId: options.correlationId || null,
          ...options.metadata
        }
      };

      // Add to in-memory buffer
      _recentBuffer.push(entry);
      if (_recentBuffer.length > MAX_BUFFER_SIZE) {
        _recentBuffer.shift();
      }

      // Persist to VFS
      const datePath = _getDatePath();
      await _appendToLog(datePath, entry);

      // Emit telemetry event
      EventBus.emit('telemetry:recorded', { entry });

      return entry;
    };

    /**
     * Get recent entries from memory buffer
     */
    const getRecent = (limit = 100) => {
      const count = Math.min(limit, _recentBuffer.length);
      return _recentBuffer.slice(-count);
    };

    /**
     * Get entries for a date range from VFS
     */
    const getEntries = async (startDate, endDate) => {
      const entries = [];
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Iterate through each day in range
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const datePath = _formatDatePath(d);
        const logPath = `${LOG_PATH_PREFIX}${datePath}.jsonl`;

        try {
          const content = await VFS.readFile(logPath);
          if (content) {
            const lines = content.split('\n').filter(line => line.trim());
            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.ts >= start.getTime() && entry.ts <= end.getTime()) {
                  entries.push(entry);
                }
              } catch (parseError) {
                logger.warn(`[TelemetryTimeline] Failed to parse log line: ${parseError.message}`);
              }
            }
          }
        } catch (readError) {
          // Log file may not exist for this date
          logger.debug(`[TelemetryTimeline] No log file for ${datePath}`);
        }
      }

      return entries.sort((a, b) => a.ts - b.ts);
    };

    /**
     * Query entries by type
     */
    const queryByType = async (type, options = {}) => {
      const { startDate, endDate, limit } = options;
      const start = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endDate || new Date();

      const entries = await getEntries(start, end);
      const filtered = entries.filter(e => e.type === type || e.type.startsWith(`${type}:`));

      return limit ? filtered.slice(-limit) : filtered;
    };

    /**
     * Get statistics for the timeline
     */
    const getStats = () => {
      const typeCounts = {};
      for (const entry of _recentBuffer) {
        typeCounts[entry.type] = (typeCounts[entry.type] || 0) + 1;
      }

      return {
        bufferSize: _recentBuffer.length,
        maxBufferSize: MAX_BUFFER_SIZE,
        oldestBuffered: _recentBuffer[0]?.ts || null,
        newestBuffered: _recentBuffer[_recentBuffer.length - 1]?.ts || null,
        typeCounts
      };
    };

    /**
     * Export timeline for replay
     */
    const exportRun = async (startDate, endDate, metadata = {}) => {
      const events = await getEntries(startDate, endDate);

      return {
        version: '1.0.0',
        metadata: {
          sessionId: generateId('sess'),
          startTime: startDate.getTime(),
          endTime: endDate.getTime(),
          exportedAt: Date.now(),
          ...metadata
        },
        events
      };
    };

    // Private helpers
    const _getDatePath = () => {
      return _formatDatePath(new Date());
    };

    const _formatDatePath = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const _appendToLog = async (datePath, entry) => {
      const logPath = `${LOG_PATH_PREFIX}${datePath}.jsonl`;
      const line = JSON.stringify(entry) + '\n';

      try {
        // Read existing content
        let existing = '';
        try {
          existing = await VFS.readFile(logPath) || '';
        } catch {
          // File doesn't exist yet
        }

        // Append new entry
        await VFS.writeFile(logPath, existing + line);
      } catch (error) {
        logger.error(`[TelemetryTimeline] Failed to write log: ${error.message}`);
      }
    };

    // Wire up EventBus listeners for auto-recording
    const _wireEventBus = () => {
      // Agent events
      EventBus.on('agent:cycle-start', (data) => {
        record('agent:cycle-start', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      EventBus.on('agent:cycle-end', (data) => {
        record('agent:cycle-end', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      EventBus.on('agent:error', (data) => {
        record('agent:error', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      // Tool events
      EventBus.on('tool:executing', (data) => {
        record('tool:executing', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      EventBus.on('tool:executed', (data) => {
        record('tool:executed', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      EventBus.on('tool:error', (data) => {
        record('tool:error', data, { source: 'EventBus' });
      }, 'TelemetryTimeline');

      logger.info('[TelemetryTimeline] Wired EventBus listeners for agent:*, tool:* events');
    };

    // Initialize
    _wireEventBus();

    return {
      record,
      getRecent,
      getEntries,
      queryByType,
      getStats,
      exportRun
    };
  }
};
```

#### Core Responsibilities

1. **Event Recording**: Log events with type, payload, and metadata
2. **In-Memory Buffer**: Keep last 500 events for fast access
3. **VFS Persistence**: Append to daily JSONL files in `/.logs/timeline/`
4. **Date-Range Queries**: Retrieve entries across multiple days
5. **EventBus Wiring**: Auto-capture `agent:*` and `tool:*` events
6. **Run Export**: Package events for replay engine

### 3. The Implementation Pathway

#### Step 1: Initialize Private State

```javascript
const _recentBuffer = [];          // In-memory ring buffer
const MAX_BUFFER_SIZE = 500;       // Maximum buffered entries
const LOG_PATH_PREFIX = '/.logs/timeline/';  // VFS log directory
```

#### Step 2: Implement Event Recording

```javascript
const record = async (type, payload, options = {}) => {
  // 1. Create entry with unique ID and timestamp
  const entry = {
    id: generateId('evt'),
    ts: Date.now(),
    type,
    payload,
    metadata: {
      cycle: options.cycle || null,
      source: options.source || 'unknown',
      correlationId: options.correlationId || null,
      ...options.metadata
    }
  };

  // 2. Add to in-memory buffer (ring buffer)
  _recentBuffer.push(entry);
  if (_recentBuffer.length > MAX_BUFFER_SIZE) {
    _recentBuffer.shift();
  }

  // 3. Persist to VFS (append to daily log file)
  const datePath = _getDatePath();
  await _appendToLog(datePath, entry);

  // 4. Emit telemetry event for real-time observers
  EventBus.emit('telemetry:recorded', { entry });

  return entry;
};
```

#### Step 3: Implement Buffer Access

```javascript
const getRecent = (limit = 100) => {
  // Return most recent entries from in-memory buffer
  const count = Math.min(limit, _recentBuffer.length);
  return _recentBuffer.slice(-count);
};
```

#### Step 4: Implement VFS Queries

```javascript
const getEntries = async (startDate, endDate) => {
  const entries = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Iterate through each day in range
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const datePath = _formatDatePath(d);
    const logPath = `${LOG_PATH_PREFIX}${datePath}.jsonl`;

    // Read and parse JSONL file
    const content = await VFS.readFile(logPath);
    if (content) {
      const lines = content.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const entry = JSON.parse(line);
        if (entry.ts >= start.getTime() && entry.ts <= end.getTime()) {
          entries.push(entry);
        }
      }
    }
  }

  return entries.sort((a, b) => a.ts - b.ts);
};
```

#### Step 5: Implement EventBus Wiring

```javascript
const _wireEventBus = () => {
  // Agent lifecycle events
  EventBus.on('agent:cycle-start', (data) => {
    record('agent:cycle-start', data, { source: 'EventBus' });
  }, 'TelemetryTimeline');

  EventBus.on('agent:cycle-end', (data) => {
    record('agent:cycle-end', data, { source: 'EventBus' });
  }, 'TelemetryTimeline');

  // Tool execution events
  EventBus.on('tool:executing', (data) => {
    record('tool:executing', data, { source: 'EventBus' });
  }, 'TelemetryTimeline');

  EventBus.on('tool:executed', (data) => {
    record('tool:executed', data, { source: 'EventBus' });
  }, 'TelemetryTimeline');

  EventBus.on('tool:error', (data) => {
    record('tool:error', data, { source: 'EventBus' });
  }, 'TelemetryTimeline');
};
```

#### Step 6: Implement Run Export

```javascript
const exportRun = async (startDate, endDate, metadata = {}) => {
  const events = await getEntries(startDate, endDate);

  return {
    version: '1.0.0',
    metadata: {
      sessionId: generateId('sess'),
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
      exportedAt: Date.now(),
      ...metadata
    },
    events
  };
};
```

### 4. Log File Format

**Path Pattern:** `/.logs/timeline/YYYY-MM-DD.jsonl`

**JSONL Format (one JSON object per line):**
```javascript
{"id":"evt_abc123","ts":1703500000000,"type":"agent:cycle-start","payload":{"iteration":1},"metadata":{"cycle":1,"source":"EventBus"}}
{"id":"evt_abc124","ts":1703500001500,"type":"tool:executed","payload":{"tool":"ReadFile","path":"/core/vfs.js","duration":45},"metadata":{"cycle":1,"source":"EventBus"}}
{"id":"evt_abc125","ts":1703500002000,"type":"tool:executed","payload":{"tool":"WriteFile","path":"/code/new.js","duration":120},"metadata":{"cycle":1,"source":"EventBus"}}
```

### 5. Entry Schema

```javascript
{
  id: 'evt_abc123',           // Unique event ID
  ts: 1703500000000,          // Unix timestamp (ms)
  type: 'tool:executed',      // Event type (namespace:action)
  payload: {                  // Event-specific data
    tool: 'ReadFile',
    path: '/core/vfs.js',
    duration: 45
  },
  metadata: {                 // Contextual metadata
    cycle: 42,                // Agent cycle number
    source: 'EventBus',       // Event source
    correlationId: 'req_xyz'  // For request tracing
  }
}
```

### 6. Event Types

| Type | Description | Payload |
|------|-------------|---------|
| `agent:cycle-start` | Agent cycle began | `{ iteration }` |
| `agent:cycle-end` | Agent cycle completed | `{ iteration, duration, toolCount }` |
| `agent:error` | Agent encountered error | `{ error, stack, context }` |
| `tool:executing` | Tool execution started | `{ tool, args }` |
| `tool:executed` | Tool execution completed | `{ tool, duration, result }` |
| `tool:error` | Tool execution failed | `{ tool, error }` |
| `state:updated` | State changed | `{ key, oldValue, newValue }` |
| `vfs:write` | File written to VFS | `{ path, size }` |
| `llm:request` | LLM API request | `{ model, tokens }` |
| `llm:response` | LLM API response | `{ model, tokens, duration }` |

### 7. Operational Safeguards

- **Append-Only**: Never modify or delete existing log entries
- **Date Partitioning**: One file per day for easy rotation and cleanup
- **Ring Buffer**: In-memory buffer prevents unbounded memory growth
- **Graceful Errors**: Log parse errors without failing entire query
- **VFS Abstraction**: Use VFS for portable persistence (IndexedDB in browser)
- **Source Tracking**: Record event source for debugging

### 8. Widget Interface (Web Component)

```javascript
class TelemetryTimelineWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 1000);
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
  }

  set moduleApi(api) {
    this._api = api;
    this.render();
  }

  getStatus() {
    const stats = this._api.getStats();
    return {
      state: 'active',
      primaryMetric: `${stats.bufferSize} events`,
      secondaryMetric: `${Object.keys(stats.typeCounts).length} types`,
      lastActivity: stats.newestBuffered
    };
  }

  render() {
    const stats = this._api.getStats();
    const recent = this._api.getRecent(10);

    this.shadowRoot.innerHTML = `
      <style>/* Shadow DOM styles */</style>
      <div class="timeline-panel">
        <div class="stats">
          <div class="stat">Buffer: ${stats.bufferSize}/${stats.maxBufferSize}</div>
          <div class="stat">Types: ${Object.keys(stats.typeCounts).length}</div>
        </div>
        <div class="event-list">
          ${recent.map(e => `
            <div class="event-item">
              <span class="event-type">${e.type}</span>
              <span class="event-time">${new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

customElements.define('telemetry-timeline-widget', TelemetryTimelineWidget);
```

### 9. Verification Checklist

- [ ] `record()` creates entry with ID, timestamp, type, payload, metadata
- [ ] `record()` adds to in-memory buffer (max 500 entries)
- [ ] `record()` persists to VFS in JSONL format
- [ ] `record()` emits `telemetry:recorded` event
- [ ] `getRecent()` returns entries from buffer
- [ ] `getEntries()` reads from VFS for date range
- [ ] `getEntries()` handles missing log files gracefully
- [ ] `queryByType()` filters entries by event type
- [ ] `exportRun()` creates replay-compatible format
- [ ] EventBus listeners capture `agent:*` events
- [ ] EventBus listeners capture `tool:*` events
- [ ] Date path format is `YYYY-MM-DD`
- [ ] JSONL format is valid (one JSON per line)

### 10. Extension Opportunities

- Add log rotation and cleanup for old files
- Add compression for archived log files
- Add streaming export for large date ranges
- Add real-time WebSocket streaming of events
- Add event aggregation and rollup statistics
- Add search/filter UI for event exploration
- Add anomaly detection for unusual event patterns
- Add correlation ID propagation through agent cycle
- Add performance flame graph generation from events

---

**Status:** Blueprint

Maintain this blueprint as the telemetry capabilities evolve or new event types are introduced.
