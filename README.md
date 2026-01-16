# REPLOID

**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference **D**oppler

Browser-native recursive self-improvement—an agent that rewrites its own code and kernels in a live loop. Powered by [Doppler](https://github.com/clocksmith/doppler).
Reploid is the driver; Doppler is the engine.

**[Try it live](https://replo.id/r)** | **[GitHub](https://github.com/clocksmith/reploid)**

## Why This Works

| Capability | Claim |
|------------|-------|
| **VFS hot-reload** | IndexedDB-backed filesystem ([BrowserFS](https://github.com/jvilk/BrowserFS)) |
| **WebGPU in-process** | 80% native performance ([WebLLM 2024](https://arxiv.org/abs/2412.15803)) |
| **Zero-install** | URL distribution via PWA |
| **Tight RSI loop** | Validated by [Gödel Agent](https://arxiv.org/abs/2410.04444), [RISE NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/639d992f819c2b40387d4d5170b8ffd7-Paper-Conference.pdf) |

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

## Quick Start

```bash
npm install
npm start         # Proxy server at :8000
```

## RSI Levels

| Level  | Scope     | Examples                     | Safety Gate              |
|--------|-----------|------------------------------|--------------------------|
| **L1** | Tools     | CreateTool - new agent tools | Verification Worker      |
| **L2** | Meta      | Modify tool-writer           | Arena consensus          |
| **L3** | Substrate | Edit agent-loop.js           | Arena + Genesis rollback |

## Genesis Levels

Progressive capability loading - each level extends the previous:

| Level          | Total | Added | Description                                    |
|----------------|-------|-------|------------------------------------------------|
| **TABULA**     | 7     | 7     | Bootstrap core (VFS, EventBus, StateManager)   |
| **SPARK**      | 18    | +11   | Agent loop, LLM client, tool runner            |
| **REFLECTION** | 24    | +6    | Streaming, verification, HITL                  |
| **COGNITION**  | 35    | +11   | Memory, knowledge graph, GEPA optimizer        |
| **SUBSTRATE**  | 47    | +12   | Audit, replay, sandbox, worker manager         |
| **FULL**       | 61    | +14   | Arena, swarm, multi-model, federated learning  |

See `docs/CONFIGURATION.md` and `docs/OPERATIONAL_MODES.md` for level-specific module lists and behavior.

## Tools

| Category       | Tools                                              |
|----------------|----------------------------------------------------|
| **Core VFS**   | ReadFile, WriteFile, ListFiles, DeleteFile         |
| **Meta (RSI)** | CreateTool, LoadModule, ListTools                  |
| **Workers**    | SpawnWorker, ListWorkers, AwaitWorkers             |
| **Shell-like** | Cat, Head, Tail, Ls, Pwd, Touch, Mkdir, Rm, Mv, Cp |
| **Search**     | Grep, Find, Sed, Jq, FileOutline                   |
| **Edit**       | Edit (literal match/replace)                       |

## Documentation

Start at `docs/INDEX.md`, then:
- `docs/QUICK-START.md`
- `docs/CONFIGURATION.md`
- `docs/OPERATIONAL_MODES.md`
- `docs/TESTING.md`
- `docs/SECURITY.md`

## Requirements

- Modern browser with ES modules
- WebGPU for local inference (Chrome 113+)
- Node.js 16+ for dev server

## Related

- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine

## Inspiration

- [Gato](https://arxiv.org/abs/2205.06175) - A Generalist Agent (DeepMind)
- [GEPA](https://arxiv.org/abs/2507.19457) - Reflective Prompt Evolution
- [ReAct](https://arxiv.org/abs/2210.03629) - Synergizing Reasoning and Acting
- [SWE-agent](https://arxiv.org/abs/2405.15793) - Agent-Computer Interfaces
- [Tree of Thoughts](https://arxiv.org/abs/2305.10601) - Deliberate problem solving
- [Reploid](https://megaman.fandom.com/wiki/Reploid) - Mega Man X series

## License

MIT
