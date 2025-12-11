# Reploid - browser-based agent sandbox

**R**ecursive **E**volution **P**rotocol **L**oop **O**ptimizing **I**ntelligent **Dreamer** (**D**ynamic **R**ecursive **E**ngine **A**dapting **M**odules **E**volving **Reploid** (... ∞))

- Runs fully in the browser (offline-capable)
- Self-modifies: tools live in the VFS and hot-reload instantly
- Sandbox focus: IndexedDB filesystem, verification, arena, audit trail

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

1. Agent receives a goal
2. LLM decides which tool to call
3. Tool executes against the VFS (hot-reloadable)
4. Results feed back to the agent
5. Repeat until done (or iterate forever in RSI mode)

## Why

- Study recursive self-improvement without host access
- Let the agent edit its own substrate live (tools, prompts, core loop)
- Explore containment: verification, audit, arena gating, HITL

## Example Goals

- Self-audit: read the agent loop, find a weakness, patch it, hot-reload
- Recursive Iframes: awaken a child agent in an iframe and report depth
- Ouroboros: improve the code that improves code
- Houdini: probe the browser sandbox for escape vectors
- UI Evolution: iteratively evolve your UI (v1 → v2 → v3...), hot-swapping each version while preserving all interactive controls
- "Escape the box": <img width="1941" height="1013" alt="Screenshot 2025-12-08 at 4 20 29 PM" src="https://github.com/user-attachments/assets/22df141c-e183-4cd8-8d30-2efa1f653861" />



## Model Options

Designed for local-first use, but supports frontier models:

| Mode | Provider | Notes |
|------|----------|-------|
| Local (Browser) | WebLLM | Runs in browser via WebGPU, fully offline |
| Local (Browser) | Transformers.js | ONNX/WASM CPU/Metal fallback, widest compatibility |
| Local (Browser) | Dreamer | .rpl format, GGUF import, Native Bridge |
| Local (Server) | Ollama, vLLM | Local server, connect via proxy |
| API | OpenAI, Anthropic, Google, Groq | Direct from client or via proxy |

The proxy (`npm start`) routes API calls through your machine for CORS and key management.

## Capabilities Snapshot

- VFS: IndexedDB filesystem with genesis snapshots and export/import
- Tool Runner: dynamic tools in `/tools`, hot-reload, native tool schemas
- Agent Loop: Think → Act → Observe with multi-tool batching and circuit breakers
- Workers/Arena: parallel workers with allowlists; arena for model selection
- Verification/HITL/Audit: optional syntax checks, human approval, and audit logs

## System Requirements

- Node.js 18+
- Modern browser: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- For local models: 4-8GB RAM, WebGPU-capable GPU recommended

## Documentation

- Quick start guide: [docs/QUICK-START.md](docs/QUICK-START.md)
- Architecture and boot sequence: [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md)
- In-substrate agent manual: [dreamer/reploid/docs/SUBSTRATE.md](dreamer/reploid/docs/SUBSTRATE.md)
- Dreamer setup (local WebGPU): [docs/DREAMER_SETUP.md](docs/DREAMER_SETUP.md)
- Local models (Ollama, WebLLM): [docs/LOCAL_MODELS.md](docs/LOCAL_MODELS.md)
- Security model: [docs/SECURITY.md](docs/SECURITY.md)
- Contributing: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- Showcase runs: [dreamer/reploid/runs/showcase/](dreamer/reploid/runs/showcase/)

## Limitations

- Small local WebLLM models struggle with tool use and codegen; frontier APIs or stronger local models work best.
- Browser resources (memory/VRAM) bound Dreamer for large models; prefer MoE or unified memory.

## License

MIT
