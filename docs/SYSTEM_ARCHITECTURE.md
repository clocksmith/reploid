# REPLOID System Architecture

**[Back to Main Project](../README.md)**

---

## Overview

REPLOID is a browser-native research environment for studying recursive self-improvement (RSI) without giving agents raw operating-system access. Everything runs inside a single browser origin, backed by IndexedDB and organized around a strict "Genesis snapshot" philosophy.

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER ORIGIN                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Proto UI   │    │  Agent Loop  │    │   Workers    │      │
│  │  (ui/proto)  │◄──►│ (core/agent) │◄──►│ (WorkerMgr)  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Tool Runner                          │   │
│  │            (dynamic loading, arena gating)               │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │     VFS      │    │  Verification│    │    Audit     │      │
│  │  (IndexedDB) │    │    Worker    │    │    Logger    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Boot Sequence

### 1. Entry Point (`index.html`)

The boot screen allows operators to configure:
- **Genesis Level**: Tabula Rasa, Reflection, or Full Substrate
- **Model Providers**: Cloud APIs, Ollama, WebLLM
- **Concurrency Limits**: Max workers, iteration caps
- **Goal Chips**: Pre-defined or custom goals

### 2. Hydration (`boot.js`)

When "Awaken Agent" is pressed:

1. **Static File Fetch**: Pull files over HTTP
2. **VFS Hydration**: Write files to IndexedDB via `core/vfs.js`
3. **Genesis Snapshot**: Capture pristine state for rollback
4. **DI Container**: Resolve all module dependencies
5. **Service Worker**: Register `sw-module-loader.js` for module interception
6. **Proto UI Mount**: Initialize UI into `#app`
7. **WorkerManager Init**: Seed worker types and model roles
8. **Agent Loop Start**: Begin Think → Act → Observe cycle

### 3. Genesis Levels (`config/genesis-levels.json`)

| Level | Modules | Description |
|-------|---------|-------------|
| **Tabula Rasa** | ~13 | Minimal core, fastest boot |
| **Reflection** | ~19 | + Streaming, verification, HITL |
| **Full Substrate** | ~32 | + Arena, semantic memory, full toolset |

Each level defines:
- `modules`: Files to hydrate
- `workerTypes`: Permission configurations
- `modelRoles`: Model assignments (orchestrator, fast, code, local)

---

## Core Modules

### `core/agent-loop.js`

The cognitive orchestrator implementing Think → Act → Observe:

```javascript
async run(goal) {
  // 1. Get system prompt from PersonaManager
  // 2. Record goal in context
  // 3. Loop: query LLM → parse tools → execute → observe
  // 4. Enforce breakers: iteration caps, timeouts, circuit breakers
}
```

**Key Features:**
- Multi-model support with consensus strategies (arena, majority vote)
- Both OpenAI-style native tool calls and text-based `TOOL_CALL:` parsing
- EventBus integration for UI reactivity
- Streaming support with tokens/sec tracking

### `core/vfs.js`

Virtual File System backed by IndexedDB:

- **Operations**: read, write, delete, list, stat
- **Hydration**: Populate from network at boot
- **Snapshots**: GenesisSnapshot for offline rollback
- **Watchers**: EventBus events (`vfs:write`, `vfs:delete`)

All module imports are intercepted by the service worker and served from VFS.

### `core/tool-runner.js`

Dynamic tool loading and execution:

- **Discovery**: Scan `/tools/` directory at init
- **Schema Registration**: Extract tool schemas for LLM
- **Permission Filtering**: Workers receive filtered tool lists
- **Arena Gating**: High-risk modifications can require arena consensus
- **Verification Pipeline**: Pre-flight checks before VFS writes

### `core/worker-manager.js`

Multi-agent orchestration:

```javascript
// Worker Types (from genesis-levels.json)
{
  "explore": { allowedTools: ["ReadFile", "ListFiles", "Grep", "Find"] },
  "analyze": { allowedTools: ["ReadFile", "ListFiles", "Grep", "Jq"] },
  "execute": { allowedTools: "*" }
}

// Model Roles
{
  "orchestrator": "Full-power model for main agent",
  "fast": "Lightweight model for simple tasks",
  "code": "Code-specialized model",
  "local": "WebLLM/Ollama for offline"
}
```

**Constraints:**
- Max concurrency (default 10)
- Flat hierarchy (workers cannot spawn workers)
- All actions flow through audit pipeline

### `core/llm-client.js`

Multi-provider abstraction:

| Provider | Mode | Notes |
|----------|------|-------|
| OpenAI | Cloud direct | GPT-4, etc. |
| Anthropic | Cloud direct | Claude models |
| Gemini | Cloud direct | Google models |
| Ollama | Local | Self-hosted models |
| WebLLM | Browser | WebGPU-accelerated |
| Transformers.js | Browser | ONNX Runtime Web |
| Proxy | Server | Via `server/proxy.js` |

### `core/persona-manager.js`

System prompt customization:

- Reads `/config.json` for persona configuration
- Injects RSI-focused identity, tool-writing instructions
- Enforces CamelCase naming for tools
- Includes verification loop reminders and safety rules

### `core/response-parser.js`

Parses LLM output for tool calls:

- OpenAI-style JSON tool calls
- Text-based `TOOL_CALL: ToolName` fragments
- Handles multi-tool responses

---

## Infrastructure

### `infrastructure/event-bus.js`

Pub/sub system for decoupled communication:

```javascript
EventBus.emit('agent:status', { state: 'RUNNING' });
EventBus.on('tool:file_written', (data) => { ... });
```

### `infrastructure/di-container.js`

Dependency injection for module resolution:

```javascript
const vfs = container.resolve('VFS');
const toolRunner = container.resolve('ToolRunner');
```

### `infrastructure/hitl-controller.js`

Human-in-the-loop oversight:

| Mode | Behavior |
|------|----------|
| **AUTONOMOUS** | No approval required |
| **HITL** | Queue actions for approval |
| **EVERY_N** | Checkpoint every N steps |

### `infrastructure/audit-logger.js`

Comprehensive execution logging:

- Tool calls with sanitized args
- Duration and success/failure
- Persisted to `/.logs/audit/YYYY-MM-DD.jsonl`

### `infrastructure/circuit-breaker.js`

Failure tracking and recovery:

- Track consecutive failures per tool
- Trip breaker after threshold
- Emit `tool:circuit_open` for UI warning

### `infrastructure/rate-limiter.js`

API flood prevention with configurable limits.

---

## Safety Stack

### 1. VFS Containment

All file I/O is virtualized. No access to host filesystem.

### 2. Service Worker Interception

All ES6 imports served from IndexedDB, not network.

### 3. Genesis Snapshots

Instant rollback to pristine state, works offline.

### 4. Verification Worker

Pre-flight checks in isolated Web Worker:
- Syntax validation
- Forbidden pattern detection (eval, Function, __proto__)
- Policy violation checks

### 5. Arena Gating

High-risk modifications require consensus:
- Multiple model candidates compete
- Only verified solutions commit
- Toggle via `localStorage.REPLOID_ARENA_GATING`

### 6. VFSSandbox

Test changes in disposable clone:

```javascript
const sandbox = await VFSSandbox.create();
await sandbox.apply(changes);
const valid = await sandbox.verify();
if (!valid) await sandbox.restore();
```

### 7. Circuit Breakers

Prevent runaway failures with automatic recovery.

### 8. HITL Controller

Human approval gates for sensitive operations.

---

## UI Architecture

### Proto UI (`ui/proto.js`)

The operator's control room:

```
┌─────────────────────────────────────────────────────────────┐
│  [History] [Reflections] [Status] [Workers] [Debug]         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────┐ │
│  │   Sidebar   │  │   VFS Content       │  │   Active    │ │
│  │   (Tabs)    │  │   Panel             │  │   Tab       │ │
│  │             │  │   - Edit            │  │   Content   │ │
│  │             │  │   - Preview         │  │             │ │
│  │             │  │   - Diff            │  │             │ │
│  │             │  │   - Snapshots       │  │             │ │
│  └─────────────┘  └─────────────────────┘  └─────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Workspace Header: Goal | Tokens | State | Workers      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Tabs

| Tab | Content |
|-----|---------|
| **History** | LLM responses, tool calls/results, arena outcomes, streaming |
| **Reflections** | Learning entries with success/error coloring |
| **Status** | Agent state, token usage, model info, error list |
| **Workers** | Active/completed workers, per-worker logs, progress |
| **Debug** | System prompt, conversation context, model config |

### EventBus Subscriptions

Proto subscribes to:
- `agent:status`, `agent:history`, `agent:stream`
- `tool:error`, `tool:circuit_open`, `tool:file_written`
- `worker:spawned`, `worker:progress`, `worker:completed`
- `vfs:write`, `vfs:artifact`
- `reflection:added`

### Command Palette (Ctrl+K)

Quick commands: start/stop, export, clear history, refresh VFS, toggle panels.

---

## Tools Architecture

### Dynamic Loading

All tools loaded from `/tools/` at boot. No hardcoded tools.

### Tool Categories

| Category | Tools |
|----------|-------|
| **Core VFS** | ReadFile, WriteFile, ListFiles, DeleteFile |
| **Meta (RSI)** | CreateTool, LoadModule, ListTools |
| **Workers** | SpawnWorker, ListWorkers, AwaitWorkers |
| **Shell-like** | Cat, Head, Tail, Ls, Pwd, Touch, Mkdir, Rm, Mv, Cp |
| **Search** | Grep, Find, Sed, Jq |
| **Edit** | Edit (literal match/replace) |
| **Version Control** | Git (VFS-scoped shim) |
| **Analysis** | FileOutline |
| **External** | Python (via Pyodide Web Worker) |

### Tool Interface

```javascript
export default async function(args, deps) {
  const { VFS, EventBus, AuditLogger, ToolWriter, WorkerManager } = deps;
  // Tool implementation
  return result;
}

export const schema = {
  name: "ToolName",
  description: "What this tool does",
  parameters: { /* JSON Schema */ }
};
```

---

## File Structure

```
reploid/
├── index.html              # Boot screen entry point
├── boot.js                 # Hydration and initialization
├── sw-module-loader.js     # Service worker for VFS modules
│
├── core/                   # Core substrate
│   ├── agent-loop.js       # Cognitive cycle
│   ├── vfs.js              # Virtual filesystem
│   ├── llm-client.js       # Multi-provider LLM
│   ├── tool-runner.js      # Dynamic tool execution
│   ├── worker-manager.js   # Multi-agent orchestration
│   ├── persona-manager.js  # System prompt management
│   ├── response-parser.js  # Tool call parsing
│   └── verification-manager.js  # Pre-flight checks
│
├── infrastructure/         # Support services
│   ├── event-bus.js        # Pub/sub system
│   ├── di-container.js     # Dependency injection
│   ├── hitl-controller.js  # Human-in-the-loop
│   ├── audit-logger.js     # Execution logging
│   ├── circuit-breaker.js  # Failure tracking
│   └── rate-limiter.js     # API limits
│
├── ui/                     # User interface
│   └── proto.js            # Proto UI
│
├── tools/                  # Agent tools (all CamelCase)
│   ├── ReadFile.js, WriteFile.js, ...
│   ├── SpawnWorker.js, ListWorkers.js, AwaitWorkers.js
│   └── python/             # Pyodide runtime
│
├── config/                 # Configuration
│   └── genesis-levels.json # Module/worker/role definitions
│
├── testing/                # Test infrastructure
│   └── arena/              # Arena harness and sandbox
│
├── docs/                   # Documentation
├── blueprints/             # Architectural specifications
└── server/                 # Proxy server for API keys
```

---

## Key Principles

1. **Containment First**: Everything runs in browser sandbox
2. **Observable**: Full audit trail, UI instrumentation
3. **Recoverable**: Genesis snapshots, instant rollback
4. **Multi-Model**: Provider flexibility, cost optimization
5. **Self-Modifying**: RSI capability with safety gates
6. **Decoupled**: EventBus + DI for modularity

---

*Last updated: December 2025*
