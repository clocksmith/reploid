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

---

## Code Organization

```
reploid/
├── core/                   # Substrate modules (immutable)
│   ├── agent-loop.js       # Main cognitive cycle
│   ├── vfs.js              # Virtual filesystem
│   └── ...
│
├── workflow/               # Sentinel workflow
│   ├── sentinel-fsm.js     # State machine
│   └── sentinel-tools.js   # PAWS tools
│
├── infrastructure/         # System services
│   ├── event-bus.js        # Event system
│   └── ...
│
├── capabilities/           # Agent capabilities
├── ui/                     # UI panels
├── blueprints/             # Architecture specs
├── bin/                    # CLI tools
├── server/                 # Proxy server
└── docs/                   # Documentation
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

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [blueprints/0x000015-dynamic-tool-creation.md](../blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x000016-meta-tool-creation-patterns.md](../blueprints/0x000016-meta-tool-creation-patterns.md) - Meta-tools

---

## Quick Reference

**Key Files:**
- `/config.json` - Module registry
- `/boot.js` - Application bootstrap
- `/index.html` - Entry point

**Documentation:**
- `/docs` - This documentation hub
- `/blueprints` - Architectural specifications

---

*Last updated: 2025-11-20*
