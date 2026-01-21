# REPLOID Substrate Architecture

This document consolidates the developer documentation for the REPLOID substrate.

## Directory Structure

```
/
├── core/              # Core substrate modules (cognitive kernel)
├── capabilities/      # Extended capabilities (reflection, cognition, communication)
├── infrastructure/    # Support services (event-bus, DI, rate-limiting)
├── tools/             # Dynamic tools (agent-created)
├── ui/                # User interface components
├── server/            # Server-side (proxy, signaling)
├── blueprints/        # 102 architectural blueprints
├── examples/          # RSI example patterns
├── tests/             # Test suite
└── docs/              # Documentation
```

---

## Core Modules

The core provides fundamental capabilities for REPLOID's recursive self-improvement system.

### Cognitive Kernel

| File | Purpose |
|------|---------|
| `agent-loop.js` | Main cognitive cycle - decision making, tool selection, execution |
| `context-manager.js` | Memory management, token estimation, context compaction |
| `response-parser.js` | Robust JSON extraction and tool call parsing |
| `llm-client.js` | Multi-provider LLM communication (Gemini, Claude, OpenAI, Ollama, WebLLM) |

### File System & Tooling

| File | Purpose |
|------|---------|
| `vfs.js` | Virtual filesystem (IndexedDB) - persistent storage for evolved code |
| `tool-runner.js` | Tool execution engine - validates and runs tools in sandbox |
| `tool-writer.js` | Tool creation system - generates, validates, registers new tools |
| `substrate-loader.js` | Hot-reload system - loads evolved code as living modules from VFS |

### Capability Levels

> Definitions moved to [AGENTS.md](../../AGENTS.md#capability-levels) to maintain a single source of truth.

---

## Infrastructure

Support services providing communication and safety backbone.

| File | Purpose |
|------|---------|
| `event-bus.js` | Pub/sub event system for module communication |
| `di-container.js` | Dependency injection container |
| `rate-limiter.js` | API rate limiting |
| `audit-logger.js` | Security audit logging to VFS |
| `hitl-controller.js` | Human-in-the-loop oversight modes |
| `circuit-breaker.js` | Failure tracking and recovery |

### Key Events

```javascript
EventBus.emit('agent:status', { state: 'RUNNING' });
EventBus.on('tool:file_written', (data) => { ... });
```

Event namespaces: `agent:*`, `tool:*`, `worker:*`, `vfs:*`, `reflection:*`, `goal:*`, `swarm:*`

### HITL Modes

| Mode | Behavior |
|------|----------|
| **AUTONOMOUS** | No approval required |
| **HITL** | Queue actions for approval |
| **EVERY_N** | Checkpoint every N steps |

---

## Capabilities

### Reflection
- `reflection-store.js` - Persistent storage for insights, errors, success patterns
- `reflection-analyzer.js` - Analyzes history to detect failure patterns

### Cognition
- `semantic-memory.js` - Vector-based semantic search
- `knowledge-graph.js` - Entity-relationship storage
- `rule-engine.js` - Symbolic reasoning

### Communication (Multi-Tab Coordination)
- `webrtc-swarm.js` - WebRTC P2P transport with session-scoped rooms
- `swarm-sync.js` - LWW state synchronization with Lamport clocks

---

## Server Components

| File | Purpose |
|------|---------|
| `proxy.js` | HTTP proxy for API requests and CORS handling |
| `signaling-server.js` | WebRTC signaling for peer-to-peer swarm |

### CORS Configuration

Set `CORS_ORIGINS` environment variable or add to config:

```json
{
  "server": {
    "corsOrigins": ["http://localhost:8080", "https://your-domain.example"]
  }
}
```

---

## Blueprints

The `/blueprints/` directory contains 102 architectural blueprints organized into 7 domains:

1. **Core Infrastructure** - Bootstrapping, DI, configuration
2. **State & Memory** - VFS, persistence, context management
3. **Agent Cognition** - Reasoning, planning, LLM interaction
4. **Tooling & Runtime** - Execution engines, Python/Pyodide
5. **User Interface** - Panels, modals, interaction components
6. **Visualization** - Charts, graphs, introspection visuals
7. **Recursive Self-Improvement** - Introspection, evolution

Key blueprints:
- `0x000008` - Agent Cognitive Cycle
- `0x000035` - Reflection Store Architecture
- `0x00003E` - WebRTC Swarm Transport
- `0x000047` - Verification Manager

---

## Examples

The `/examples/` directory contains RSI reference implementations:

| Level | File | Description |
|-------|------|-------------|
| 1 | `code-quality-auditor.js` | Uses existing capabilities for external tasks |
| 2 | `self-play-prompt-improver.js` | Improves own process through self-play |
| 3 | `substrate-optimizer.js` | Modifies own runtime kernel |

---

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Generate coverage report
```

Test structure:
- `tests/unit/` - Unit tests for individual modules
- `tests/integration/` - Integration tests for system behavior
- `tests/e2e/` - End-to-end browser tests (Playwright)

Current coverage: 110+ tests, 98%+ line coverage on core modules.

---

## Development

### Adding New Modules

Use the factory pattern:

```javascript
const MyModule = {
  metadata: {
    id: 'MyModule',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;

    const init = async () => {
      // Initialize
      return true;
    };

    return { init };
  }
};

export default MyModule;
```

### Module Loading

Modules are loaded based on Genesis Level in `config/genesis-levels.json`:
- **tabula** - Bootstrap substrate core (7 modules)
- **spark** - Minimal agent core (+11 modules)
- **reflection** - Spark + self-awareness (+6 modules)
- **cognition** - Reflection + memory and reasoning (+11 modules)
- **substrate** - Cognition + runtime infrastructure (+12 modules)
- **full** - Substrate + multi-agent systems (+11 modules)
