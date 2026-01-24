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

*Last updated: December 2025*
