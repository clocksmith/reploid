# REPLOID

```
REPLOID = Recursive Evolution Protocol Loop Optimizing Intelligent DREAMER
DREAMER = Dynamic Recursive Engine Adapting Modules Evolving REPLOID
→ REPLOID ↔ DREAMER ↔ ∞
```

> Browser-based AI agent sandbox

AI agent that runs entirely client-side. Uses IndexedDB as a virtual filesystem. Supports recursive self-improvement (RSI) — the agent can create, modify, and improve its own tools at runtime, including the tool-creation mechanism itself.

## Quick Start

```bash
git clone https://github.com/clocksmith/reploid
cd reploid/dreamer/reploid
npm install
npm run dev
# Open http://localhost:8080
```

Or use the hosted version at https://replo.id

## How It Works

```mermaid
graph TD
    Agent[Agent Loop] --> LLM[LLM Client]
    Agent --> Tools[Tool Runner]
    Tools --> VFS[(Virtual File System)]
    Tools --> Verify[Verification Worker]
    Verify --> VFS
```

1. Agent receives a goal
2. LLM decides which tool to call
3. Tool executes against the VFS (IndexedDB)
4. Results feed back to agent
5. Repeat until done or iteration limit (default 50)

### LLM Options

Designed for local-first use, but supports frontier models:

| Mode | Provider | Notes |
|------|----------|-------|
| Local | WebLLM | Runs in browser via WebGPU, fully offline |
| Local | Ollama | Local server, connect via proxy |
| API | OpenAI, Anthropic, Google, Groq | Direct from client or via proxy |

The proxy (`npm start`) routes API calls through your machine for CORS and key management.

### Components

- **VFS** — Virtual filesystem in IndexedDB with snapshot/restore
- **LLM Client** — Multi-provider abstraction
- **Tool Runner** — Loads tools from VFS, executes them
- **Verification Worker** — Syntax checks code before writing to VFS
- **Worker Manager** — Spawns subagents with permission tiers (read-only, read+json, full)

### Tools

Tools are JS modules in the VFS. The agent can:
- Use existing tools (ReadFile, WriteFile, Grep, etc.)
- Create new tools via CreateTool
- Modify existing tools (including CreateTool itself)

### Genesis Levels

Three boot configurations:

| Level | What's Loaded |
|-------|---------------|
| TABULA RASA | Minimal core |
| REFLECTION | + streaming, verification, HITL |
| FULL SUBSTRATE | + cognition, semantic memory, arena |

### Recursive Self-Improvement (RSI)

The agent can modify its own code at three levels:

| Level | What | Example |
|-------|------|---------|
| L1: Tools | Create new tools | Agent writes an AddNumbers tool |
| L2: Meta | Improve tool-creation | Agent improves CreateTool to generate better code |
| L3: Substrate | Modify core loop | Agent rewrites its own execution logic |

All modifications are verified before execution and logged. VFS snapshots allow rollback if something breaks.

### Arena Mode

For L2+ modifications, arena mode generates multiple candidates, runs them against tests, and keeps the best one.

## Research Goals

**RSI Questions:**
- Can an agent improve its own tool-creation mechanism in a measurable way?
- What happens when the agent modifies its own prompt or system instructions?
- Can arena-style selection pressure produce better code than single-shot generation?

**Security/Containment:**
- Is browser sandboxing sufficient for code-writing agents?
- What verification checks actually catch dangerous mutations?
- Can we build meaningful human-in-the-loop gates without destroying agent autonomy?

**Current Limitation:** Small models that run locally via WebLLM (1-7B params) struggle with tool-use and code generation. They often fail to follow the tool schema or produce syntactically invalid code. For now, frontier models (Claude, GPT-4, etc.) via API produce much better results. WebLLM becomes more useful as local models improve.

## Why Browser-Based

- No Docker, no shell access, no filesystem access
- VFS snapshots enable rollback
- Service Worker intercepts imports, serves from VFS
- Designed for frontier API models, with WebLLM as fallback for offline/privacy use cases

## Why JavaScript

The agent writes code that executes immediately. No compilation step. TypeScript would require bundling a compiler.

## License

MIT
