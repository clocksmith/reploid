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
- **[dreamer/reploid/blueprints/](../dreamer/reploid/blueprints/)** - Architectural specifications (100+ files)

**Key Blueprints:**
- [0x000002 - Application Orchestration](../dreamer/reploid/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../dreamer/reploid/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000047 - Verification Manager](../dreamer/reploid/blueprints/0x000047-verification-manager.md) - Safety checks
- [0x000051 - HITL Controller](../dreamer/reploid/blueprints/0x000051-hitl-controller.md) - Human oversight
- [0x000043 - Genesis Snapshot](../dreamer/reploid/blueprints/0x000043-genesis-snapshot-system.md) - Rollback system
- [0x000034 - Swarm Orchestration](../dreamer/reploid/blueprints/0x000034-swarm-orchestration.md) - Multi-agent

### Reference
- **[docs/API.md](./API.md)** - Module API documentation
- **[docs/LOCAL_MODELS.md](./LOCAL_MODELS.md)** - WebLLM and Ollama setup
- **[docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[docs/CYCLICAL_ACRONYMS.md](./CYCLICAL_ACRONYMS.md)** - Cyclical acronyms taxonomy
- **[docs/STYLE_GUIDE.md](./STYLE_GUIDE.md)** - Code and UI conventions
- **[docs/SECURITY.md](./SECURITY.md)** - Security model and containment layers
- **[docs/CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines

---

## Code Organization

```
reploid/
├── dreamer/reploid/            # Main application
│   ├── index.html              # Boot screen entry point
│   ├── boot.js                 # Hydration and initialization
│   ├── sw-module-loader.js     # Service worker for VFS modules
│   │
│   ├── core/                   # Core substrate
│   │   ├── agent-loop.js       # Cognitive cycle (Think → Act → Observe)
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
2. [QUICK-START.md](./QUICK-START.md) - Get running
3. [OPERATIONAL_MODES.md](./OPERATIONAL_MODES.md) - Configure connections

### For Developers
1. [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) - Understand architecture
2. [blueprints/README.md](../dreamer/reploid/blueprints/README.md) - Study specifications
3. [API.md](./API.md) - Learn module APIs
4. [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
5. [tools/README.md](../dreamer/reploid/tools/README.md) - Tool development

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [blueprints/0x000015-dynamic-tool-creation.md](../dreamer/reploid/blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x000066-recursive-goal-decomposition.md](../dreamer/reploid/blueprints/0x000066-recursive-goal-decomposition.md) - Recursive goal decomposition

### For Security Researchers
1. [SECURITY.md](./SECURITY.md) - Security model and containment
2. [blueprints/0x000047-verification-manager.md](../dreamer/reploid/blueprints/0x000047-verification-manager.md) - Verification and sandbox design
3. [blueprints/0x000067-circuit-breaker-pattern.md](../dreamer/reploid/blueprints/0x000067-circuit-breaker-pattern.md) - Failure containment

---

## Quick Reference

**Key Files:**
- `dreamer/reploid/config/genesis-levels.json` - Module registry and worker types
- `dreamer/reploid/boot.js` - Application bootstrap
- `dreamer/reploid/index.html` - Entry point

**Key Directories:**
- `dreamer/reploid/core/` - Agent substrate modules
- `dreamer/reploid/tools/` - Dynamic agent tools
- `dreamer/reploid/infrastructure/` - Support services
- `dreamer/reploid/ui/` - Proto UI
- `dreamer/reploid/blueprints/` - Architectural specifications
- `docs/` - Human-facing documentation

---

*Last updated: December 2025*
