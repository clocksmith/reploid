# Blueprint 0x000091: Cognition Panel

**Objective:** Visual knowledge graph explorer and semantic memory dashboard.

**Target Module:** `CognitionPanel`

**Implementation:** `/ui/panels/cognition-panel.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x000058` (Event Bus), `0x000074` (Knowledge Graph), `0x000075` (Semantic Memory)

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

```javascript
const CognitionPanel = {
  init(containerId),  // Initialize panel
  dispose(),          // Cleanup animation and listeners
  refresh()           // Reload graph data
};
```

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

| Type | Color |
|------|-------|
| Entity | #4fc3f7 (light blue) |
| Tool | #81c784 (green) |
| File | #64b5f6 (blue) |
| Error | #e57373 (red) |
| CodeElement | #ba68c8 (purple) |
| URL | #ffb74d (orange) |

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

**Status:** Implemented

