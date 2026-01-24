# REPLOID Documentation Index

Guide to all documentation in the REPLOID project.

---

## Getting Started

1. **[/README.md](../README.md)** - Project overview, quick start, RSI concepts
2. **[docs/quick-start.md](./quick-start.md)** - Detailed setup and first run
3. **[docs/operational-modes.md](./operational-modes.md)** - Connection modes and configurations

---

## Core Documentation

### Architecture
- **[docs/system-architecture.md](./system-architecture.md)** - Complete system design
- **[./src/blueprints/](../src/blueprints/)** - Architectural specifications (100+ files)

**Key Blueprints:**
- [0x000002 - Application Orchestration](../src/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../src/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000047 - Verification Manager](../src/blueprints/0x000047-verification-manager.md) - Safety checks
- [0x000051 - HITL Controller](../src/blueprints/0x000051-hitl-controller.md) - Human oversight
- [0x000043 - Genesis Snapshot](../src/blueprints/0x000043-genesis-snapshot-system.md) - Rollback system
- [0x000034 - Swarm Orchestration](../src/blueprints/0x000034-swarm-orchestration.md) - Multi-agent

### Vision and Contracts
- **[docs/substrate.md](./substrate.md)** - Substrate + Ouroboros contract

### Reference
- **[docs/api.md](./api.md)** - Module API documentation
- **[docs/multi-model-evaluation.md](./multi-model-evaluation.md)** - Multi-model evaluation harness
- **[docs/configuration.md](./configuration.md)** - Boot page settings and localStorage keys
- **[docs/local-models.md](./local-models.md)** - WebLLM and Ollama setup
- **[docs/troubleshooting.md](./troubleshooting.md)** - Common issues and solutions
- **[docs/style-guide.md](./style-guide.md)** - Code and UI conventions
- **[docs/security.md](./security.md)** - Security model and containment layers
- **[docs/contributing.md](./contributing.md)** - Contribution guidelines

---

## Code Organization

```
reploid/
├── src/                        # Main application
│   ├── index.html              # Entry point
│   ├── entry/seed-vfs.js            # VFS hydration + SW activation
│   ├── entry/start-app.js                 # Boot orchestrator
│   ├── sw-module-loader.js     # Service worker for VFS modules
│   │
│   ├── core/                   # Core substrate
│   │   ├── agent-loop.js       # Cognitive cycle (Think -> Act -> Observe)
│   │   ├── vfs.js              # Virtual filesystem (IndexedDB)
│   │   ├── llm-client.js       # Multi-provider LLM abstraction
│   │   ├── tool-runner.js      # Dynamic tool loading/execution
│   │   └── verification-manager.js  # Pre-flight safety checks
│   │
│   ├── infrastructure/         # Support services
│   │   ├── event-bus.js        # Pub/sub event system
│   │   ├── di-container.js     # Dependency injection
│   │   ├── hitl-controller.js  # Human-in-the-loop oversight
│   │   └── audit-logger.js     # Execution logging
│   │
│   ├── capabilities/           # Extended capabilities
│   │   └── communication/      # Swarm sync, WebRTC transport
│   │
│   ├── tools/                  # Agent tools (CamelCase)
│   │
│   ├── config/                 # Configuration
│   │   └── genesis-levels.json # Module/worker/role definitions
│   │
│   ├── blueprints/             # Architectural specifications
│   │   └── (100+ design docs)
│   │
│   └── tests/                  # Test suites
│
├── docs/                       # Human-facing documentation
└── server/                     # Proxy server
```

---

## Reading Guide

### For New Users
1. [README.md](../README.md) - Understand REPLOID
2. [quick-start.md](./quick-start.md) - Get running
3. [operational-modes.md](./operational-modes.md) - Configure connections

### For Developers
1. [system-architecture.md](./system-architecture.md) - Understand architecture
2. [blueprints/README.md](../src/blueprints/README.md) - Study specifications
3. [api.md](./api.md) - Learn module APIs
4. [contributing.md](./contributing.md) - Contribution guidelines
5. [tools/README.md](../src/tools/README.md) - Tool development

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [blueprints/0x000015-dynamic-tool-creation.md](../src/blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x000066-recursive-goal-decomposition.md](../src/blueprints/0x000066-recursive-goal-decomposition.md) - Recursive goal decomposition

### For Security Researchers
1. [security.md](./security.md) - Security model and containment
2. [blueprints/0x000047-verification-manager.md](../src/blueprints/0x000047-verification-manager.md) - Verification and sandbox design
3. [blueprints/0x000067-circuit-breaker-pattern.md](../src/blueprints/0x000067-circuit-breaker-pattern.md) - Failure containment

---

## Quick Reference

**Key Files:**
- `./src/config/genesis-levels.json` - Module registry and worker types
- `./src/entry/seed-vfs.js` - VFS hydration and boot loader
- `./src/entry/start-app.js` - Application bootstrap
- `./src/index.html` - Entry point

**Key Directories:**
- `./src/core/` - Agent substrate modules
- `./src/tools/` - Dynamic agent tools
- `./src/infrastructure/` - Support services
- `./src/ui/` - Proto UI
- `./src/blueprints/` - Architectural specifications
- `docs/` - Human-facing documentation. Internal module system invariants and migration checklist live in the private wrapper repo.

**External Dependencies:**
- `@clocksmith/doppler` - WebGPU inference engine (vendored at `reploid/doppler/`)

---

*Last updated: March 2026*
