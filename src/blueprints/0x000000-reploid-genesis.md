# Blueprint 0x000000: REPLOID Genesis

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

|-- index.html              # Entry point
|-- entry/start-app.js                 # Hydration and initialization
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
|   |-- event-bus.js        # Pub/sub event system
|   |-- di-container.js     # Dependency injection
|   |-- hitl-controller.js  # Human-in-the-loop oversight
|   +-- audit-logger.js     # Execution logging
|
|-- capabilities/           # Extended capabilities
|   +-- communication/      # Swarm sync, WebRTC transport
|
|-- tools/                  # Agent tools (CamelCase)
|   |-- ReadArtifact.js
|   |-- WriteArtifact.js
|   |-- CreateTool.js
|   +-- ...
|
|-- config/                 # Configuration
|   |-- genesis-levels.json # Module/worker/role definitions
|   +-- module-manifest.json
|
|-- ui/                     # Proto UI components
|   |-- panels/             # UI panels
|   +-- components/         # Shared UI components
|
|-- testing/                # Test framework
|
+-- blueprints/             # Architectural specifications (this directory)
    +-- 0x000000-reploid-genesis.md  # You are here
```

### 3.2 Module Architecture

Every REPLOID module follows the factory pattern:

```javascript
const ModuleName = {
  metadata: {
    id: 'ModuleName',
    version: '1.0.0',
    dependencies: ['Dep1', 'Dep2'],
    type: 'core|infrastructure|tool|ui'
  },
  factory: (deps = {}) => {
    // Private state (closure)
    const _state = {};

    // Web Component widget
    class ModuleNameWidget extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
      }
      // ... lifecycle methods, getStatus(), render()
    }

    return {
      api: { /* public methods */ },
      widget: {
        element: 'module-name-widget',
        displayName: 'Module Name',
        icon: '...',
        category: 'core'
      }
    };
  }
};
```

### 3.3 Key Subsystems

| Subsystem | Blueprint | Purpose |
|-----------|-----------|---------|
| Agent Loop | 0x000008 | Core cognitive cycle |
| VFS | 0x000003 | Virtual file system (IndexedDB) |
| State Manager | 0x000005 | Centralized state |
| LLM Client | 0x000007 | Multi-provider inference |
| Tool Runner | 0x000009 | Dynamic tool execution |
| DI Container | 0x00004A | Dependency injection |
| Event Bus | 0x000041 | Pub/sub messaging |
| HITL Controller | 0x000051 | Human oversight |
| Verification Manager | 0x000047 | Safety sandbox |
| Genesis Snapshot | 0x000043 | Rollback system |

---

## 4. RSI Levels

REPLOID categorizes self-modification by risk level:

| Level | Scope | Examples | Safety Gate |
|-------|-------|----------|-------------|
| **L1** | Tools | CreateTool, new tool in `/tools/` | Verification Worker |
| **L2** | Meta | Modify tool-writer, improve CreateTool | Arena consensus |
| **L3** | Substrate | EditFile agent-loop.js, core modules | HITL approval required |

Higher levels require progressively stronger safety mechanisms.

---

## 5. Safety Architecture

### 5.1 Containment Layers

1. **Browser Sandbox**: OS-level isolation
2. **VFS Isolation**: All files in IndexedDB, no real filesystem access
3. **Verification Worker**: Executes code in isolated Web Worker before commit
4. **Genesis Snapshot**: Immutable recovery point
5. **HITL Gates**: Human approval for critical operations

### 5.2 Genesis Kernel

The Genesis Kernel is an immutable snapshot of the minimal viable agent. It cannot be modified and serves as the ultimate recovery mechanism. If the agent enters an unrecoverable state, it can be restored to Genesis.

See Blueprint 0x000043 for details.

### 5.3 Circuit Breaker

The circuit breaker pattern prevents cascading failures:

- **Closed**: Normal operation
- **Open**: Too many failures, stop executing
- **Half-Open**: Test recovery before resuming

See Blueprint 0x000067 for implementation.

---

## 6. The Blueprint System

Blueprints are knowledge artifacts that document architectural decisions and implementation patterns. They enable:

- **Knowledge Transfer**: Agent can learn from blueprints
- **Self-Documentation**: System describes itself
- **Evolution Tracking**: Changes are recorded over time
- **Reproducibility**: Agent can rebuild capabilities from blueprints

### 6.1 Blueprint Categories

| Range | Category | Purpose |
|-------|----------|---------|
| 0x000000-0x000FFF | Upgrade | Specific module implementations |
| 0x001000-0x001FFF | Meta | Patterns and principles |
| 0x002000-0x002FFF | Integration | System-level architecture |
| 0x003000-0x003FFF | Evolution | Transformation patterns |

### 6.2 Blueprint Structure

Every blueprint follows this structure:

```markdown
# Blueprint 0xNNNNNN: Title

**Objective:** What this blueprint achieves
**Target Upgrade:** 4-char ID and filename
**Prerequisites:** Required blueprints
**Affected Artifacts:** Files created/modified

---

### 1. The Strategic Imperative
Why this capability matters

### 2. The Architectural Solution
High-level design

### 3. The Implementation Pathway
Step-by-step instructions

### 4+. Additional Sections
As needed

### N. Web Component Widget
Proto widget implementation
```

---

## 7. Key Concepts

### 7.1 Virtual File System (VFS)

The VFS is REPLOID's memory. All artifacts - source code, configuration, state - exist as files in the VFS backed by IndexedDB. The agent can read and write any file, enabling true self-modification.

### 7.2 Tools

Tools are the agent's hands. Each tool is a JavaScript module that performs a specific action:

- **ReadArtifact**: Read file content
- **WriteArtifact**: Write file content
- **CreateTool**: Create new tools (L1 RSI)
- **ExecuteCode**: Run code in sandbox
- **SearchBlueprints**: Query architectural knowledge

### 7.3 Personas

Personas define the agent's identity and behavior:

- System prompt template
- Default goals
- Capability restrictions
- UI theme

### 7.4 Proto Widgets

Every module includes a Web Component widget for the Proto UI. Widgets provide:

- **Status Display**: Current state, metrics, last activity
- **Interactive Controls**: Buttons, forms for manual intervention
- **Real-time Updates**: Auto-refresh via intervals

---

## 8. Boot Sequence

```
1. index.html loads entry/start-app.js
2. entry/start-app.js initializes VFS
3. Load app-logic.js (orchestrator)
4. Load utils.js and di-container.js (foundation)
5. Register config and Persona
6. Load all modules via DI container
7. Resolve dependencies topologically
8. Initialize UI
9. Start agent loop (if auto-run enabled)
```

See Blueprint 0x000002 for details.

---

## 9. Evolution Opportunities

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
2. **0x000002** - Boot and orchestration
3. **0x000003** - VFS architecture
4. **0x000005** - State management
5. **0x000008** - Agent cognitive cycle
6. **0x000047** - Verification and safety
7. **0x000051** - HITL oversight
8. **0x000015** - Dynamic tool creation (L1 RSI)

---

## 11. Proto Widget

The Genesis Widget provides system-wide status:

```javascript
class GenesisWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 5000);
  }

  disconnectedCallback() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  getStatus() {
    return {
      state: 'idle',
      primaryMetric: 'Genesis Active',
      secondaryMetric: `${blueprintCount} blueprints`,
      lastActivity: Date.now(),
      message: 'REPLOID substrate operational'
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: monospace;
          font-size: 12px;
          color: #e0e0e0;
        }
        .genesis-panel {
          background: linear-gradient(135deg, #1a1a2e, #16213e);
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #0f3460;
        }
        h4 {
          margin: 0 0 12px 0;
          color: #0ff;
        }
        .metric {
          display: flex;
          justify-content: space-between;
          margin: 4px 0;
        }
        .value {
          color: #0f0;
        }
      </style>
      <div class="genesis-panel">
        <h4>Genesis Substrate</h4>
        <div class="metric">
          <span>Status:</span>
          <span class="value">Operational</span>
        </div>
        <div class="metric">
          <span>RSI Level:</span>
          <span class="value">L1 Enabled</span>
        </div>
        <div class="metric">
          <span>Blueprints:</span>
          <span class="value">${blueprintCount}</span>
        </div>
        <div class="metric">
          <span>Modules:</span>
          <span class="value">${moduleCount}</span>
        </div>
      </div>
    `;
  }
}

const elementName = 'genesis-widget';
if (!customElements.get(elementName)) {
  customElements.define(elementName, GenesisWidget);
}

const widget = {
  element: elementName,
  displayName: 'Genesis',
  icon: '⛊',
  category: 'core',
  order: 0
};
```

---

## Remember

REPLOID is not just software - it is a **living system** capable of evolution. Every line of code, every blueprint, every tool exists to serve the core mission: **safe, transparent, recursive self-improvement**.

The agent that reads this blueprint can modify itself. Use this power wisely.

---

*Blueprint 0x000000 - The Genesis of REPLOID*
