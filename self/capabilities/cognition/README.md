# Cognition Modules

Purpose: Semantic and symbolic reasoning modules, including GEPA (Genetic-Pareto) prompt evolution.

## Scope

- The cognition API, the GEPA optimizer and its evaluation, reflection and selection steps.
- Semantic memory and embeddings (`semantic/`), symbolic reasoning (`symbolic/`), and
  episodic, prompt and hybrid-retrieval memory.
- Most modules here load from the `cognition` level up; some load only at `full`.

## Modules and genesis levels

[genesis-levels.json](../../config/genesis-levels.json) is the one list of which module loads
at which genesis level. The levels are `tabula`, `capsule`, `spark`, `reflection`,
`cognition`, `substrate` and `full`, each extending the one before: `moduleFiles` maps
each module to its files and `levels.<level>.modules` names what each level adds.
[module-inventory.json](../../config/module-inventory.json) lists every file with its owner
and imports (`npm run build:module-inventory`). Their paths are served paths: one URL tree
overlays `self/`, `shared/` and `apps/poolday/`, so a module listed under `core/` may
live in `shared/core/`. [The ownership inventory](../../../docs/ownership-inventory.md) gives
each file's source. This README does not copy those lists.

## Related

- [Blueprint 0x00005F: Semantic Memory](../../blueprints/0x00005F-semantic-memory.md)
- [Blueprint 0x000060: Knowledge Graph](../../blueprints/0x000060-knowledge-graph.md)
- [Blueprint 0x000063: Cognition API](../../blueprints/0x000063-cognition-api.md)
- [Blueprint 0x000067: GEPA Prompt Evolution](../../blueprints/0x000067-gepa-prompt-evolution.md)
