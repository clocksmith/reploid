# Agent Tools

Purpose: Built-in tool catalog for file operations, search, and RSI workflows.

## Scope

- Shared tools available across all genesis levels.
- Level-specific tools for cognition, workers, and swarm coordination.

**Genesis Levels:** Mixed (Shared + level-specific)

This directory contains agent tools. Most are shared across all genesis levels, but some require FULL substrate.

## Shared Tools (All Levels)

Available at all genesis levels:

### File Operations
| Tool | File | Description |
|------|------|-------------|
| ReadFile | `ReadFile.js` | Read VFS file content |
| WriteFile | `WriteFile.js` | Write content to VFS |
| ListFiles | `ListFiles.js` | List directory contents |
| DeleteFile | `DeleteFile.js` | Delete VFS file |
| EditFile | `EditFile.js` | Find/replace in file |
| CopyFile | `CopyFile.js` | Copy file |
| Head | `Head.js` | First N lines of file |
| Tail | `Tail.js` | Last N lines of file |
| MakeDirectory | `MakeDirectory.js` | Create directory |
| MoveFile | `MoveFile.js` | Move/rename file |

### Search
| Tool | File | Description |
|------|------|-------------|
| Grep | `Grep.js` | Search file contents |
| Find | `Find.js` | Find files by name |
| FileOutline | `FileOutline.js` | Code structure outline |

### Meta
| Tool | File | Description |
|------|------|-------------|
| CreateTool | `CreateTool.js` | Dynamic tool creation (L1 RSI) |
| ListTools | `ListTools.js` | List available tools |
| git | `git.js` | Git operations |
| LoadModule | `LoadModule.js` | Dynamic module loading (L2 RSI) |

---

## Level-Specific Tools

These tools are added per genesis level (and above):

### Cognition (cognition+)
| Tool | File | Description |
|------|------|-------------|
| ListMemories | `ListMemories.js` | Query semantic memory |
| ListKnowledge | `ListKnowledge.js` | Query knowledge graph |
| RunGEPA | `RunGEPA.js` | Execute GEPA prompt evolution |

### Worker Management (substrate+)
| Tool | File | Description |
|------|------|-------------|
| SpawnWorker | `SpawnWorker.js` | Spawn sub-agent worker |
| ListWorkers | `ListWorkers.js` | List active workers |
| AwaitWorkers | `AwaitWorkers.js` | Wait for worker completion |

### Swarm (full)
| Tool | File | Description |
|------|------|-------------|
| SwarmShareFile | `SwarmShareFile.js` | Share file with peers |
| SwarmRequestFile | `SwarmRequestFile.js` | Request file from peers |
| SwarmListPeers | `SwarmListPeers.js` | List connected peers |
| SwarmGetStatus | `SwarmGetStatus.js` | Get swarm status |

---

## Tool Naming Convention

- **CamelCase** names (e.g., `ReadFile`, `CreateTool`)
- One tool per file
- Export both `tool` object and default `call` function

## Related

- [Genesis Levels Config](../config/genesis-levels.json) - `sharedFiles.tools` and `levelFiles.*.tools`
- [Blueprint 0x000010: Static Tool Manifest](../blueprints/0x000010-static-tool-manifest.md)
- [Blueprint 0x000015: Dynamic Tool Creation](../blueprints/0x000015-dynamic-tool-creation.md)
