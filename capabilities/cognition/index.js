/**
 * @fileoverview Cognition Module Index
 * Exports all cognition-related modules for registration.
 *
 * Memory System Components:
 * - EmbeddingStore: IndexedDB-backed vector storage with temporal indexing
 * - SemanticMemory: Embedding generation and similarity search
 * - KnowledgeTree: RAPTOR-style hierarchical clustering with hybrid retrieval
 * - EpisodicMemory: Full conversation message storage with embeddings
 * - HybridRetrieval: Unified retrieval across all memory systems
 * - PromptMemory: GEPA integration and transfer learning
 *
 * Symbolic Components:
 * - KnowledgeGraph: Entity-relationship storage
 * - RuleEngine: Forward-chaining inference
 * - SymbolGrounder: Text-to-symbol grounding
 */

export { default as EmbeddingStore } from './semantic/embedding-store.js';
export { default as SemanticMemory } from './semantic/semantic-memory.js';
export { default as KnowledgeTree } from './knowledge-tree.js';
export { default as EpisodicMemory } from './episodic-memory.js';
export { default as HybridRetrieval } from './hybrid-retrieval.js';
export { default as PromptMemory } from './prompt-memory.js';
export { default as KnowledgeGraph } from './symbolic/knowledge-graph.js';
export { default as RuleEngine } from './symbolic/rule-engine.js';
export { default as SymbolGrounder } from './symbolic/symbol-grounder.js';
export { default as CognitionAPI } from './cognition-api.js';
export { default as GEPAOptimizer } from './gepa-optimizer.js';
