# REPLOID Documentation Index

Guide to all documentation in the REPLOID project.

---

## Getting Started

1. **[/README.md](../README.md)** - Project overview, quick start, RSI concepts
2. **[docs/QUICK-START.md](./QUICK-START.md)** - Detailed setup and first run
3. **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Connection modes and boot configuration

---

## Core Documentation

### Architecture
- **[docs/system-architecture.md](./system-architecture.md)** - Complete system design
- **[./self/blueprints/](../self/blueprints/)** - Architectural specifications (216+ files)

**Key Blueprints:**
- [0x000002 - Application Orchestration](../self/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../self/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000040 - Verification Manager](../self/blueprints/0x000040-verification-manager.md) - Safety checks
- [0x000049 - HITL Controller](../self/blueprints/0x000049-hitl-controller.md) - Human oversight
- [0x00003C - Genesis Snapshot](../self/blueprints/0x00003C-genesis-snapshot-system.md) - Rollback system
- [0x000031 - Swarm Orchestration](../self/blueprints/0x000031-swarm-orchestration.md) - Multi-agent

### Vision and Contracts
- **[docs/substrate.md](./substrate.md)** - Substrate + Ouroboros contract

### Reference
- **[docs/API.md](./API.md)** - Module API documentation
- **[docs/multi-model-evaluation.md](./multi-model-evaluation.md)** - Multi-model evaluation harness
- **[docs/intent-bundle-lora.md](./intent-bundle-lora.md)** - Intent bundle LoRA workflow
- **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Boot UI settings and localStorage keys
- **[docs/local-models.md](./local-models.md)** - WebLLM and Ollama setup
- **[docs/style-guide.md](./style-guide.md)** - Code and UI conventions
- **[docs/SECURITY.md](./SECURITY.md)** - Security model and containment layers

---

## Code Organization

```
reploid/
├── self/                       # Browser application and public root
│   ├── index.html              # Entry point
│   ├── entry/seed-vfs.js       # VFS hydration compatibility shim
│   ├── entry/start-app.js      # Bootstrapper compatibility shim
│   ├── sw-module-loader.js     # Service worker for VFS modules
│   │
│   ├── host/                   # VFS seeding and runtime handoff
│   ├── kernel/                 # Immutable boot shell
│   ├── capsule/                # Capsule UI
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
│   │   └── (216+ design docs)
│   │
├── tests/                      # Test suites
│
├── docs/                       # Human-facing documentation
└── server/                     # Proxy server
```

---

## Reading Guide

### For New Users
1. [README.md](../README.md) - Understand REPLOID
2. [QUICK-START.md](./QUICK-START.md) - Get running
3. [CONFIGURATION.md](./CONFIGURATION.md) - Configure connections

### For Developers
1. [system-architecture.md](./system-architecture.md) - Understand architecture
2. [blueprints/README.md](../self/blueprints/README.md) - Study specifications
3. [API.md](./API.md) - Learn module APIs
4. [tools/README.md](../self/tools/README.md) - Tool development

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [blueprints/0x000015-dynamic-tool-creation.md](../self/blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x00005B-recursive-goal-decomposition.md](../self/blueprints/0x00005B-recursive-goal-decomposition.md) - Recursive goal decomposition

### For Security Researchers
1. [SECURITY.md](./SECURITY.md) - Security model and containment
2. [blueprints/0x000040-verification-manager.md](../self/blueprints/0x000040-verification-manager.md) - Verification and sandbox design
3. [blueprints/0x00005C-circuit-breaker-pattern.md](../self/blueprints/0x00005C-circuit-breaker-pattern.md) - Failure containment

---

## Quick Reference

**Key Files:**
- `./self/config/genesis-levels.json` - Module registry and worker types
- `./self/entry/seed-vfs.js` - VFS hydration compatibility shim
- `./self/entry/start-app.js` - Application bootstrap compatibility shim
- `./self/index.html` - Entry point

**Key Directories:**
- `./self/` - Agent substrate modules and public web root
- `./self/tools/` - Dynamic agent tools
- `./self/infrastructure/` - Support services
- `./self/ui/` - Proto UI
- `./self/blueprints/` - Architectural specifications
- `docs/` - Human-facing documentation. Internal module system invariants and migration checklist live in the private wrapper repo.

**External Links:**
- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine (separate repo)

---

*Last updated: March 2026*
