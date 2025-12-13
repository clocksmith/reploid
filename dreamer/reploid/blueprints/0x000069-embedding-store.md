# Blueprint 0x000069: Embedding Store

**Module:** `EmbeddingStore`
**File:** `./capabilities/cognition/semantic/embedding-store.js`
**Purpose:** Stores and retrieves vector embeddings for semantic search

## Overview

Embeddings are numerical representations of text that capture semantic meaning. Similar concepts have similar vectors, enabling "meaning-based" search rather than keyword matching.

## Key Concepts

- **Embedding** - Dense vector (e.g., 384 dimensions) representing text
- **Cosine Similarity** - Measure of vector similarity (-1 to 1)
- **IndexedDB** - Browser storage for embeddings

## Implementation

```javascript
const EmbeddingStore = {
  metadata: {
    id: 'EmbeddingStore',
    dependencies: ['Utils', 'VFS', 'TransformersClient'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { TransformersClient } = deps;

    const _embeddings = new Map();

    const embed = async (text) => {
      // Use TransformersClient to generate embedding
      const model = await TransformersClient.getEmbeddingModel();
      const vector = await model.embed(text);
      return vector;
    };

    const store = async (id, text, vector) => {
      _embeddings.set(id, { text, vector, timestamp: Date.now() });
    };

    const cosineSimilarity = (a, b) => {
      let dot = 0, magA = 0, magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    };

    const search = async (queryText, topK = 5) => {
      const queryVector = await embed(queryText);
      const results = [];

      for (const [id, { text, vector }] of _embeddings) {
        const similarity = cosineSimilarity(queryVector, vector);
        results.push({ id, text, similarity });
      }

      return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
    };

    return { embed, store, search };
  }
};
```
