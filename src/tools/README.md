# Agent Tools

**Genesis Levels:** Mixed (Shared + FULL-only)

This directory contains agent tools. Most are shared across all genesis levels, but some require FULL substrate.

## Shared Tools (All Levels)

Available at `tabula`, `reflection`, and `full`:

### File Operations
| Tool | File | Description |
|------|------|-------------|
| ReadFile | `ReadFile.js` | Read VFS file content |
| WriteFile | `WriteFile.js` | Write content to VFS |
| ListFiles | `ListFiles.js` | List directory contents |
| DeleteFile | `DeleteFile.js` | Delete VFS file |
| Edit | `Edit.js` | Find/replace in file |
| Cat | `Cat.js` | Concatenate file contents |
| Head | `Head.js` | First N lines of file |
| Tail | `Tail.js` | Last N lines of file |
| Touch | `Touch.js` | Create empty file |
| Mkdir | `Mkdir.js` | Create directory |
| Rm | `Rm.js` | Remove file/directory |
| Mv | `Mv.js` | Move/rename file |
| Cp | `Cp.js` | Copy file |
| Ls | `Ls.js` | List with details |
| Pwd | `Pwd.js` | Print working directory |

### Search
| Tool | File | Description |
|------|------|-------------|
| Grep | `Grep.js` | Search file contents |
| Find | `Find.js` | Find files by name |
| FileOutline | `FileOutline.js` | Code structure outline |
| Jq | `Jq.js` | JSON query |
| Sed | `Sed.js` | Stream editor |

### Meta
| Tool | File | Description |
|------|------|-------------|
| CreateTool | `CreateTool.js` | Dynamic tool creation (L1 RSI) |
| ListTools | `ListTools.js` | List available tools |
| Git | `Git.js` | Git operations |

---

## FULL Substrate Only

These tools require `full` genesis level:

### Worker Management
| Tool | File | Description |
|------|------|-------------|
| SpawnWorker | `SpawnWorker.js` | Spawn sub-agent worker |
| ListWorkers | `ListWorkers.js` | List active workers |
| AwaitWorkers | `AwaitWorkers.js` | Wait for worker completion |

### Cognition
| Tool | File | Description |
|------|------|-------------|
| ListMemories | `ListMemories.js` | Query semantic memory |
| ListKnowledge | `ListKnowledge.js` | Query knowledge graph |
| RunGEPA | `RunGEPA.js` | Execute GEPA prompt evolution |

### Swarm (P2P)
| Tool | File | Description |
|------|------|-------------|
| SwarmShareFile | `SwarmShareFile.js` | Share file with peers |
| SwarmRequestFile | `SwarmRequestFile.js` | Request file from peers |
| SwarmListPeers | `SwarmListPeers.js` | List connected peers |
| SwarmGetStatus | `SwarmGetStatus.js` | Get swarm status |

### System
| Tool | File | Description |
|------|------|-------------|
| LoadModule | `LoadModule.js` | Dynamic module loading (L2 RSI) |

---

## Tool Naming Convention

- **CamelCase** names (e.g., `ReadFile`, `CreateTool`)
- One tool per file
- Export both `tool` object and default `call` function

## See Also

- [Genesis Levels Config](../config/genesis-levels.json) - `sharedFiles.tools` and `levelFiles.full.tools`
- [Blueprint 0x000010: Static Tool Manifest](../blueprints/0x000010-static-tool-manifest.md)
- [Blueprint 0x000015: Dynamic Tool Creation](../blueprints/0x000015-dynamic-tool-creation.md)
