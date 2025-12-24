# Semantic Memory

> See [MEMORY_ARCHITECTURE.md](./MEMORY_ARCHITECTURE.md) for the full hierarchical memory system.

## Quick Overview

Semantic memory enables recall by **meaning**, not keywords.

| | Text RAG | Semantic |
|---|----------|----------|
| **Matches** | Words | Meaning |
| "bypass login" finds "SQLi grants admin" | No | Yes |

## Usage

```javascript
// Store experience
await SemanticMemory.remember({
  action: 'Fixed auth bug',
  result: 'JWT validation added',
  context: 'User session hijacking'
});

// Recall by meaning
const related = await SemanticMemory.recall('security vulnerabilities');
// Returns: JWT validation experience (even though words don't match)
```

## Architecture

Semantic memory is the third tier in the [hierarchical memory system](./MEMORY_ARCHITECTURE.md):

1. **Working Memory** - Current context window
2. **Episodic Memory** - Full conversation history + recursive summaries
3. **Semantic Memory** - Extracted facts, patterns, RAPTOR-style knowledge tree

## References

- [MEMORY_ARCHITECTURE.md](./MEMORY_ARCHITECTURE.md) - Full implementation plan
- [Blueprint 0x000070](../blueprints/0x000070-semantic-memory.md) - Module specification
- [Sentence-BERT](https://arxiv.org/abs/1908.10084) - Embedding model
- [MemGPT](https://arxiv.org/abs/2310.08560) - OS-inspired memory hierarchy
