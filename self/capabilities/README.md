# Capabilities

Purpose: Higher-level agent capabilities layered on top of the core runtime.

## Scope

Capabilities are organized by domain. None loads at the `tabula` level; the first ones
load at `reflection`.

| Subdirectory | Domain |
|--------------|--------|
| `reflection/` | Self-awareness and learning |
| `cognition/` | Semantic and symbolic reasoning, prompt evolution |
| `communication/` | Swarm and P2P collaboration |
| `performance/` | Monitoring and metrics |
| `system/` | Substrate management and Doppler tooling |
| `intelligence/` | Multi-model coordination |

## Modules and genesis levels

[genesis-levels.json](../config/genesis-levels.json) is the one list of which module loads
at which genesis level. The levels are `tabula`, `capsule`, `spark`, `reflection`,
`cognition`, `substrate` and `full`, each extending the one before: `moduleFiles` maps
each module to its files and `levels.<level>.modules` names what each level adds.
[module-inventory.json](../config/module-inventory.json) lists every file with its owner
and imports (`npm run build:module-inventory`). Their paths are served paths: one URL tree
overlays `self/`, `shared/` and `apps/poolday/`, so a module listed under `core/` may
live in `shared/core/`. [The ownership inventory](../../docs/ownership-inventory.md) gives
each file's source. This README does not copy those lists.

## Related

- [Blueprint 0x000067: GEPA Prompt Evolution](../blueprints/0x000067-gepa-prompt-evolution.md)
- [Blueprint 0x000068: Hierarchical Memory](../blueprints/0x000068-hierarchical-memory-architecture.md)
