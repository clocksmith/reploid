# Knowledge Graph

**Module:** `KnowledgeGraph`
**File:** `./capabilities/cognition/symbolic/knowledge-graph.js`
**Purpose:** Structured knowledge as entities and relationships

## Overview

Knowledge graphs represent information as nodes (entities) and edges (relationships). Example: `VFS --depends-on--> Utils`, `AgentLoop --calls--> LLMClient`.

## Implementation

```javascript
const KnowledgeGraph = {
  metadata: {
    id: 'KnowledgeGraph',
    dependencies: ['Utils', 'VFS'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;

    const _nodes = new Map(); // id -> {type, properties}
    const _edges = new Map(); // id -> {from, to, relation, properties}

    const addNode = (id, type, properties = {}) => {
      _nodes.set(id, { type, properties, timestamp: Date.now() });
    };

    const addEdge = (from, to, relation, properties = {}) => {
      const id = `${from}-${relation}-${to}`;
      _edges.set(id, { from, to, relation, properties, timestamp: Date.now() });
    };

    const query = (pattern) => {
      // Simple pattern: {from: 'AgentLoop', relation: 'calls'}
      const results = [];
      for (const [id, edge] of _edges) {
        let match = true;
        if (pattern.from && edge.from !== pattern.from) match = false;
        if (pattern.to && edge.to !== pattern.to) match = false;
        if (pattern.relation && edge.relation !== pattern.relation) match = false;
        if (match) results.push(edge);
      }
      return results;
    };

    const getNeighbors = (nodeId) => {
      const neighbors = [];
      for (const edge of _edges.values()) {
        if (edge.from === nodeId) neighbors.push({ node: edge.to, relation: edge.relation });
        if (edge.to === nodeId) neighbors.push({ node: edge.from, relation: `inverse_${edge.relation}` });
      }
      return neighbors;
    };

    return { addNode, addEdge, query, getNeighbors };
  }
};
```
