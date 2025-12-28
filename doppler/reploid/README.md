# REPLOID

**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference **D**oppler

Browser-native sandbox for safe AI agent development with self-modification capabilities.

[![GitHub](https://img.shields.io/github/license/clocksmith/reploid)](https://github.com/clocksmith/reploid/blob/main/LICENSE)

**[Try it live](https://replo.id/r)** | **[GitHub](https://github.com/clocksmith/reploid)**

## Features

- **Browser-native** - Runs entirely in-browser with IndexedDB-backed virtual filesystem
- **Recursive self-improvement** - Agents can create and modify their own tools (L1-L3 RSI)
- **Safety gates** - Verification workers, HITL approval, arena consensus
- **Multi-model** - OpenAI, Anthropic, Google, Ollama, WebLLM via DOPPLER
- **Genesis snapshots** - Instant rollback to pristine state, works offline

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER ORIGIN                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Proto UI   │    │  Agent Loop  │    │   Workers    │      │
│  │  (Operator)  │◄──►│ Think→Act→   │◄──►│ (Sub-agents) │      │
│  │              │    │    Observe   │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Tool Runner                          │   │
│  │         (dynamic loading, permission filtering)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │     VFS      │    │  Verification│    │     HITL     │      │
│  │  (IndexedDB) │    │    Worker    │    │  Controller  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## RSI Levels

Recursive Self-Improvement with graduated safety gates:

| Level | Scope | Examples | Safety Gate |
|-------|-------|----------|-------------|
| **L1** | Tools | CreateTool - new agent tools | Verification Worker sandbox |
| **L2** | Meta | Modify tool-writer, improve CreateTool | Arena consensus |
| **L3** | Substrate | Edit agent-loop.js, core modules | HITL human approval |

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server with API proxies
npm run dev           # Full dev at http://localhost:8000

# Or start simple server
npm start             # Dev server at http://localhost:8080
```

## Genesis Levels

Boot configurations that control which modules load:

| Level | Modules | Description |
|-------|---------|-------------|
| **Tabula Rasa** | ~13 | Minimal core, fastest boot |
| **Reflection** | ~19 | + Streaming, verification, HITL |
| **Full Substrate** | ~32 | + Arena, semantic memory, workers, swarm |

## Operational Modes

| Mode | Setup | Use Case |
|------|-------|----------|
| **Client-Only** | Paste API key in boot screen | Quick start, zero setup |
| **Multiple APIs** | Configure multiple providers | Fallback, cost optimization |
| **Proxy Server** | Run `npm run dev` | Team sharing, key security |
| **Local WebGPU** | DOPPLER integration | 100% offline, privacy |

## Safety Stack

1. **VFS Containment** - All file I/O virtualized, no host access
2. **Service Worker** - ES6 imports served from IndexedDB
3. **Genesis Snapshots** - Instant rollback to pristine state
4. **Verification Worker** - Syntax validation, forbidden pattern detection
5. **Arena Gating** - Multi-model consensus for risky changes
6. **Circuit Breakers** - Automatic failure recovery
7. **HITL Controller** - Human approval gates

## Tools

Dynamic tools loaded from `/tools/` at boot:

| Category | Tools |
|----------|-------|
| **Core VFS** | ReadFile, WriteFile, ListFiles, DeleteFile |
| **Meta (RSI)** | CreateTool, LoadModule, ListTools |
| **Workers** | SpawnWorker, ListWorkers, AwaitWorkers |
| **Shell-like** | Cat, Head, Tail, Ls, Pwd, Touch, Mkdir, Rm, Mv, Cp |
| **Search** | Grep, Find, Sed, Jq, FileOutline |
| **Edit** | Edit (literal match/replace) |
| **Version Control** | Git (VFS-scoped) |

## Documentation

- [Documentation Index](docs/INDEX.md) - Complete documentation guide
- [System Architecture](docs/SYSTEM_ARCHITECTURE.md) - Detailed system design
- [Quick Start](docs/QUICK-START.md) - Setup and first run
- [Configuration](docs/CONFIGURATION.md) - Boot settings and localStorage keys
- [Security](docs/SECURITY.md) - Security model and containment
- [API Reference](docs/API.md) - Module APIs
- [Contributing](docs/CONTRIBUTING.md) - Development guidelines

## Requirements

- Modern browser with ES modules support
- WebGPU browser for local inference (Chrome 113+, Edge 113+)
- Node.js 16+ for dev server

## Related

- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine for local model execution

## License

MIT
