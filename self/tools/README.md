# Agent Tools

Purpose: Built-in tool catalog for file operations, search, and RSI workflows.

## Scope

- Shared tools available at every genesis level: file operations, search, tool creation
  and listing, module loading, git, promotion and Doppler optimization.
- Level-specific tools: memory and knowledge queries and GEPA from `cognition`, workers
  from `substrate`, swarm file sharing and status at `full`.

## Which tools load where

[genesis-levels.json](../config/genesis-levels.json) is the one list:
`sharedFiles.tools` for every level and `levelFiles.<level>.tools` for the rest. This
README does not copy it.

## Tool Naming Convention

- **CamelCase** names (e.g., `ReadFile`, `CreateTool`)
- One tool per file
- Export both `tool` object and default `call` function
- Zero auto-activation requires deterministic `tool.activation` fixture-backed checks. CreateTool executes and replays them before installation.

## Related

- [Blueprint 0x000010: Static Tool Manifest](../blueprints/0x000010-static-tool-manifest.md)
- [Blueprint 0x000015: Dynamic Tool Creation](../blueprints/0x000015-dynamic-tool-creation.md)
