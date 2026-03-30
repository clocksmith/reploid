# Cognition Modules

Purpose: Semantic and symbolic reasoning modules gated to FULL genesis level.

## Scope

- Cognition API, GEPA optimizer, and reasoning subsystems.
- Semantic embeddings and symbolic reasoning layers.

**Genesis Level:** FULL only

This directory contains semantic and symbolic reasoning capabilities. These modules require Transformers.js for embeddings and are only available at `full` substrate level.

## Architecture

```
cognition/
├── cognition-api.js       # Unified interface
├── gepa-optimizer.js      # Prompt evolution
├── semantic/              # Vector-based reasoning
│   ├── embedding-store.js
│   └── semantic-memory.js
└── symbolic/              # Logic-based reasoning
    ├── knowledge-graph.js
    ├── rule-engine.js
    └── symbol-grounder.js
```

## Modules

### Core
| Module | File | Description |
|--------|------|-------------|
| CognitionAPI | `cognition-api.js` | Unified semantic + symbolic interface |
| GEPAOptimizer | `gepa-optimizer.js` | Genetic-Pareto multi-objective prompt evolution |

### Semantic (Vector-Based)
| Module | File | Description |
|--------|------|-------------|
| EmbeddingStore | `semantic/embedding-store.js` | Vector embedding storage and retrieval |
| SemanticMemory | `semantic/semantic-memory.js` | Long-term retrieval by meaning |

### Symbolic (Logic-Based)
| Module | File | Description |
|--------|------|-------------|
| KnowledgeGraph | `symbolic/knowledge-graph.js` | Entities, relationships, graph queries |
| RuleEngine | `symbolic/rule-engine.js` | IF-THEN deterministic reasoning |
| SymbolGrounder | `symbolic/symbol-grounder.js` | Map symbols to actions and meaning |

## Dependencies

- **TransformersClient** (core/) - Required for embedding generation
- **VFS** (core/) - Storage for embeddings and knowledge

## Why FULL Level Only?

1. **WebGPU requirement** - Transformers.js needs WebGPU for efficient inference
2. **Memory footprint** - Embedding models consume ~500MB+ RAM
3. **Startup time** - Model loading adds 5-10s to boot
4. **Optional for basic operation** - Agent can function without cognition at tabula

## Related

- [Blueprint 0x000070: Semantic Memory](../blueprints/0x000070-semantic-memory.md)
- [Blueprint 0x000071: Knowledge Graph](../blueprints/0x000071-knowledge-graph.md)
- [Blueprint 0x000074: Cognition API](../blueprints/0x000074-cognition-api.md)
- [Blueprint 0x000078: GEPA Prompt Evolution](../blueprints/0x000078-gepa-prompt-evolution.md)
