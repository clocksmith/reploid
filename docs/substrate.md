# REPLOID Substrate Architecture

This document consolidates the developer documentation for the REPLOID substrate.

## Directory Structure

```
reploid/
├── src/               # Browser runtime (VFS root)
│   ├── entry/         # Entry points (seed VFS, start app)
│   ├── boot-helpers/  # Boot orchestration helpers
│   ├── core/          # Core substrate modules (cognitive kernel)
│   ├── capabilities/  # Extended capabilities (reflection, cognition, communication)
│   ├── infrastructure/ # Support services (event-bus, DI, rate-limiting)
│   ├── tools/         # Dynamic tools (agent-created)
│   ├── ui/            # User interface components
│   │   └── boot-wizard/  # Boot wizard UI
│   ├── styles/        # UI styles
│   ├── config/        # Runtime configuration + manifests
│   ├── blueprints/    # Architectural blueprints
│   └── testing/       # Browser-side harnesses
├── server/            # Server-side (proxy, signaling)
├── tests/             # Test suites (unit, integration, e2e, benchmarks)
├── docs/              # Documentation
└── doppler/           # Submodule (engine)
```

Runtime note: the VFS root `/` maps to `src/` on disk. Paths like `/core/agent-loop.js`
refer to `src/core/agent-loop.js`.

---

## Ouroboros Contract (Doppler Integration)

Reploid (driver) and Doppler (engine) integrate through a minimal substrate contract:
SharedArrayBuffer for control flags plus VFS files for payload exchange. This keeps the
API surface tiny and auditable.

### Contract Surface

```
/.system/
├── substrate.bin      # SharedArrayBuffer pointer
├── inference.rdrr     # Reploid -> Doppler (plan + inputs)
├── evolution.trace    # Doppler -> Reploid (results + metrics)
└── kernel.wgsl        # Reploid-authored kernel overrides (optional)
```

Coordination uses a single flag in the SharedArrayBuffer:

```javascript
const substrate = new SharedArrayBuffer(16);
const flag = new Int32Array(substrate, 0, 1);

// Reploid (driver) signals work, then waits.
Atomics.store(flag, 0, 1);
Atomics.wait(flag, 0, 1);

// Doppler (engine) waits for work, then signals completion.
Atomics.wait(flag, 0, 0);
Atomics.store(flag, 0, 0);
Atomics.notify(flag, 0);
```

### Kernel Evolution

Reploid can evolve Doppler kernels by writing a replacement WGSL file to
`/.system/kernel.wgsl` and updating the inference plan to reference the new hash.
Doppler validates the hash and recompiles only when it changes. This path is
gated by verification and rollback logic in Reploid.

See `reploid/doppler/docs/architecture.md` for Doppler's engine design details.

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

Definitions maintained in internal vision materials.

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

The `src/blueprints/` directory (VFS path `/blueprints/`) contains 102 architectural blueprints organized into 7 domains:

1. **Core Infrastructure** - Bootstrapping, DI, configuration
2. **State & Memory** - VFS, persistence, context management
3. **Agent Cognition** - Reasoning, planning, LLM interaction
4. **Tooling & Runtime** - Execution engines, tool orchestration
5. **User Interface** - Panels, modals, interaction components
6. **Visualization** - Charts, graphs, introspection visuals
7. **Recursive Self-Improvement** - Introspection, evolution

Key blueprints:
- `0x000008` - Agent Cognitive Cycle
- `0x000035` - Reflection Store Architecture
- `0x00003E` - WebRTC Swarm Transport
- `0x000047` - Verification Manager

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
- `tests/benchmarks/` - Performance benchmarks

Coverage varies by module. See `tests/` for current suites.

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
