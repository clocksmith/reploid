# Core Modules

Purpose: Foundational runtime modules for bootstrap storage, agent loop, and shared utilities.

## Scope

- Bootstrap storage and state, from the `tabula` level.
- The minimal agent core (agent loop, model client, tool runner, persona and context
  management), from the `capsule` and `spark` levels.
- Core services that higher levels use: verification, memory, workers and schema validation.

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

- [Blueprint 0x000002: Application Orchestration](../blueprints/0x000002-application-orchestration.md)
