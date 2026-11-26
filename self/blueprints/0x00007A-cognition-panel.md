# Blueprint 0x00007A: Cognition Panel

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/panels/cognition-panel.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/panels/cognition-panel.js`

**Former Blueprint Paths:** `self/blueprints/0x00007A-cognition-panel.md`
**Objective:** Visual knowledge graph explorer and semantic memory dashboard.

**Target Module:** `CognitionPanel`

**Implementation:** `/ui/panels/cognition-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x00004F` (Event Bus Infrastructure), `0x000060` (Knowledge Graph), `0x00005F` (Semantic Memory), `0x000063` (Cognition API)

**Category:** UI

---

## Overview

The Cognition Panel visualizes the agent's knowledge graph and semantic memory state. It renders an interactive force-directed graph of entities and relations, with search and detail inspection.

## Key Features

1. **Force-Directed Graph** - Interactive canvas visualization
2. **Entity Types** - Color-coded by type (Tool, File, Error, etc.)
3. **Relation Display** - Edges show predicate relationships
4. **Search** - Filter entities by name
5. **Stats Dashboard** - Entity, relation, memory, rule counts
6. **Inference Trigger** - Run symbolic reasoning on demand

## Interface

Source: `self/ui/panels/cognition-panel.js`. Dependencies are `Utils`, `EventBus` and the
optional `CognitionAPI?`, `KnowledgeGraph?` and `SemanticMemory?` (:10); the panel renders
an empty graph when they are absent.

| Member | Behavior |
| --- | --- |
| `init(containerId)` | Builds the canvas and controls, loads the graph, starts the animation |
| `dispose()` | Cancels the animation frame and removes the resize and event-bus listeners |
| `refresh()` | `loadGraphData`: reads `KnowledgeGraph.getAllEntities()` and `KnowledgeGraph.query({})` triples |

| Control or event | Effect |
| --- | --- |
| Infer button | `CognitionAPI.symbolic.infer()`, then reload |
| Clear button | `KnowledgeGraph.clear()` and `SemanticMemory.clear()` |
| `cognition:symbolic:add`, `cognition:learning:extract` | Reload the graph |
| Stats | `KnowledgeGraph.getStats()` and `SemanticMemory.getStats()` |

## Graph Visualization

```
   [Entity A]----predicate---->[Entity B]
        |                           |
     predicate                   predicate
        |                           |
        v                           v
   [Entity C]<--predicate---[Entity D]
```

## Entity Colors

Node colors come from the page's `--fg` CSS variable at different opacities (`getColors`,
:32); there are no per-type hues. `Error` nodes use full opacity with a dashed outline.

## Stats Display

```
Entities:  42
Relations: 156
Memories:  23
Rules:     8
```

## Interaction

- **Hover** - Highlight node, show cursor
- **Click** - Select node, show details panel
- **Scroll** - Zoom in/out (0.5x - 2x)
- **Search** - Filter by entity name/ID

## Force Simulation

```javascript
CONFIG = {
  nodeRadius: 15,
  repulsion: 300,      // Node-node repulsion
  attraction: 0.03,    // Edge spring force
  damping: 0.85        // Velocity decay
}
```

---
