# Tools Directory

**Purpose**: All agent tools live here. No hardcoded built-ins — full RSI capability.

## Architecture

All tools are dynamic, loaded from `/tools/` by `core/tool-runner.js` at boot. This means the agent can modify any tool, including core VFS operations. Tool files and exported names should always use CamelCase (uppercase first letter) so LLM instructions stay consistent.

Tools receive a `deps` object with:
- `VFS` — Virtual filesystem operations
- `EventBus` — Event emission for UI updates
- `AuditLogger` — Audit logging for mutations
- `ToolWriter` — Create new tools
- `ToolRunner` — List/execute other tools
- `SubstrateLoader` — Hot-reload modules
- `WorkerManager` — Spawn and manage subagents
- `Shell` — Real filesystem access (escape hatch)

## Active Tools

| File | Purpose |
|------|---------|
| **Core VFS** | |
| `ReadFile.js` | `ReadFile` — read file from VFS |
| `WriteFile.js` | `WriteFile` — write file with audit logging + verification |
| `ListFiles.js` | `ListFiles` — list directory contents |
| `DeleteFile.js` | `DeleteFile` — delete file with audit logging |
| **Meta-Tools (RSI)** | |
| `CreateTool.js` | `CreateTool` — create new tool at runtime (L1 RSI) |
| `ListTools.js` | `ListTools` — list all available tools |
| `LoadModule.js` | `LoadModule` — hot-reload module from VFS |
| **Worker Tools** | |
| `SpawnWorker.js` | `SpawnWorker` — spawn permission-filtered subagent |
| `ListWorkers.js` | `ListWorkers` — list active/completed workers |
| `AwaitWorkers.js` | `AwaitWorkers` — wait for worker completion |
| **Utilities** | |
| `FileOutline.js` | `FileOutline` — structural analysis of code files |
| `Cat.js`, `Head.js`, `Tail.js` | `Cat`, `Head`, `Tail` — content preview helpers |
| `Ls.js`, `Pwd.js`, `Touch.js` | `Ls`, `Pwd`, `Touch` — filesystem navigation primitives |
| `Grep.js`, `Find.js`, `Sed.js`, `Jq.js` | Search/filter/transform tools |
| `Mkdir.js`, `Rm.js`, `Mv.js`, `Cp.js` | File management |
| `Edit.js` | `Edit` — literal match/replace editing |
| `Git.js` | `Git` — version control operations (VFS-scoped shim) |
| `python/` | Python execution environment (via Pyodide) |

---

## Python Integration

The `python/` directory contains the WebAssembly-based Python runtime:

- `python-tool.js`: The tool definition exposed to the LLM (`execute_python`, `install_package`).
- `pyodide-runtime.js`: Main thread controller that manages the worker.
- `pyodide-worker.js`: Sandboxed Web Worker running the actual Python interpreter.
