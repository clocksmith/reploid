# REPLOID Quick Start Guide

**Welcome to REPLOID!** This guide will get you up and running in 5 minutes.

---

## Prerequisites

- **Modern browser** (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- **Node.js 18+** (for development server)
- **git** (recommended for version control)

---

## 1-Minute Quick Start

### Step 1: Start the Server

```bash
npm install

# Option A: Static server
npm run serve

# Option B: Full dev server with API proxies (recommended for development)
npm run dev
```

### Step 2: Open in Browser

| Mode | URL | Description |
|------|-----|-------------|
| `npm run serve` | http://localhost:8080 | Reploid agent app |
| `npm run dev` | http://localhost:8000 | Full dev with API proxies |

Note: The Doppler provider loads client assets from `/doppler`, which is served by the dev server.

### Step 3: Configure Your Agent

You'll see the boot screen with configuration options:

#### Genesis Levels

| Level | Modules | Best For |
|-------|---------|----------|
| **Tabula Rasa** | ~13 | Fastest boot, minimal footprint |
| **Reflection** | ~19 | + Streaming, verification, HITL |
| **Full Substrate** | ~32 | Full RSI capability, arena testing |

#### Model Configuration

- **Cloud APIs**: Enter API keys for OpenAI, Anthropic, or Gemini
- **Local Models**: Configure Ollama endpoint or use WebLLM
- **Proxy Mode**: Route through `server/proxy.js` for key management

### Step 4: Set Your First Goal

Type a goal in the input box and click **"Awaken Agent"**. Examples:

```
Create a simple hello world function
```

```
Analyze the files in /tools and list what each one does
```

```
Create a new tool called GreetUser that returns a friendly message
```

---

## Mode Overview

| Mode | Setup Time | Privacy | Cost | Best For |
|------|------------|---------|------|----------|
| **Client-Only (Browser)** | < 1 min | High (API key in browser) | API fees | Quick start, demos |
| **Client + API Keys** | < 2 min | High (keys in browser) | API fees | Multiple LLM providers |
| **Node.js Server** | 5 min | Highest (keys on server) | API fees | Team collaboration |
| **Local WebGPU** | 10 min (initial download) | Maximum (100% local) | $0 | Privacy, offline, cost-free |

## Mode 1: Client-Only (Browser)

**How it works:** REPLOID runs entirely in your browser. You paste an API key directly into the UI.

### Setup

1. Serve the directory:
```bash
python -m http.server 8000
# or
npx serve
```

2. Open `http://localhost:8000`

3. Click the ⎈ config button in the top-right

4. Select your provider and paste API key:
   - **Gemini**: Get key from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - **OpenAI**: Get key from [OpenAI Platform](https://platform.openai.com/api-keys)
   - **Anthropic**: Get key from [Anthropic Console](https://console.anthropic.com/)

5. Click "Save Configuration"

### Pros
- Zero installation
- Works anywhere
- No server needed

### Cons
- API key visible in browser memory
- No multi-user support
- Can't use server-side features (git worktrees, Hermes)

## Mode 2: Client + Multiple API Keys

**How it works:** Same as Mode 1, but you configure multiple providers with fallback.

### Setup

1. Follow Mode 1 setup

2. In config modal, add keys for multiple providers:
   - Primary: Gemini (fast, cheap)
   - Fallback 1: OpenAI (reliable)
   - Fallback 2: Anthropic (high quality)

3. REPLOID will automatically fallback if primary fails

### Pros
- High availability
- Cost optimization (use cheapest first)
- Provider diversity

### Cons
- Requires API keys from multiple providers
- Higher complexity

## Mode 3: Node.js Server

**How it works:** Node.js backend handles API calls. Browser communicates via proxy.

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
# Required: At least one API key
GEMINI_API_KEY=your_key_here

# Optional: Additional providers
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here

# Optional: Local Ollama
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=qwen3-coder-32b
```

3. Start server:
```bash
npm start
```

4. Open `http://localhost:8000`

### Pros
- API keys hidden from browser
- WebSocket streaming support
- git worktree isolation
- Hermes multi-agent orchestration
- Team collaboration
- Session persistence

### Cons
- Requires Node.js installation
- Server must stay running
- More complex deployment

### Features Available

- [x] All client-side features
- [x] PAWS CLI integration (`cats.js`, `dogs.js`, `paws-session.js`)
- [x] Hermes multi-agent Paxos orchestration
- [x] git worktree session management
- [x] WebSocket real-time streaming
- [x] Shared sessions across team members

## Mode 4: Local WebGPU (Browser-Native LLM)

**How it works:** Download and run LLM models directly in your browser using WebGPU acceleration.

### Requirements

- **Browser**: Chrome/Edge 113+ with WebGPU enabled
- **GPU**: Discrete GPU recommended (Intel/AMD/NVIDIA)
- **RAM**: 4-8GB available
- **Storage**: 1-4GB per model

### Setup

1. Open REPLOID in browser (Mode 1 or 3)

2. Click "Local LLM" tab in proto

3. Check WebGPU status (should show "Available")

4. Select a model:
   - **Qwen3-Coder-2B** (~900MB) - Best for coding
   - **Phi-4-mini-4k** (~2.1GB) - Balanced
   - **Llama-4-1B** (~900MB) - Fast inference
   - **Gemma-3-4B** (~1.2GB) - High quality

5. Click "☇ Load Model"

6. Wait for download (one-time, cached in browser)

7. Toggle "Use Local LLM" in settings

### Pros
- **$0 cost** - No API fees ever
- **100% private** - Data never leaves your machine
- **Offline** - Works without internet
- **Fast** - GPU-accelerated inference

### Cons
- **Initial download** - 900MB-4GB per model
- **GPU required** - WebGPU not available on all devices
- **Limited capabilities** - Smaller models less capable than GPT-4/Claude
- **Memory intensive** - Requires 4-8GB RAM

### Performance

| Model | Size | Tokens/sec | Quality | Use Case |
|-------|------|------------|---------|----------|
| Qwen3-Coder-2B | 900MB | 50-150 | Good | Coding tasks |
| Phi-4-mini-4k | 2.1GB | 30-80 | Better | General purpose |
| Llama-4-1B | 900MB | 80-200 | Good | Fast responses |
| Gemma-3-4B | 1.2GB | 40-100 | Better | Balanced |

### Vision Models

Some models support image inputs:
- **Phi-3.5 Vision** (~4.2GB) - Image understanding
- **LLaVA 1.5 7B** (~4.5GB) - Advanced vision

Upload images in the "Test Inference" section.

## Hybrid Mode: Local + Cloud Fallback

**How it works:** Use local WebGPU by default, fallback to cloud if needed.

### Setup

1. Configure Mode 4 (Local WebGPU)
2. Also configure Mode 1 or 3 (Cloud API)
3. Enable "Auto-fallback" in settings

### Behavior

- **Default**: Uses local WebGPU LLM
- **Fallback**: If local fails or times out, uses cloud API
- **Smart routing**: Complex queries -> cloud, simple queries -> local

### Pros
- Best of both worlds
- Cost optimization
- High availability

## Comparing Modes

### Privacy

**Maximum -> Minimum:**
1. Local WebGPU (100% local)
2. Node.js Server (keys on your server)
3. Client + API Keys (keys in browser memory)
4. Client-Only (keys in browser memory)

### Cost

**Free -> Most Expensive:**
1. Local WebGPU ($0)
2. Node.js Server (Gemini Flash ~$0.02/goal)
3. Client + API Keys (depends on provider)
4. Client-Only (depends on provider)

### Features

**Most -> Least:**
1. Node.js Server (all features)
2. Client + API Keys (no server features)
3. Client-Only (no server features)
4. Local WebGPU (no API-dependent features)

### Complexity

**Simplest -> Most Complex:**
1. Client-Only (< 1 min)
2. Client + API Keys (< 2 min)
3. Local WebGPU (10 min first time)
4. Node.js Server (5 min setup)

## Switching Between Modes

You can change modes anytime:

### From Client-Only to Server

1. Create `.env` file with API keys
2. Run `npm start`
3. Refresh browser

### From Cloud to Local

1. Load WebGPU model
2. Toggle "Use Local LLM" in settings
3. Keep cloud API as fallback

### From Local to Cloud

1. Toggle "Use Local LLM" off
2. Configure cloud API key
3. Click "Save Configuration"

## Recommended Workflows

### For Learning / Experimenting
-> **Client-Only** with Gemini (fastest setup)

### For Privacy-Conscious Development
-> **Local WebGPU** with no cloud fallback

### For Team Collaboration
-> **Node.js Server** with git worktrees

### For Cost Optimization
-> **Hybrid** (Local WebGPU + Cloud fallback)

### For Maximum Quality

Use **Node.js Server** with cloud APIs (Claude, GPT-4) and arena gating enabled.

For security considerations across modes, see [security.md](./security.md).

---

## Understanding the Proto UI

### Workspace Header

- **Goal**: Current objective
- **Token Budget**: Usage bar
- **State**: IDLE / RUNNING / ERROR
- **Iterations**: Current cycle count
- **Workers**: Active worker count (click to view)

### Sidebar Tabs

| Tab | Purpose |
|-----|---------|
| **History** | LLM responses, tool calls/results, streaming output |
| **Reflections** | Agent learning entries with success/error status |
| **Status** | Agent state, token usage, model info, errors |
| **Workers** | Active/completed workers, per-worker logs |
| **Debug** | System prompt, conversation context, model config |

### VFS Browser (Middle Panel)

- Browse virtual filesystem
- Search files
- View/edit content
- **Preview**: Execute HTML/CSS/JS in sandboxed iframe
- **Diff**: Compare current state to Genesis snapshot
- **Snapshots**: View/restore saved states

### Command Palette

Press **Ctrl+K** (Cmd+K on Mac) for quick commands:
- Start/stop agent
- Export session
- Clear history
- Refresh VFS
- Toggle panels

---

## Example Workflows

### Example 1: Code Analysis

**Goal:** `Read the files in /core and explain what each module does`

**What happens:**
1. Agent uses `ListFiles` to discover `/core/*.js`
2. Agent uses `ReadFile` to read each file
3. Agent uses `FileOutline` for structural analysis
4. Agent provides summary in response

### Example 2: Tool Creation (L1 RSI)

**Goal:** `Create a tool called AddNumbers that takes two numbers and returns their sum`

**What happens:**
1. Agent plans the tool structure
2. Agent uses `CreateTool` with name and code
3. Tool is written to `/tools/AddNumbers.js`
4. Tool is immediately available for use
5. Agent tests the new tool

### Example 3: Multi-Worker Task

**Goal:** `Spawn workers to analyze different directories in parallel`

**What happens:**
1. Agent uses `SpawnWorker` with type "explore" for each directory
2. Workers run with read-only permissions
3. Agent uses `AwaitWorkers` to collect results
4. Results appear in Workers tab
5. Agent synthesizes findings

### Example 4: Self-Modification (L3 RSI)

**Goal:** `Read /core/tool-runner.js and propose an optimization`

**What happens:**
1. Agent reads and analyzes the file
2. Agent proposes changes via `EditFile` tool
3. Changes go through verification pipeline
4. If arena gating enabled, multiple models compete
5. Only verified changes are applied
6. Agent can hot-reload via `LoadModule`

---

## Key Concepts

### Virtual File System (VFS)

- All files stored in browser IndexedDB
- No access to host filesystem
- Genesis snapshot enables instant rollback
- Service worker serves modules from VFS

### Genesis Snapshots

Captured at boot, before any agent action:
- Full VFS state preserved
- Diff viewer shows all changes
- Restore to pristine state anytime
- Works offline (no network needed)

### RSI Levels

| Level | Description | Safety Gate |
|-------|-------------|-------------|
| **L1: Tools** | Create new tools at runtime | Verification Worker |
| **L2: Meta** | Improve tool-creation mechanism | Arena Mode |
| **L3: Substrate** | Modify core agent loop | HITL Approval |

### Worker Types

| Type | Permissions | Use Case |
|------|-------------|----------|
| **explore** | Read-only | Codebase analysis |
| **analyze** | Read + JSON tools | Data processing |
| **execute** | Full access | Task execution |

### Model Roles

| Role | Purpose |
|------|---------|
| **orchestrator** | Main agent, full capability |
| **fast** | Quick tasks, lower cost |
| **code** | Code-specialized model |
| **local** | WebLLM/Ollama for offline |

---

## Troubleshooting

### Problem: "Failed to load module"
**Solution:** Clear browser cache (Ctrl+Shift+Delete) and refresh

### Problem: Agent stuck in RUNNING state
**Solution:** Check browser console for errors. May be API key issue or network problem.

### Problem: IndexedDB quota exceeded
**Solution:** Export important sessions, then clear VFS via command palette

### Problem: Workers not completing
**Solution:** Check Workers tab for error logs. Workers have iteration limits.

### Problem: Changes not persisting
**Solution:** Ensure VFS writes completed. Check audit log in Debug tab.

### Client-Only: "API key invalid"
- Check key is correct
- Try pasting again (no extra spaces)
- Check API provider status

### Server: "Connection refused"
- Make sure server is running (`npm start`)
- Check port 8000 is available
- Verify `.env` file exists

### Local WebGPU: "WebGPU not available"
- Use Chrome/Edge 113+
- Enable chrome://flags/#enable-unsafe-webgpu
- Check GPU drivers are up to date
- Try Firefox Nightly with WebGPU flag

### Local WebGPU: "Model loading failed"
- Check available disk space (need 1-4GB)
- Check available RAM (need 4-8GB)
- Try smaller model (Qwen 1.5B or Llama 1B)
- Clear browser cache and retry

For more detailed solutions, see [troubleshooting.md](./troubleshooting.md).

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open command palette |
| `Ctrl+Enter` | Submit goal |
| `Escape` | Close modals/palette |

---

## Next Steps

1. **Explore RSI**: Try creating tools and watching the agent improve itself
2. **Read Architecture**: See [system-architecture.md](./system-architecture.md)
3. **Study Blueprints**: Browse `/blueprints/` for specifications
4. **Configure Models**: See [local-models.md](./local-models.md) for WebLLM/Ollama setup
5. **API Reference**: See [api.md](./api.md) for module documentation

---

## Tips for Success

1. **Start simple** — Begin with analysis tasks before modification
2. **Watch the History tab** — See exactly what the agent is doing
3. **Use Genesis diff** — Verify all changes before proceeding
4. **Enable arena gating** — For safer self-modification experiments
5. **Export sessions** — Save your work regularly
6. **Check Workers tab** — Monitor parallel task progress
7. **Read Debug tab** — Understand what system prompt the agent sees

---

REPLOID is your sandbox for safe RSI research.

---

*Last updated: January 2026*
