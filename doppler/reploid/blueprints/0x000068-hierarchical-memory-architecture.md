# Blueprint 0x000068: Hierarchical Memory Architecture

**Objective:** Implement a three-tier memory system (Working/Episodic/Semantic) enabling effectively infinite context through intelligent storage, summarization, and retrieval.

**Target Upgrade:** MMAN (`memory-manager.js`)

**Prerequisites:** `0x00005E` (Embedding Store), `0x00005F` (Semantic Memory), `0x00003B` (Context Management), `0x000060` (Knowledge Graph)

**Affected Artifacts:** `/core/memory-manager.js`, `/capabilities/cognition/knowledge-tree.js`, `/memory/`

**Category:** State & Memory

**Phase:** 4 (Current - see TODO.md)

---

## 1. The Strategic Imperative

LLM context windows are finite. Current approaches have critical limitations:

| Approach | Problem |
|----------|---------|
| Truncation | Loses historical context |
| Sliding window | No long-term memory |
| Pure RAG | 0% memory reuse, stateless |
| Simple summarization | Lossy, no retrieval of originals |

**Goal:** Implement a memory system that provides:
- Unbounded history (full messages stored)
- Constant working memory (fits in context window)
- Multi-resolution access (summaries + details)
- Temporal coherence (narrative arc preserved)
- Semantic access (find by meaning)

---

## 2. Research Foundation

### 2.1 RAPTOR (Tree-Organized Retrieval)

```
                    [Global Summary]
                          |
            +-------------+-------------+
            v             v             v
      [Cluster A]   [Cluster B]   [Cluster C]
       Summary       Summary       Summary
          |             |             |
    +-----+-----+  +----+----+  +----+----+
    v     v     v  v    v    v  v    v    v
  [Chunk][Chunk]  [Chunk][Chunk] [Chunk][Chunk]
   Full   Full     Full   Full    Full   Full
```

**How it works:**
1. Embed all text chunks
2. Cluster similar chunks (UMAP + GMM)
3. Summarize each cluster
4. Recursively cluster and summarize summaries
5. At query time: search ALL levels (collapsed tree)

**Results:** 20% absolute accuracy improvement on QuALITY benchmark.

### 2.2 MemGPT (OS-Inspired Hierarchy)

```
+-----------------------------------------------------------+
|                 Main Context (RAM)                         |
|   Fixed window - what LLM "sees" during inference          |
|   +-------------+-------------+-----------------------+    |
|   | System      | Core Memory | Recent Messages       |    |
|   | Instructions| (Persona)   | (Working Memory)      |    |
|   +-------------+-------------+-----------------------+    |
+-----------------------------------------------------------+
                    ^                    |
                    | load               | evict + summarize
                    |                    v
+-----------------------------------------------------------+
|              External Context (Disk)                       |
|   +-----------------------+---------------------------+    |
|   |   Recall Memory       |    Archival Memory        |    |
|   |  (Conversation DB)    |   (Long-term Knowledge)   |    |
|   |   - Full messages     |   - Searchable facts      |    |
|   |   - Recursive sums    |   - User preferences      |    |
|   +-----------------------+---------------------------+    |
+-----------------------------------------------------------+
```

**Key mechanism:** Recursive summarization on eviction.

### 2.3 Cognitive Workspace (2025)

Most advanced approach with active memory management.

| Feature | RAG | MemGPT | Cognitive Workspace |
|---------|-----|--------|---------------------|
| Memory Reuse | 0% | 10-20% | **54-60%** |
| State Persistence | None | Session | **Continuous** |
| Retrieval | Passive | Reactive | **Anticipatory** |
| Forgetting | None | LRU | **Adaptive curves** |

**Key innovations:**
- Anticipatory retrieval (predict future needs)
- Selective consolidation (compress frequent patterns)
- Adaptive forgetting (task-specific decay)

### 2.4 EM-LLM (Human Episodic Memory)

- No fixed chunk sizes
- Detects event boundaries via Bayesian surprise
- Retrieval mimics human free recall (temporal contiguity)
- No fine-tuning required

---

## 3. Architectural Design

### 3.1 Memory Manager Module

```
+---------------------------------------------------------------------+
|                        Reploid Agent Loop                            |
+---------------------------------------------------------------------+
                                |
                                v
+---------------------------------------------------------------------+
|                   Memory Manager (New Module)                        |
|---------------------------------------------------------------------|
|                                                                      |
|  +----------------------------------------------------------------+  |
|  |                    Working Memory                              |  |
|  |  Current context window (fits in LLM)                          |  |
|  |  - System prompt                                               |  |
|  |  - Active tool schemas                                         |  |
|  |  - Recent messages (last N turns)                              |  |
|  |  - Retrieved context (from below)                              |  |
|  +----------------------------------------------------------------+  |
|                              ^                                       |
|                    retrieve  |  evict + summarize                    |
|                              |                                       |
|  +----------------------------------------------------------------+  |
|  |                   Episodic Memory                              |  |
|  |  VFS: /memory/episodes/                                        |  |
|  |  - Full conversation turns (JSON)                              |  |
|  |  - Recursive summaries (updated on eviction)                   |  |
|  |  - Temporal index (timestamps)                                 |  |
|  |  - Embeddings (via EmbeddingStore)                             |  |
|  +----------------------------------------------------------------+  |
|                              ^                                       |
|                    retrieve  |  consolidate                          |
|                              |                                       |
|  +----------------------------------------------------------------+  |
|  |                   Semantic Memory                              |  |
|  |  VFS: /memory/knowledge/                                       |  |
|  |  - Extracted facts (from conversations)                        |  |
|  |  - User preferences                                            |  |
|  |  - Learned patterns                                            |  |
|  |  - RAPTOR-style summary tree                                   |  |
|  +----------------------------------------------------------------+  |
|                                                                      |
+---------------------------------------------------------------------+
                                |
                                v
                      Existing: SemanticMemory, EmbeddingStore
```

### 3.2 Memory Tiers

| Tier | Storage | Capacity | Access Pattern |
|------|---------|----------|----------------|
| Working | Context window | ~8K tokens | Always loaded |
| Episodic | VFS `/memory/episodes/` | Unlimited | Evict + retrieve |
| Semantic | VFS `/memory/knowledge/` | Unlimited | Consolidate + search |

---

## 4. Implementation

### 4.1 Core Module: MemoryManager

```javascript
// core/memory-manager.js
const MemoryManager = {
  metadata: {
    id: 'MemoryManager',
    dependencies: ['Utils', 'VFS', 'EmbeddingStore', 'LLMClient'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EmbeddingStore, LLMClient } = deps;
    const { logger } = Utils;

    const WORKING_LIMIT = 8000; // tokens
    let workingMemory = [];
    let episodicSummary = '';

    // --- Eviction with Recursive Summarization ---

    const evictOldest = async (count) => {
      const evicted = workingMemory.splice(0, count);

      // Recursive summarization
      const newSummary = await LLMClient.generate({
        prompt: `Previous summary:\n${episodicSummary}\n\nNew messages:\n${formatMessages(evicted)}\n\nUpdate the summary to include the new information concisely:`,
        temperature: 0  // Deterministic for consistency
      });

      episodicSummary = newSummary;

      // Persist
      await VFS.write('/memory/episodes/summary.md', newSummary);
      await VFS.append('/memory/episodes/full.jsonl',
        evicted.map(JSON.stringify).join('\n') + '\n');

      // Index for retrieval
      await EmbeddingStore.add(evicted.map(m => ({
        text: m.content,
        metadata: { timestamp: Date.now(), role: m.role }
      })));

      logger.info(`[MemoryManager] Evicted ${count} messages, summary updated`);
    };

    // --- Retrieval with Summary + Full Context ---

    const retrieve = async (query, options = {}) => {
      const { maxTokens = 4000, includeSummary = true } = options;

      let context = [];
      let tokenCount = 0;

      // 1. Always include current summary (high-level context)
      if (includeSummary && episodicSummary) {
        context.push({ type: 'summary', content: episodicSummary });
        tokenCount += estimateTokens(episodicSummary);
      }

      // 2. Semantic search for relevant full messages
      const relevant = await EmbeddingStore.search(query, { limit: 20 });

      // 3. Add full messages until token budget exhausted
      for (const result of relevant) {
        const tokens = estimateTokens(result.content);
        if (tokenCount + tokens > maxTokens) break;
        context.push({ type: 'episode', content: result.content, score: result.score });
        tokenCount += tokens;
      }

      return context;
    };

    // --- Working Memory Management ---

    const add = (message) => {
      workingMemory.push(message);
      // Auto-evict if over limit
      const tokens = estimateTokens(workingMemory);
      if (tokens > WORKING_LIMIT) {
        const toEvict = Math.ceil(workingMemory.length / 4);
        evictOldest(toEvict);
      }
    };

    const getContext = async (query) => {
      // Combine working memory + retrieved context
      const retrieved = await retrieve(query);
      return {
        working: workingMemory,
        retrieved,
        summary: episodicSummary
      };
    };

    return {
      add,
      evictOldest,
      retrieve,
      getContext,
      getWorking: () => [...workingMemory],
      getSummary: () => episodicSummary,
    };
  }
};
```

### 4.2 RAPTOR-Style Knowledge Tree

```javascript
// capabilities/cognition/knowledge-tree.js

const buildKnowledgeTree = async (documents, deps) => {
  const { EmbeddingStore, LLMClient } = deps;

  // Level 0: Original chunks
  let currentLevel = await Promise.all(documents.map(async d => ({
    content: d,
    embedding: await EmbeddingStore.embed(d),
    children: []
  })));

  const tree = [currentLevel];

  // Build levels until single root
  while (currentLevel.length > 1) {
    // Cluster current level (simple k-means for browser)
    const clusters = clusterByEmbedding(currentLevel, {
      targetSize: Math.ceil(currentLevel.length / 3)
    });

    // Summarize each cluster
    const nextLevel = await Promise.all(clusters.map(async cluster => {
      const summary = await LLMClient.generate({
        prompt: `Summarize these related items:\n${cluster.map(n => n.content).join('\n\n')}`,
        temperature: 0
      });
      return {
        content: summary,
        embedding: await EmbeddingStore.embed(summary),
        children: cluster
      };
    }));

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return tree;
};

const queryTree = async (tree, query, deps) => {
  const { EmbeddingStore } = deps;
  const queryEmb = await EmbeddingStore.embed(query);

  // Collapsed tree retrieval: search ALL levels
  const allNodes = tree.flat();
  const scored = allNodes.map(node => ({
    ...node,
    score: cosineSimilarity(queryEmb, node.embedding)
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
};
```

### 4.3 Enhanced EmbeddingStore

Add temporal indexing to existing EmbeddingStore:

```javascript
// Extend EmbeddingStore with temporal features
const addWithTimestamp = async (items) => {
  const timestamped = items.map(item => ({
    ...item,
    metadata: {
      ...item.metadata,
      timestamp: Date.now(),
      sessionId: getCurrentSessionId()
    }
  }));
  return EmbeddingStore.add(timestamped);
};

// Temporal contiguity retrieval
const searchWithContiguity = async (query, options = {}) => {
  const { limit = 10, contiguityBoost = 0.2 } = options;

  // Get semantic matches
  const semantic = await EmbeddingStore.search(query, { limit: limit * 2 });

  // Boost temporally adjacent items
  const boosted = semantic.map((item, i) => {
    let boost = 0;
    // If previous/next items are also in results, boost this one
    const timestamps = semantic.map(s => s.metadata?.timestamp);
    const myTime = item.metadata?.timestamp;
    if (myTime) {
      const hasAdjacent = timestamps.some(t =>
        t && Math.abs(t - myTime) < 60000 // Within 1 minute
      );
      if (hasAdjacent) boost = contiguityBoost;
    }
    return { ...item, score: item.score + boost };
  });

  return boosted.sort((a, b) => b.score - a.score).slice(0, limit);
};
```

---

## 5. Integration Points

### 5.1 With Agent Loop

```javascript
// In agent-loop.js
const MemoryManager = await container.resolve('MemoryManager');

// Before each turn
const context = await MemoryManager.getContext(userMessage);
const history = [
  ...context.retrieved.map(r => ({ role: 'system', content: `[Memory] ${r.content}` })),
  ...context.working
];

// After each turn
MemoryManager.add({ role: 'user', content: userMessage });
MemoryManager.add({ role: 'assistant', content: response });
```

### 5.2 With Context Manager

Update existing Context Manager to delegate to MemoryManager:

```javascript
// Context Manager becomes a thin wrapper
const autoManageContext = async (history, modelName) => {
  // Delegate eviction decisions to MemoryManager
  const stats = getContextStats(history, modelName);
  if (stats.needsPruning) {
    await MemoryManager.evictOldest(Math.ceil(history.length / 4));
  }
  return MemoryManager.getWorking();
};
```

### 5.3 With Existing SemanticMemory

SemanticMemory becomes a specialized view into the Semantic tier:

```javascript
// SemanticMemory delegates to MemoryManager's knowledge tree
const recall = async (query, topK = 5) => {
  const tree = await VFS.readJSON('/memory/knowledge/tree.json');
  return queryTree(tree, query);
};
```

---

## 6. Implementation Pathway

### Phase 1: Core MemoryManager
- [ ] Implement MemoryManager module
- [ ] Working Memory tier (context window - 8K tokens)
- [ ] Eviction with recursive summarization (temp=0)
- [ ] VFS persistence to `/memory/episodes/`

### Phase 2: Episodic Memory
- [ ] Full message storage (VFS `/memory/episodes/full.jsonl`)
- [ ] Temporal indexing via EmbeddingStore
- [ ] Hybrid retrieval: summary + semantic search

### Phase 3: RAPTOR Knowledge Tree
- [ ] Implement hierarchical clustering (simple k-means)
- [ ] Recursive summarization to build tree levels
- [ ] Collapsed tree retrieval (search ALL levels)
- [ ] Persist tree structure in VFS `/memory/knowledge/tree.json`
- [ ] Incremental updates (add documents without full rebuild)

### Phase 4: Enhanced Retrieval
- [ ] Temporal contiguity boost
- [ ] Anticipatory retrieval (predict future needs based on task)
- [ ] Adaptive forgetting curves (not just LRU)

### Phase 5: Integration & Testing
- [ ] Wire into agent-loop for automatic context management
- [ ] Benchmark: memory reuse rate (target >50%)
- [ ] Benchmark: context reconstruction accuracy (target >90%)
- [ ] Long-session tests (100+ turns without degradation)

---

## 7. Alternatives Considered

### Alternative 1: Reversible Compression via Temperature 0

**Hypothesis:** Summarize with temperature 0 (deterministic), then "reverse" to recover original.

**Why it doesn't work:**
- Temperature 0 = deterministic forward mapping, NOT reversible
- Many inputs can produce the same summary (many-to-one)
- Information theory: cannot losslessly compress below entropy

**Verdict:** Rejected. Use storage + retrieval instead.

### Alternative 2: Pure RAG (No Summaries)

**Why summaries help:**
- RAG has 0% memory reuse (stateless)
- No narrative coherence
- Missing high-level context

**Verdict:** Use hybrid (summary + retrieval), not pure RAG.

### Alternative 3: Sliding Window Only

**Problems:**
- Loses all historical context
- No multi-session continuity

**Verdict:** Rejected for agents.

### Alternative 4: Single-Level Summarization

**Why hierarchical is better:**
- Multi-resolution access (global + local)
- Clustering groups related content
- 20% accuracy gain in RAPTOR experiments

**Verdict:** Use RAPTOR-style tree.

---

## 8. Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Memory reuse rate | >50% | % of queries answered from cache vs fresh retrieval |
| Context reconstruction accuracy | >90% | Semantic similarity of retrieved vs original |
| Max session length | 100+ turns | Turns before quality degradation |
| Eviction latency | <100ms | Time to summarize and store evicted messages |
| Retrieval latency | <50ms | Time to search and return context |

---

## 9. References

### Primary Research
- [RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval](https://arxiv.org/abs/2401.18059) - ICLR 2024
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) - UC Berkeley
- [Cognitive Workspace: Active Memory Management for LLMs](https://arxiv.org/abs/2508.13171) - 2025
- [EM-LLM: Human-like Episodic Memory for Infinite Context](https://arxiv.org/abs/2407.09450)

### Implementations
- [RAPTOR GitHub](https://github.com/parthsarthi03/raptor)
- [Letta (MemGPT)](https://docs.letta.com/)
- [EM-LLM GitHub](https://github.com/em-llm/EM-LLM-model)

### Related Blueprints
- [0x00005F: Semantic Memory](0x00005F-semantic-memory.md)
- [0x00003B: Context Management](0x00003B-context-management.md)
- [0x00005E: Embedding Store](0x00005E-embedding-store.md)
- [0x000060: Knowledge Graph](0x000060-knowledge-graph.md)

---

**Remember:** This architecture replaces simple truncation with intelligent eviction + retrieval. The key insight is that summaries provide high-level context while full messages remain searchable for details.
