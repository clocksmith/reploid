# Infrastructure Modules

Purpose: Cross-cutting services for boot, runtime coordination, and observability.

## Scope

- Boot infrastructure such as dependency injection and the event bus.
- Support services for safety, rate limits, human approval, telemetry, audit and replay.
- Modules here span several genesis levels, from `tabula` to `substrate`.

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

- [Blueprint 0x000042: Dependency Injection Container](../blueprints/0x000042-dependency-injection-container.md)
- [Blueprint 0x00004F: Event Bus Infrastructure](../blueprints/0x00004F-event-bus-infrastructure.md)
