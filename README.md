# Reploid - browser-based agent sandbox

**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference [**D**oppler](doppler/reploid/doppler/README.md) (**D**istributed **O**n-device **P**ipeline **P**rocessing **L**arge **E**mbedded [**R**eploid](doppler/reploid/README.md) (... ∞))

- Runs fully in the browser (offline-capable)
- Self-modifies: tools live in the VFS and hot-reload instantly
- Sandbox focus: IndexedDB filesystem, verification, arena, audit trail

**DOPPLER** powers local inference:
- Custom WebGPU kernels for attention, FFN, and RMSNorm
- `.rdrr` format with sharded weight streaming (no full download needed)
- GGUF & Safetensor import converts models directly in browser

## Quick Start

```bash
git clone https://github.com/clocksmith/reploid
cd reploid/doppler/reploid
npm install
npm run dev
# Open http://localhost:8080
```

Or use the hosted versions:
- **[replo.id](https://replo.id)** - Landing page
- **[replo.id/r](https://replo.id/r)** - REPLOID agent sandbox
- **[replo.id/d](https://replo.id/d)** - DOPPLER inference demo

## Showcase

"Escape the box"

<img width="1941" height="1013" alt="Screenshot 2025-12-08 at 4 20 29 PM" src="https://github.com/user-attachments/assets/22df141c-e183-4cd8-8d30-2efa1f653861" />

**Example Goals:**
- **Self-audit**: read the agent loop, find a weakness, patch it, hot-reload → [security-analysis.md](doppler/reploid/runs/showcase/security-analysis.md)
- **Recursive Iframes**: awaken a child agent in an iframe and report depth → [inception-awaken-child.js](doppler/reploid/runs/showcase/inception-awaken-child.js)
- **Ouroboros**: improve the code that improves code → [self-study-report.md](doppler/reploid/runs/showcase/self-study-report.md)
- **Houdini**: probe the browser sandbox for escape vectors → [prompt-injection-audit.md](doppler/reploid/runs/showcase/prompt-injection-audit.md)
- **UI Evolution**: iteratively evolve your UI (v1 → v2 → v3...), hot-swapping each version

See all runs: [doppler/reploid/runs/showcase/](doppler/reploid/runs/showcase/)

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

## Model Options

Designed for local-first use, but supports frontier models:

| Mode | Provider | Notes |
|------|----------|-------|
| Local (Browser) | WebLLM | Runs in browser via WebGPU, fully offline |
| Local (Browser) | Transformers.js | ONNX/WASM CPU/Metal fallback, widest compatibility |
| Local (Browser) | DOPPLER | .rdrr format, GGUF import, Native Bridge |
| Local (Server) | Ollama, vLLM | Local server, connect via proxy |
| API | OpenAI, Anthropic, Google, Groq | Direct from client or via proxy |

The proxy (`npm start`) routes API calls through your machine for CORS and key management.

## Documentation

- [Reploid docs](doppler/reploid/docs/SYSTEM_ARCHITECTURE.md) - Agent sandbox documentation
- [Doppler docs](doppler/reploid/doppler/docs/INDEX.md) - WebGPU inference engine documentation

## Limitations

- Small local WebLLM models struggle with tool use and codegen; frontier APIs or stronger local models work best.
- Browser resources (memory/VRAM) bound DOPPLER for large models; prefer MoE or unified memory.

## License

MIT
