# Blueprint 0x00005E: Embedding Store

**Module:** `EmbeddingStore`
**File:** `./capabilities/cognition/semantic/embedding-store.js`
**Purpose:** VFS-backed storage for semantic memory embeddings

## Overview

Embeddings are numerical representations of text that capture semantic meaning. Similar concepts have similar vectors, enabling "meaning-based" search rather than keyword matching.

## Key Concepts

- **Embedding** - Dense vector (e.g., 384 dimensions) representing text
- **Cosine Similarity** - Measure of vector similarity (-1 to 1)
- **VFS Storage** - Memories stored as JSON files in `/.memory/embeddings/`
- **Ebbinghaus Forgetting** - Adaptive retention based on access patterns

## Storage Layout

```
/.memory/
  embeddings/
    {id}.json     # Individual memory files
  vocab.json      # Vocabulary index
```

## API

```javascript
const EmbeddingStore = {
  metadata: {
    id: 'EmbeddingStore',
    version: '3.0.0',
    dependencies: ['Utils', 'VFS'],
    type: 'service'
  },

  factory: (deps) => {
    // Memory operations
    addMemory(memory)           // Store memory with embedding
    getMemory(id)               // Retrieve by ID
    getAllMemories()            // List all memories
    deleteMemory(id)            // Remove memory
    updateMemory(id, updates)   // Update memory fields

    // Search operations
    searchSimilar(embedding, topK, minSimilarity)
    searchWithRetention(embedding, options)
    searchWithContiguity(embedding, options)
    searchByTimeRange(start, end, options)

    // Vocabulary
    updateVocabulary(tokens)
    getVocabulary()

    // Maintenance
    pruneOldMemories(maxAge)
    pruneByRetention()
    getStats()
    clear()

    // Retention scoring (Ebbinghaus)
    computeRetentionScore(memory)
    updateImportance(id, importance)
    getMemoriesByRetention()
    configureForgetting(config)
  }
};
```

## Ebbinghaus Forgetting Curve

Retention score: `R = e^(-t/S)` where S = strength modified by access frequency and importance.

```javascript
const FORGETTING_CONFIG = {
  decayHalfLifeMs: 86400000 * 7,  // 7 days
  accessBoostFactor: 0.15,
  minRetentionScore: 0.1,
  importanceBoostFactor: 0.25
};
```
