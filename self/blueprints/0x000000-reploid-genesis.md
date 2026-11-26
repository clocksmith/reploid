# Blueprint 0x000000: REPLOID Genesis

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/config/genesis-levels.json`, `/self/core/agent-loop.js`, `/self/host/start-app.js`, `/self/host/reploid-launch.js`, `/self/boot-helpers/index.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000000-reploid-genesis.md`
**Objective:** Define the foundational architecture, philosophy, and design principles of REPLOID - a browser-native recursive self-improving agent substrate.

**Target Upgrade:** Genesis (System-wide)

**Prerequisites:** None (This is the root blueprint)

**Affected Artifacts:** All artifacts in the REPLOID system

---

## 1. The Strategic Imperative

REPLOID exists to answer a fundamental question: **Can an AI agent safely improve itself within a constrained environment?**

Traditional software is static - written by humans, executed by machines. REPLOID inverts this paradigm: the agent reads, reasons about, and modifies its own source code. This is **Recursive Self-Improvement (RSI)** - the ability to enhance one's own cognitive architecture.

The browser provides an ideal sandbox for this experiment:
- **Isolation**: Browser security model provides containment
- **Persistence**: IndexedDB enables durable state without external dependencies
- **Accessibility**: No installation, runs anywhere with a browser
- **Observability**: All operations are visible, debuggable, and reversible

---

## 2. Core Philosophy

### 2.1 The RSI Thesis

REPLOID is built on the thesis that safe RSI requires:

1. **Transparency**: Every modification is logged, diff-able, and reversible
2. **Gradual Capability**: Start minimal, earn capabilities through demonstrated safety
3. **Human Oversight**: Critical operations require HITL (Human-in-the-Loop) approval
4. **Verification**: Code changes pass through sandbox verification before execution
5. **Rollback**: Genesis snapshots enable recovery from any failure
6. **Operator Authority**: Model output, Arena scores and peer consensus inform a decision; only operator adoption, within an explicit and reversible grant, activates a change (see [INTENT.md](../../INTENT.md))

### 2.2 The OODA Loop

REPLOID's cognitive architecture follows the OODA loop:

```
OBSERVE  ->  ORIENT  ->  DECIDE  ->  ACT
   |            |           |         |
   v            v           v         v
[Read VFS]  [Analyze]  [Plan]    [Execute]
   |                               |
   +---------- FEEDBACK ----------+
```

Each cycle:
1. **Observe**: Read current state, goals, and environment
2. **Orient**: Analyze situation, identify options
3. **Decide**: Select action based on goals and constraints
4. **Act**: Execute chosen action (tool use, code modification, etc.)

### 2.3 Cyclical Naming

REPLOID uses recursive acronyms to reinforce the self-referential nature:

- **REPLOID**: Recursive Evolution Protocol Loop Orchestrating Inference DOPPLER
- **DOPPLER**: DOPPLER Orchestrates Parallel Processing for LLM Execution in REPLOID

---

## 3. System Architecture

### 3.1 Directory Structure

```

self/
|-- host/start-app.js       # Boot host: route home, awaken trigger, Zero/X boot
|-- host/reploid-launch.js  # Reploid runtime and capsule UI launcher
|-- entry/start-app.js      # One-line forwarder to host/start-app.js
|-- boot-helpers/index.js   # boot(): genesis level, module registration, VFS, snapshot
|-- sw-module-loader.js     # Service worker for VFS modules
|
|-- core/                   # Agent substrate
|   |-- agent-loop.js       # Cognitive cycle (Think -> Act -> Observe)
|   |-- vfs.js              # Virtual filesystem (IndexedDB)
|   |-- llm-client.js       # Multi-provider LLM abstraction
|   |-- tool-runner.js      # Dynamic tool loading/execution
|   |-- state-manager.js    # Centralized state management
|   +-- verification-manager.js  # Pre-flight safety checks
|
|-- infrastructure/         # Support services
|   |-- di-container.js     # Dependency injection
|   |-- hitl-controller.js  # Human-in-the-loop oversight
|   +-- audit-logger.js     # Execution logging
|
|-- capabilities/           # Extended capabilities
|   +-- communication/      # Swarm sync, WebRTC transport
|
|-- tools/                  # Agent tools (CamelCase)
|   |-- ReadFile.js
|   |-- WriteFile.js
|   |-- CreateTool.js
|   +-- ...
|
|-- config/                 # Configuration
|   +-- genesis-levels.json # Module/worker/role definitions
|
|-- ui/                     # Boot homes, wizard, proto and Zero UI
|
|-- testing/arena/          # Arena harness and VFS sandbox
|
+-- blueprints/             # Architectural specifications (this directory)
    +-- 0x000000-reploid-genesis.md  # You are here

shared/
|-- core/utils.js           # Utilities and error types
|-- core/verification-worker.js
+-- infrastructure/event-bus.js  # Pub/sub event system
```

Files under `shared/` are served at the same `/self/...`-relative paths as files under `self/`; one served tree overlays both.

### 3.2 Module Architecture

Every REPLOID module follows the factory pattern:

```javascript
const ModuleName = {
  metadata: {
    id: 'ModuleName',
    version: '1.0.0',
    genesis: { introduced: 'spark' },   // lowest genesis level that loads it
    dependencies: ['Dep1', 'Dep2?'],     // '?' marks an optional dependency
    async: false,
    type: 'core|infrastructure|capability|utility'
  },
  factory: (deps = {}) => {
    // Private state (closure)
    const _state = {};

    // The factory returns the module's public API
    return { /* public methods */ };
  }
};
```

### 3.3 Key Subsystems

| Subsystem | Blueprint | Purpose |
|-----------|-----------|---------|
| Agent Loop | [0x000008](0x000008-agent-cognitive-cycle.md) | Core cognitive cycle |
| VFS | [0x000011](0x000011-advanced-storage-backend-indexeddb.md) | Virtual file system (IndexedDB) |
| State Manager | [0x000005](0x000005-state-management-architecture.md) | Centralized state |
| LLM Client | [0x000007](0x000007-api-client-and-communication.md) | Multi-provider inference |
| Tool Runner | [0x00000A](0x00000A-tool-runner-engine.md) | Dynamic tool execution |
| DI Container | [0x000042](0x000042-dependency-injection-container.md) | Dependency injection |
| Event Bus | [0x00004F](0x00004F-event-bus-infrastructure.md) | Pub/sub messaging |
| HITL Controller | [0x000049](0x000049-hitl-controller.md) | Human oversight |
| Verification Manager | [0x000040](0x000040-verification-manager.md) | Safety sandbox |
| Genesis Snapshot | [0x00003C](0x00003C-genesis-snapshot-system.md) | Rollback system |

---

## 4. RSI Levels

REPLOID categorizes self-modification by risk level:

| Level | Name | Scope | Gate |
|-------|------|-------|------|
| **L0** | Basic Functions | CreateTool, Web APIs, new tools | Verification Worker sandbox |
| **L1** | Meta Tooling | Modify tool-writer, improve CreateTool | Verification Worker sandbox (VFSSandbox + VerificationManager) |
| **L2** | Self-Modification (Substrate) | Edit core modules, runtime patches | Verification Worker sandbox + Genesis rollback |
| **L3** | Weak RSI (Iterative) | Bounded feedback loops, self-improvement | Signed improvement episode, protected evaluator, paired evaluation, generation rollback and explicit operator promotion |
| **L4** | Weak AGI | Broad autonomous planning, system-building, and self-directed experimentation | N/A |

Higher levels require progressively stronger safety mechanisms. The gates are the ones in [SECURITY.md](../../docs/SECURITY.md#rsi-level-policy) and [RSI improvement episodes](../../docs/rsi-improvement-episodes.md).

A gate can only block. Passing verification, an Arena ranking, a model's recommendation or agreement among peers is evidence for a decision; none of them grants activation or adoption. Activation of a change requires operator adoption within an explicit, reversible grant.

---

## 5. Safety Architecture

### 5.1 Containment Layers

1. **Browser Sandbox**: OS-level isolation
2. **VFS Isolation**: All files in IndexedDB, no real filesystem access
3. **Verification Worker**: Executes code in isolated Web Worker before commit
4. **Genesis Snapshot**: Immutable recovery point
5. **Governance Gates**: Verification, rollback and operator adoption for critical operations; scores and consensus inform the operator and never adopt a change themselves

### 5.2 Genesis Kernel

The Genesis Kernel is an immutable snapshot of the minimal viable agent. It cannot be modified and serves as the ultimate recovery mechanism. If the agent enters an unrecoverable state, it can be restored to Genesis.

See [0x00003C](0x00003C-genesis-snapshot-system.md) for details.

### 5.3 Circuit Breaker

The circuit breaker pattern prevents cascading failures:

- **Closed**: Normal operation
- **Open**: Too many failures, stop executing
- **Half-Open**: Test recovery before resuming

See [0x00005C](0x00005C-circuit-breaker-pattern.md) for implementation.

---

## 6. The Blueprint System

Blueprints are knowledge artifacts that document architectural decisions and implementation patterns. They enable:

- **Knowledge Transfer**: Agent can learn from blueprints
- **Self-Documentation**: System describes itself
- **Evolution Tracking**: Changes are recorded over time
- **Reproducibility**: Agent can rebuild capabilities from blueprints

### 6.1 Numbering

IDs are identity, not categories. Canonical blueprints are numbered contiguously from `0x000000`, and a new blueprint takes the next ID. See the [blueprint README](README.md) and the [index contract](blueprint-index-contract.md).

### 6.2 Blueprint Structure

Every numbered blueprint starts with the metadata the registry checker reads:

```markdown
# Blueprint 0xNNNNNN: Title

**Classification:** Canonical Full Specification
**Implementation Status:** Implemented | In-Progress | Proposed
**Verified Artifacts:** existing files that implement the described module, or None
**Planned Artifacts:** absent files, or None
**Owned Source Files:** self-relative JavaScript paths, or None
**Former Blueprint Paths:** previous paths of this file
```

The body states the objective, the design and its verification conditions.

---

## 7. Key Concepts

### 7.1 Virtual File System (VFS)

The VFS is REPLOID's memory. All artifacts - source code, configuration, state - exist as files in the VFS backed by IndexedDB. The agent can read and write any file, enabling true self-modification.

### 7.2 Tools

Tools are the agent's hands. Each tool is a JavaScript module that performs a specific action:

- **ReadFile**: Read file content
- **WriteFile**: Write file content
- **CreateTool**: Create new tools (L1 RSI)
- **Grep / Find / ListFiles**: Search the VFS
- **SpawnWorker / AwaitWorkers**: Run typed sub-agents

The full set is in `self/tools/`.

### 7.3 Personas

Personas define the agent's identity and behavior:

- System prompt template
- Default goals
- Capability restrictions
- UI theme

### 7.4 UI

Modules do not ship their own widgets. The boot homes, wizard, proto and Zero views under `self/ui/` read module state through the DI container and the event bus.

---

## 8. Boot Sequence

```
1. The page loads host/start-app.js (entry/start-app.js only forwards to it)
2. start-app.js shows the route's boot home (Reploid home, Zero home, locked home or wizard)
3. The operator's Awaken calls window.triggerAwaken(goal)
4. Reploid mode: reploid-launch.js imports runtime.js and the capsule UI, mounts the UI and starts the runtime
5. Zero/X modes: boot-helpers boot() loads the genesis level, registers modules in the DI container,
   resolves the VFS, resets session files, creates the genesis snapshot and resolves core services
6. completeAwaken() mounts the UI and runs the agent loop with the goal
```

See [0x000002](0x000002-application-orchestration.md) for details.

---

## 9. Optional contract extensions

REPLOID is designed for continuous evolution:

1. **Tool Creation**: Agent creates tools to extend capabilities
2. **Meta-Learning**: Agent improves its learning algorithms
3. **Architecture Evolution**: Core substrate can be upgraded
4. **Multi-Agent Swarms**: Multiple agents collaborate
5. **External Integration**: MCP servers for real-world access

---

## 10. Getting Started

To understand REPLOID, read blueprints in this order:

1. **0x000000** (This document) - System overview
2. [0x000002](0x000002-application-orchestration.md) - Boot and orchestration
3. [0x000011](0x000011-advanced-storage-backend-indexeddb.md) - VFS architecture
4. [0x000005](0x000005-state-management-architecture.md) - State management
5. [0x000008](0x000008-agent-cognitive-cycle.md) - Agent cognitive cycle
6. [0x000040](0x000040-verification-manager.md) - Verification and safety
7. [0x000049](0x000049-hitl-controller.md) - HITL oversight
8. [0x000015](0x000015-dynamic-tool-creation.md) - Dynamic tool creation (L1 RSI)

---

## 11. Status display

No Genesis status widget exists. Module status is shown by the UI surfaces under `self/ui/`.

---

*Blueprint 0x000000 - The Genesis of REPLOID*
