# REPLOID Documentation Index

Guide to all documentation in the REPLOID project.

---

## Getting Started

1. **[/README.md](../README.md)** - Project overview, quick start, RSI concepts
2. **[docs/QUICK-START.md](./QUICK-START.md)** - Detailed setup and first run
3. **[docs/OPERATIONAL_MODES.md](./OPERATIONAL_MODES.md)** - Connection modes and configurations

---

## Core Documentation

### Architecture
- **[docs/SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)** - Complete system design
- **[/blueprints/](../blueprints/)** - Architectural specifications (100+ files)
  - See [blueprints/README.md](../blueprints/README.md) for index

### Reference
- **[docs/API.md](./API.md)** - Module API documentation
- **[docs/LOCAL_MODELS.md](./LOCAL_MODELS.md)** - WebLLM and Ollama setup
- **[docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[docs/STYLE_GUIDE.md](./STYLE_GUIDE.md)** - Code and UI conventions

---

## Code Organization

```
reploid/
├── index.html              # Boot screen entry point
├── boot.js                 # Hydration and initialization
├── sw-module-loader.js     # Service worker for VFS modules
│
├── core/                   # Core substrate
│   ├── agent-loop.js       # Cognitive cycle (Think → Act → Observe)
│   ├── vfs.js              # Virtual filesystem (IndexedDB)
│   ├── llm-client.js       # Multi-provider LLM abstraction
│   ├── tool-runner.js      # Dynamic tool loading/execution
│   ├── worker-manager.js   # Multi-worker orchestration
│   ├── persona-manager.js  # System prompt customization
│   ├── response-parser.js  # Tool call parsing
│   └── verification-manager.js  # Pre-flight safety checks
│
├── infrastructure/         # Support services
│   ├── event-bus.js        # Pub/sub event system
│   ├── di-container.js     # Dependency injection
│   ├── hitl-controller.js  # Human-in-the-loop oversight
│   ├── audit-logger.js     # Execution logging
│   ├── circuit-breaker.js  # Failure tracking
│   └── rate-limiter.js     # API rate limiting
│
├── ui/                     # User interface
│   └── proto.js            # Proto UI (main interface)
│
├── tools/                  # Agent tools (CamelCase)
│   ├── ReadFile.js, WriteFile.js, ...
│   ├── SpawnWorker.js, ListWorkers.js, AwaitWorkers.js
│   └── python/             # Pyodide runtime
│
├── config/                 # Configuration
│   └── genesis-levels.json # Module/worker/role definitions
│
├── testing/                # Test infrastructure
│   └── arena/              # Arena harness and VFS sandbox
│
├── docs/                   # Documentation
├── blueprints/             # Architectural specifications
└── server/                 # Proxy server
```

---

## Reading Guide

### For New Users
1. [README.md](../README.md) - Understand REPLOID
2. [QUICK-START.md](./QUICK-START.md) - Get running
3. [OPERATIONAL_MODES.md](./OPERATIONAL_MODES.md) - Configure connections

### For Developers
1. [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) - Understand architecture
2. [blueprints/README.md](../blueprints/README.md) - Study specifications
3. [API.md](./API.md) - Learn module APIs
4. [tools/README.md](../tools/README.md) - Tool development

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [blueprints/0x000015-dynamic-tool-creation.md](../blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x000016-meta-tool-creation-patterns.md](../blueprints/0x000016-meta-tool-creation-patterns.md) - Meta-tools

---

## Quick Reference

**Key Files:**
- `/config/genesis-levels.json` - Module registry and worker types
- `/boot.js` - Application bootstrap
- `/index.html` - Entry point

**Key Directories:**
- `/core` - Agent substrate modules
- `/tools` - Dynamic agent tools
- `/infrastructure` - Support services
- `/ui` - Proto UI
- `/docs` - Documentation
- `/blueprints` - Architectural specifications

---

*Last updated: December 2025*
