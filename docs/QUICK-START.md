# REPLOID Quick Start Guide

This guide gets you from a clean checkout to a running Reploid session with the current boot flow.

---

## Prerequisites

- Modern browser with ES modules
- WebGPU-capable browser for browser-local models
- Node.js 16+ for the supported dev server path
- `git` recommended

---

## 1-Minute Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the supported server

```bash
npm start
```

`npm start` launches `server/proxy.js`, which serves the app at `http://localhost:8000`, proxies cloud APIs, and exposes local-model endpoints when configured.

### 3. Open the app

Go to `http://localhost:8000`.

### 4. Pick a boot-wizard connection type

| Connection Type | What it means | Typical use |
|-----------------|---------------|-------------|
| `Direct` | Browser calls cloud APIs directly with keys stored in browser state | Quick experiments |
| `Proxy` | Browser calls the Reploid proxy, which holds cloud keys or talks to Ollama | Safer local development |
| `Browser` | Browser-local model path via WebGPU and the Doppler/browser-local stack | Offline or local-first runs |

### 5. Set advanced options if needed

Useful first-run options:
- `Genesis Level`
- `Preserve VFS on boot`
- `HITL approval`
- `Security enforcement`
- `Module overrides`

See [CONFIGURATION.md](./CONFIGURATION.md) for the full surface.

### 6. Enter a goal and awaken

Example goals:

```text
Read the files in /core and explain what each module does
```

```text
Create a tool called GreetUser that returns a friendly greeting
```

```text
Inspect /tools and summarize the available capabilities
```

---

## Genesis Levels

`src/config/genesis-levels.json` is the source of truth.

| Level | Cumulative Modules | Best For |
|-------|--------------------|----------|
| `tabula` | 7 | Minimal substrate boot |
| `spark` | 20 | Core agent loop and tools |
| `reflection` | 26 | Verification and HITL |
| `cognition` | 37 | Semantic and symbolic cognition |
| `substrate` | 50 | Workers and runtime infrastructure |
| `full` | 66 | Arena, swarm, and full research surface |

If you are learning the codebase, start with `spark`, `reflection`, or `full`.

---

## Connection Types

### Direct

Use this when you want the fastest path to a cloud-backed session.

Boot-wizard flow:
1. Choose `Direct`
2. Select a provider
3. Enter the API key
4. Select a model
5. Verify connection and model

Notes:
- Keys are stored in browser state under `REPLOID_KEY_<PROVIDER>`
- The selected model is persisted in `SELECTED_MODELS`
- This is the fastest setup path, but it keeps credentials in the browser

### Proxy

Use this when you want server-side key handling or Ollama-backed local inference.

Typical `.env`:

```env
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
LOCAL_MODEL_ENDPOINT=http://localhost:11434
```

Boot-wizard flow:
1. Start `npm start`
2. Choose `Proxy`
3. Point at the detected Reploid proxy or Ollama endpoint
4. Pick the provider and model
5. Verify connection and model

Useful proxy endpoints:
- `GET /api/health`
- `GET /api/proxy-status`
- `GET /api/ollama/models`

### Browser

Use this when you want browser-local inference.

Requirements:
- Browser with WebGPU enabled
- Browser-local provider assets available through the configured Doppler base

Boot-wizard flow:
1. Choose `Browser`
2. Wait for browser-local capability detection
3. Pick the detected model
4. Verify and awaken

If you need a non-default Doppler asset root, open the app with:

```text
http://localhost:8000/src/?dopplerBase=http://localhost:9000/doppler
```

### Optional Model Access

Direct and Proxy sessions can also enable browser-local model access when the boot wizard detects it.

Use this when you want:
- cloud orchestration with local model inspection
- direct/proxy chat plus Doppler-backed model assets
- future workflows involving LoRA, activations, or browser-local tooling

---

## Supported First-Run Paths

| Goal | Recommended Path |
|------|------------------|
| Fastest setup | `Direct` |
| Safer local development | `Proxy` |
| Offline or local-first experiments | `Browser` |
| Cloud + local hybrid workflows | `Proxy` or `Direct` plus optional model access |

---

## Proto UI

Main areas after boot:

| Area | Purpose |
|------|---------|
| Workspace header | Goal, state, token usage, worker count |
| History | LLM responses, tool calls, streaming output |
| Reflections | Stored lessons and outcomes |
| Status | Model info, errors, runtime state |
| Workers | Active and completed worker runs |
| Debug | System prompt, config, context snapshots |
| VFS panel | File browser, preview, diffs, snapshots |

Common actions:
- `Ctrl+K` or `Cmd+K`: command palette
- `Ctrl+Enter`: submit goal
- `Escape`: close modal or stop current focused action

---

## Example Workflows

### Codebase orientation

Goal:

```text
Read the files in /core and explain what each one does
```

Typical tool path:
- `ListFiles`
- `ReadFile`
- `FileOutline`

### Create a tool

Goal:

```text
Create a tool called AddNumbers that takes two numbers and returns their sum
```

Typical tool path:
- `CreateTool`
- `WriteFile`
- `LoadModule`

### Parallel exploration

Goal:

```text
Spawn workers to inspect /core, /tools, and /infrastructure in parallel
```

Typical tool path:
- `SpawnWorker`
- `AwaitWorkers`
- synthesis in the main loop

### Controlled self-modification

Goal:

```text
Read /core/tool-runner.js and propose a safe optimization
```

Typical path:
- read and analyze current module
- propose edits
- verification before write
- optional arena gating for higher-risk changes
- hot reload after commit

---

## Key Concepts

### VFS

- IndexedDB-backed virtual file system
- Holds source modules, tools, logs, memories, and snapshots
- Keeps agent mutation inside the browser boundary

### Genesis Snapshot

- Captured before agent action during boot
- Lets you diff or restore the runtime to a known clean state

### Arena Gating

- Multi-model validation layer for risky changes
- Controlled by `REPLOID_ARENA_GATING`
- Off by default

### HITL

- Human approval modes: `autonomous`, `hitl`, `every_n`
- Stored in `REPLOID_HITL_CONFIG`

---

## Troubleshooting

### Module load failures

- Hard refresh the page
- Clear cached VFS state if needed
- Check the browser console for service-worker or import errors

### App boots but agent does not run

- Verify a model is selected in the boot wizard
- Check API key or proxy verification state
- Confirm `SELECTED_MODELS` is present and valid

### Proxy connection refused

- Confirm `npm start` is running
- Check port `8000`
- Inspect `server/proxy.js` logs

### Ollama not detected

- Start Ollama: `ollama serve`
- Confirm the endpoint responds at `http://localhost:11434/api/tags`
- Set `LOCAL_MODEL_ENDPOINT` if you are not using the default port

### Browser-local model unavailable

- Confirm WebGPU support in the browser
- Check that Doppler assets are reachable from the configured base URL
- Try again with a smaller model or a clean browser profile

### IndexedDB quota issues

- Export anything important
- Clear VFS state
- Disable `REPLOID_PRESERVE_ON_BOOT` for the next run if you want a clean seed

For deeper validation guidance, see [TESTING.md](./TESTING.md).

---

## Next Steps

1. Read [system-architecture.md](./system-architecture.md)
2. Read [CONFIGURATION.md](./CONFIGURATION.md)
3. Read [SECURITY.md](./SECURITY.md)
4. Read [local-models.md](./local-models.md)
5. Read [API.md](./API.md)

---

*Last updated: March 2026*
