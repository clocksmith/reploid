# Core Directory

**Purpose**: Core substrate modules that provide the fundamental capabilities for REPLOID's recursive self-improvement system.

## Critical Safety Modules

| File | Purpose |
|------|---------|
| `genesis-factory.js` | Creates immutable recovery kernels (“Lifeboats”) used by the Safe Mode bootloader |
| `verification-manager.js` | Runs pre-flight code verification inside an isolated Web Worker |
| `embedding-engine.js` | Local vector memory layer (MiniLM) for semantic reflection/retrieval |

## Cognitive Kernel

| File | Purpose |
|------|---------|
| `agent-loop.js` | Main cognitive cycle - decision making, tool selection, execution orchestration |
| `context-manager.js` | Memory management, token estimation, and context compaction |
| `response-parser.js` | Robust JSON extraction and tool call parsing |
| `llm-client.js` | Multi-provider LLM communication (Gemini, Claude, OpenAI, Ollama, WebLLM) |

## File System & Tooling

| File | Purpose |
|------|---------|
| `vfs.js` | Virtual filesystem (IndexedDB) - persistent storage for evolved code |
| `git-vfs.js` | Version-control layer (snapshots, rollbacks, history) |
| `tool-runner.js` | Tool execution engine - validates and runs tools in sandbox |
| `tool-writer.js` | Tool creation system - generates, validates, and registers new tools (Level 1 RSI) |
| `meta-tool-writer.js` | Meta-improvement system - modifies tool-writer and core modules (Level 2/3 RSI) |
| `substrate-loader.js` | Hot-reload system - loads evolved code as living modules from VFS |
| `substrate-tools.js` | Substrate manipulation - LoadModule, update_preview, etc. |

## Orchestration & Utilities

| File | Purpose |
|------|---------|
| `multi-model-coordinator.js` | Multi-model orchestration - consensus, voting, ensembles |
| `workflow-manager.js` | Workflow coordination - task planning and execution |
| `agent-bridge-client.js` | Communication bridge for external agent integration |
| `utils.js` | Shared utilities - logging, validation, helpers |

---

## Architecture

### RSI Levels

**Level 1: Tool Creation** (`tool-writer.js`)
- Agent creates new tools at runtime
- Validates code syntax and structure
- Registers tools in runtime registry
- Example: Agent creates `analyze_code` tool

**Level 2: Meta-Improvement** (`meta-tool-writer.js`)
- Agent improves its own tool-creation mechanism
- Modifies core modules (agent-loop, tool-runner, etc.)
- Hot-reloads improved versions
- Example: Agent optimizes tool-writer with AST caching

**Level 3: Substrate Modification** (`substrate-loader.js` + `substrate-tools.js`)
- Agent modifies any core module
- Creates widgets and Web Components
- Executes arbitrary substrate code
- Example: Agent rewrites decision-making logic in agent-loop

### Data Flow

```
┌─────────────────────────────────────────────┐
│  agent-loop.js (cognitive cycle)           │
│         ↓                                   │
│  llm-client.js (multi-provider)            │
│         ↓                                   │
│  tool-runner.js (execution)                │
│         ↓                                   │
│  vfs.js (persistent storage)               │
│         ↓                                   │
│  substrate-loader.js (hot-reload)          │
│         ↑                                   │
│  [Agent reads evolved code from VFS]       │
└─────────────────────────────────────────────┘
```

---

## Module Details

### agent-loop.js

The main cognitive cycle that orchestrates the agent's decision-making process.

**Key Functions:**
- `createAgentLoop(config)` - Factory that creates agent loop instance
- `startLoop()` - Begins cognitive cycle
- `processIteration()` - Single thinking step
- `handleToolCall()` - Executes tool and processes result

**State Management:**
- Conversation history with compaction
- Tool call tracking
- Error recovery and rollback

### llm-client.js

Unified interface for multiple LLM providers.

**Supported Providers:**
- Gemini (browser-cloud, proxy-cloud)
- Claude (browser-cloud, proxy-cloud)
- OpenAI (browser-cloud, proxy-cloud)
- Ollama (proxy-local)
- WebLLM (browser-local, WebGPU)

**Connection Types:**
1. Browser → Cloud (direct API calls)
2. Proxy → Cloud (server-side API calls)
3. Browser → Local (WebLLM with WebGPU)
4. Proxy → Local (Ollama)

### vfs.js

Virtual filesystem using IndexedDB for persistent storage.

**Operations:**
- `read(path)` - Read file from VFS
- `write(path, content)` - Write file to VFS
- `list(path)` - List directory contents
- `delete(path)` - Delete file
- `snapshot()` - Create backup
- `restore(snapshot)` - Rollback to backup

**Storage:**
- Browser: IndexedDB (~50MB typical, unlimited potential)
- Survives page refreshes
- Can be cleared via "Clear Cache" button

### tool-writer.js

Creates new tools at runtime (Level 1 RSI).

**Validation:**
- AST parsing for syntax errors
- Security checks (no eval, no unsafe globals)
- Schema validation (name, params, description)
- Test execution before registration

**Registration:**
- Saves tool to `/tools/{name}.js` in VFS
- Loads via blob URL as ES module
- Adds to runtime tool registry
- Available immediately for agent use

### meta-tool-writer.js

Improves core modules and tool-writer itself (Level 2 RSI).

**Capabilities:**
- `improve_tool_writer(code)` - Optimize tool creation
- `improve_core_module(module, code)` - Modify any core module
- `rollback_tool_writer()` - Undo last change

**Safety:**
- Automatic backups before modification
- Rollback on error
- Version tracking (`.backup.{timestamp}`)

### substrate-loader.js

Hot-reloads evolved code from VFS.

**Loading Process:**
1. Read module from VFS
2. Create blob URL from code
3. Import as ES module
4. Replace old module references
5. Re-initialize with factory pattern

**Supports:**
- ES Modules (`.js`)
- Web Components (`.js` defining custom elements)
- Widgets (HTML/CSS/JS bundles)

---

## Development

### Adding New Core Modules

1. Create file in `core/`
2. Use factory pattern:
```javascript
export default function createMyModule(dependencies) {
  // Private state
  let state = {};

  // Public API
  return {
    async initialize() { },
    async doSomething() { },
    async destroy() { }
  };
}
```
3. Update `boot.js` to load module
4. Add to this README

### Testing Core Modules

See `/tests/` for unit tests.

---

## See Also

- **[Boot System](../boot/README.md)** - Initialization sequence
- **[Upgrades](../upgrades/README.md)** - Pre-built functional modules
- **[UI Components](../ui/README.md)** - User interface components
- **[Main README](../README.md)** - Project overview

---

**Note:** These modules are self-modifiable. The agent can read, analyze, and improve any of them at runtime. All changes persist to VFS while original source code remains unchanged as the "genesis" state.
