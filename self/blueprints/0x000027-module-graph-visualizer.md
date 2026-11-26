# Blueprint 0x000027: Module Dependency Graph Visualizer

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000027-module-graph-visualizer.md`

## Retired design

This design proposed `/ui/panels/module-graph-visualizer.js`, a D3 dependency graph fed by the Introspector of [0x00001A](0x00001A-code-introspection-self-analysis.md). Neither exists. Module dependencies are declared in each module's metadata, resolved by `self/infrastructure/di-container.js` ([0x000042](0x000042-dependency-injection-container.md)) and recorded in the generated `self/config/module-registry.json`. No current blueprint covers a graph view.
