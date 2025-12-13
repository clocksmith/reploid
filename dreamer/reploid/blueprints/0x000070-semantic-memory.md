# Blueprint 0x000070: Semantic Memory

**Module:** `SemanticMemory`
**File:** `./capabilities/cognition/semantic/semantic-memory.js`
**Purpose:** Long-term memory retrieval by meaning, not keywords

## Overview

Semantic memory allows agent to recall relevant past experiences based on conceptual similarity, not exact string matching. "What did I do related to error handling?" retrieves all error-handling experiences.

## Implementation

```javascript
const SemanticMemory = {
  metadata: {
    id: 'SemanticMemory',
    dependencies: ['Utils', 'EmbeddingStore', 'ReflectionStore'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { EmbeddingStore, ReflectionStore } = deps;

    const remember = async (experience) => {
      const { action, result, context } = experience;
      const text = `Action: ${action}. Result: ${result}. Context: ${context}`;

      const embedding = await EmbeddingStore.embed(text);
      const id = `memory_${Date.now()}`;

      await EmbeddingStore.store(id, text, embedding);
      return id;
    };

    const recall = async (query, topK = 5) => {
      const results = await EmbeddingStore.search(query, topK);
      return results.map(r => ({
        id: r.id,
        text: r.text,
        relevance: r.similarity
      }));
    };

    return { remember, recall };
  }
};
```

## Use Cases

- "Similar bugs I fixed before"
- "Past decisions about architecture"
- "Successful refactoring patterns"
