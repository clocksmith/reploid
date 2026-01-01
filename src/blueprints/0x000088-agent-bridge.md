# Blueprint 0x000088: Agent Bridge Server

**Objective:** WebSocket-based coordination server for multi-agent communication and task distribution.

**Target Module:** AgentBridge (`server/agent-bridge.js`)

**Prerequisites:** Node.js, ws (WebSocket library)

**Affected Artifacts:** `/server/agent-bridge.js`

---

### 1. The Strategic Imperative

Multi-agent systems require a coordination layer for:
- Agent registration and discovery
- Task assignment and status tracking
- Shared context distribution
- Heartbeat-based health monitoring

The AgentBridge provides a JSON-RPC 2.0 WebSocket server for agent coordination.

### 2. The Architectural Solution

**Class Structure:**
```javascript
class AgentBridge extends EventEmitter {
  constructor(server, options = {}) {
    this.wss = new WebSocketServer({ server, path: '/claude-bridge' });
    this.agents = new Map();       // agentId -> { ws, metadata, capabilities }
    this.tasks = new Map();        // taskId -> { assignedTo, status }
    this.sharedContext = new Map(); // contextKey -> value
  }
}
```

### 3. JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `register` | Register agent with capabilities |
| `heartbeat` | Keep-alive ping |
| `get-agents` | List all connected agents |
| `assign-task` | Assign task to specific agent |
| `update-task` | Update task status |
| `get-tasks` | List all tasks |
| `set-context` | Set shared context value |
| `get-context` | Get shared context value |

### 4. Agent Registration

```javascript
// Client sends
{
  jsonrpc: '2.0',
  method: 'register',
  params: {
    name: 'CodeReviewer',
    capabilities: ['review', 'refactor'],
    metadata: { model: 'claude-3-opus' }
  },
  id: 1
}

// Server responds
{
  jsonrpc: '2.0',
  result: { agentId: 'agent_abc123', success: true },
  id: 1
}
```

### 5. Events Emitted

| Event | Description |
|-------|-------------|
| `agent-joined` | New agent registered |
| `agent-left` | Agent disconnected |
| `task-assigned` | Task assigned to agent |
| `task-updated` | Task status changed |

### 6. Health Monitoring

- Heartbeat interval: 30 seconds
- Agent timeout: 120 seconds
- Stale agents automatically removed
- Timeout events emitted for monitoring

### 7. API Surface

| Method | Description |
|--------|-------------|
| `broadcastToAll(message)` | Send message to all agents |
| `sendToAgent(agentId, message)` | Send message to specific agent |
| `getAgentCount()` | Get number of connected agents |
| `getTaskStats()` | Get task status breakdown |

---

### 8. Integration

The AgentBridge attaches to an existing HTTP server:
```javascript
const server = http.createServer(app);
const bridge = new AgentBridge(server, { path: '/claude-bridge' });
```

Browser agents connect via:
```javascript
const ws = new WebSocket('ws://localhost:8000/claude-bridge');
```
