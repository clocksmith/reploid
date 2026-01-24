# Capabilities

Purpose: Higher-level agent capabilities layered on top of the core runtime.

## Scope

- Reflection and FULL-level feature modules organized by domain.
- Cognition, communication, performance, system, and intelligence capabilities.

**Genesis Levels:** REFLECTION and FULL

This directory contains advanced capabilities organized by domain. These are NOT loaded at `tabula` level.

## Directory Structure

| Subdirectory | Genesis Level | Description |
|--------------|---------------|-------------|
| `reflection/` | REFLECTION | Self-awareness and learning |
| `cognition/` | FULL | Semantic and symbolic reasoning |
| `communication/` | FULL | Swarm and P2P collaboration |
| `performance/` | FULL | Monitoring and metrics |
| `system/` | FULL | Substrate management |
| `intelligence/` | FULL | Multi-model coordination |

## REFLECTION Level Modules

### reflection/
| Module | File | Description |
|--------|------|-------------|
| ReflectionStore | `reflection-store.js` | Long-term episodic memory |
| ReflectionAnalyzer | `reflection-analyzer.js` | Pattern detection in experiences |

## FULL Level Modules

### cognition/
| Module | File | Description |
|--------|------|-------------|
| CognitionAPI | `cognition-api.js` | Unified semantic/symbolic interface |
| GEPAOptimizer | `gepa-optimizer.js` | Genetic-Pareto prompt evolution |
| EmbeddingStore | `semantic/embedding-store.js` | Vector embedding storage |
| SemanticMemory | `semantic/semantic-memory.js` | Long-term retrieval by meaning |
| KnowledgeGraph | `symbolic/knowledge-graph.js` | Entities and relationships |
| RuleEngine | `symbolic/rule-engine.js` | IF-THEN deterministic reasoning |
| SymbolGrounder | `symbolic/symbol-grounder.js` | Symbol-to-action mapping |

### communication/
| Module | File | Description |
|--------|------|-------------|
| SwarmTransport | `swarm-transport.js` | P2P message transport |
| WebRTCSwarm | `webrtc-swarm.js` | WebRTC peer connections |
| SwarmSync | `swarm-sync.js` | State synchronization |

### performance/
| Module | File | Description |
|--------|------|-------------|
| PerformanceMonitor | `performance-monitor.js` | Metrics collection and analysis |

### system/
| Module | File | Description |
|--------|------|-------------|
| SubstrateLoader | `substrate-loader.js` | Dynamic module loading |

### intelligence/
| Module | File | Description |
|--------|------|-------------|
| MultiModelCoordinator | `intelligence/multi-model-coordinator.js` | Multi-model orchestration (shim to experimental) |
| MultiModelEvaluator | `intelligence/multi-model-evaluator.js` | Multi-model evaluation harness (shim to core) |
| FunctionGemmaOrchestrator | `intelligence/functiongemma-orchestrator.js` | Doppler multi-model execution and topology evolution |
| NeuralCompiler | `intelligence/neural-compiler.js` | LoRA adapter routing and batching (shim to experimental) |
| IntentBundleLoRA | `intelligence/intent-bundle-lora.js` | Intent bundle gate for LoRA adapters |

## Related

- [Genesis Levels Config](../config/genesis-levels.json)
- [Blueprint 0x000078: GEPA Prompt Evolution](../blueprints/0x000078-gepa-prompt-evolution.md)
- [Blueprint 0x000079: Hierarchical Memory](../blueprints/0x000079-hierarchical-memory-architecture.md)
