# Blueprint 0x000089-ABRG: Agent Bridge

**Objective:** WebSocket server for multi-agent coordination, enabling browser agents to communicate through centralized signaling.

**Target Module:** `AgentBridge`

**Implementation:** `/server/agent-bridge.js`

**Prerequisites:** `0x000058` (Event Bus)

**Category:** Server

---

## 1. The Strategic Imperative

Multi-agent systems require coordination infrastructure for agents to discover, communicate, and collaborate. The Agent Bridge provides a WebSocket-based signaling server that enables browser-based REPLOID agents to:

- **Discover Peers**: Find other agents in the network
- **Exchange Messages**: Send direct or broadcast messages
- **Coordinate Tasks**: Share state and synchronize actions
- **Form Swarms**: Enable emergent multi-agent behaviors

This is the server-side counterpart to the `AgentBridgeClient` (browser-side), providing the centralized coordination hub.

## 2. The Architectural Solution

The `/server/agent-bridge.js` implements a WebSocket server that manages agent connections, maintains an agent registry, and routes messages between connected agents.

### Module Structure

```javascript
const WebSocket = require('ws');

class AgentBridge {
  constructor(server, options = {}) {
    this.wss = new WebSocket.Server({
      server,
      path: options.path || '/agent-bridge'
    });

    this.agents = new Map();          // agentId -> { ws, metadata, capabilities }
    this.heartbeatInterval = options.heartbeatInterval || 30000;

    this._setupWebSocket();
    this._startHeartbeat();
  }

  _setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const agentId = this._generateAgentId();

      ws.on('message', (data) => {
        this._handleMessage(agentId, ws, JSON.parse(data));
      });

      ws.on('close', () => {
        this._handleDisconnect(agentId);
      });

      ws.on('error', (error) => {
        console.error(`[AgentBridge] WebSocket error for ${agentId}:`, error);
      });
    });
  }

  _handleMessage(agentId, ws, message) {
    switch (message.type) {
      case 'register':
        this._registerAgent(agentId, ws, message);
        break;
      case 'request':
        this._handleRequest(agentId, message);
        break;
      case 'broadcast':
        this._broadcastMessage(agentId, message);
        break;
      case 'direct':
        this._directMessage(agentId, message);
        break;
      case 'pong':
        this._handlePong(agentId);
        break;
    }
  }

  _registerAgent(agentId, ws, message) {
    const agent = {
      ws,
      name: message.name || `Agent-${agentId}`,
      capabilities: message.capabilities || [],
      metadata: message.metadata || {},
      lastSeen: Date.now()
    };

    this.agents.set(agentId, agent);

    // Confirm registration
    ws.send(JSON.stringify({
      type: 'registered',
      agentId,
      agents: this._getAgentList()
    }));

    // Notify other agents
    this._emitEvent('agent-joined', {
      agentId,
      name: agent.name,
      capabilities: agent.capabilities
    });
  }

  _handleDisconnect(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);

      // Notify other agents
      this._emitEvent('agent-left', {
        agentId,
        name: agent.name
      });
    }
  }

  _emitEvent(eventName, data) {
    const message = JSON.stringify({
      type: 'event',
      event: eventName,
      data,
      timestamp: Date.now()
    });

    this.agents.forEach((agent) => {
      if (agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(message);
      }
    });
  }

  _getAgentList() {
    return Array.from(this.agents.entries()).map(([id, agent]) => ({
      agentId: id,
      name: agent.name,
      capabilities: agent.capabilities
    }));
  }

  getStats() {
    return {
      connectedAgents: this.agents.size,
      agents: this._getAgentList(),
      uptime: process.uptime()
    };
  }
}

module.exports = AgentBridge;
```

## 3. WebSocket Endpoint

The Agent Bridge exposes a WebSocket endpoint for agent connections:

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/agent-bridge` | WebSocket | Primary agent coordination channel |

## 4. Message Protocol

### Client to Server Messages

#### Register Agent

```javascript
{
  type: 'register',
  name: 'Reploid-Agent-1',
  capabilities: ['code-generation', 'analysis', 'tool-execution'],
  metadata: {
    version: '1.0.0',
    platform: 'browser'
  }
}
```

#### Send Request (RPC)

```javascript
{
  type: 'request',
  requestId: 'req-123',
  action: 'listAgents',
  params: {}
}
```

#### Broadcast Message

```javascript
{
  type: 'broadcast',
  payload: {
    event: 'task-completed',
    data: { taskId: 'task-456' }
  }
}
```

#### Direct Message

```javascript
{
  type: 'direct',
  targetAgentId: 'agent-xyz',
  payload: {
    action: 'collaborate',
    data: { ... }
  }
}
```

### Server to Client Messages

#### Registration Confirmed

```javascript
{
  type: 'registered',
  agentId: 'agent-abc123',
  agents: [
    { agentId: 'agent-xyz', name: 'Agent-2', capabilities: [...] }
  ]
}
```

#### Event Notification

```javascript
{
  type: 'event',
  event: 'agent-joined',
  data: {
    agentId: 'agent-new',
    name: 'Agent-3',
    capabilities: ['analysis']
  },
  timestamp: 1703712000000
}
```

#### Request Response

```javascript
{
  type: 'response',
  requestId: 'req-123',
  success: true,
  data: { ... }
}
```

## 5. Event Types

The Agent Bridge emits the following events to all connected agents:

| Event | Trigger | Data |
|-------|---------|------|
| `agent-joined` | New agent registers | `{ agentId, name, capabilities }` |
| `agent-left` | Agent disconnects | `{ agentId, name }` |
| `broadcast` | Agent sends broadcast | `{ fromAgentId, payload }` |

## 6. Stats Endpoint

The Agent Bridge provides a stats endpoint for monitoring:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agent-bridge/stats` | GET | Bridge statistics and agent list |

### Stats Response

```javascript
{
  connectedAgents: 3,
  agents: [
    { agentId: 'agent-1', name: 'Reploid-1', capabilities: ['code'] },
    { agentId: 'agent-2', name: 'Reploid-2', capabilities: ['analysis'] },
    { agentId: 'agent-3', name: 'Reploid-3', capabilities: ['code', 'analysis'] }
  ],
  uptime: 3600.5
}
```

## 7. The Implementation Pathway

### Step 1: Initialize WebSocket Server

```javascript
const AgentBridge = require('./agent-bridge');

// Attach to existing HTTP server
const bridge = new AgentBridge(httpServer, {
  path: '/agent-bridge',
  heartbeatInterval: 30000
});
```

### Step 2: Register Stats Endpoint

```javascript
app.get('/api/agent-bridge/stats', (req, res) => {
  res.json(bridge.getStats());
});
```

### Step 3: Handle Agent Lifecycle

```
Browser Agent                    Agent Bridge
     |                                |
     |------ WebSocket Connect ------>|
     |                                |
     |------ Register Message ------->|
     |                                |
     |<----- Registered + Agents -----|
     |                                |
     |<----- agent-joined Events -----|
     |                                |
     |------ Broadcast/Direct ------->|
     |                                |
     |<----- Events/Responses --------|
     |                                |
     |------ WebSocket Close -------->|
     |                                |
     |      (agent-left Event) ------>| (to other agents)
```

## 8. Heartbeat Mechanism

The bridge implements heartbeat monitoring to detect stale connections:

```javascript
_startHeartbeat() {
  setInterval(() => {
    this.agents.forEach((agent, agentId) => {
      if (agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({ type: 'ping' }));
      }
    });
  }, this.heartbeatInterval);
}

_handlePong(agentId) {
  const agent = this.agents.get(agentId);
  if (agent) {
    agent.lastSeen = Date.now();
  }
}
```

## 9. Operational Safeguards

| Concern | Mitigation |
|---------|------------|
| Stale connections | Heartbeat monitoring with automatic cleanup |
| Message flooding | Rate limiting per agent (configurable) |
| Large payloads | Message size limits |
| Memory leaks | Proper cleanup on disconnect |
| Connection storms | Connection throttling |

## 10. Integration with Proxy Server

The Agent Bridge is typically initialized alongside the main proxy server:

```javascript
// In proxy.js
const AgentBridge = require('./agent-bridge');

const server = app.listen(PORT);
const agentBridge = new AgentBridge(server, {
  path: '/agent-bridge'
});

// Stats endpoint
app.get('/api/agent-bridge/stats', (req, res) => {
  res.json(agentBridge.getStats());
});
```

## 11. Extension Points

- **Agent Groups**: Group agents by capability or project
- **Message Queuing**: Queue messages for offline agents
- **Presence Tracking**: Detailed presence states (active, idle, busy)
- **Agent Roles**: Define coordinator, worker, observer roles
- **Authentication**: Token-based agent authentication
- **Persistence**: Store agent registry across restarts

---

**Status:** Implemented
