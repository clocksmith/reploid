# Blueprint 0x000074: Cognition API

**Module:** `CognitionAPI`
**File:** `./capabilities/cognition/cognition-api.js`
**Purpose:** Unified interface combining semantic + symbolic reasoning

## Overview

CognitionAPI provides single entry point for all cognitive capabilities: semantic memory, knowledge graphs, rule engines, symbol grounding. Orchestrates hybrid reasoning.

## Implementation

```javascript
const CognitionAPI = {
  metadata: {
    id: 'CognitionAPI',
    dependencies: ['Utils', 'SemanticMemory', 'KnowledgeGraph', 'RuleEngine', 'SymbolGrounder'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { SemanticMemory, KnowledgeGraph, RuleEngine, SymbolGrounder } = deps;

    const think = async (query, mode = 'hybrid') => {
      logger.info(`Cognition: ${mode} reasoning about "${query}"`);

      const results = {
        semantic: null,
        symbolic: null,
        synthesis: null
      };

      // Semantic reasoning - find similar experiences
      if (mode === 'semantic' || mode === 'hybrid') {
        results.semantic = await SemanticMemory.recall(query, 5);
      }

      // Symbolic reasoning - apply rules and query graph
      if (mode === 'symbolic' || mode === 'hybrid') {
        const graphResults = KnowledgeGraph.query({ relation: 'related_to', to: query });
        const ruleResults = RuleEngine.evaluate();
        results.symbolic = { graph: graphResults, rules: ruleResults };
      }

      // Synthesis - combine both approaches
      if (mode === 'hybrid') {
        results.synthesis = synthesize(results.semantic, results.symbolic);
      }

      return results;
    };

    const synthesize = (semantic, symbolic) => {
      // Combine semantic similarity with symbolic relationships
      // This is where hybrid AI magic happens
      return {
        confidence: 0.8,
        reasoning: 'Combined semantic patterns with symbolic rules',
        recommendation: symbolic.rules.length > 0 ? 'Apply rules' : 'Use semantic match'
      };
    };

    return { think };
  }
};
```
