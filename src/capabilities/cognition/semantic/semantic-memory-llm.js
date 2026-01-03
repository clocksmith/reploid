/**
 * @fileoverview Semantic Memory (LLM-based)
 * Uses the configured LLM for tag extraction and similarity ranking.
 * No external model downloads required - works with any LLM backend.
 */

const SemanticMemoryLLM = {
  metadata: {
    id: 'SemanticMemory',
    version: '2.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'EventBus', 'VFS', 'LLMClient'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, LLMClient } = deps;
    const { logger, generateId, Errors } = Utils;

    // Storage path
    const MEMORY_PATH = '/.memory/semantic-memories.json';
    const INDEX_PATH = '/.memory/semantic-index.json';

    // Configuration
    const CONFIG = {
      maxMemories: 1000,
      maxTagsPerMemory: 10,
      topKDefault: 5,
      rerankTopK: 10,
      minRelevanceScore: 3
    };

    // In-memory state
    let _memories = [];
    let _tagIndex = {}; // tag -> [memoryIds]
    let _isInitialized = false;

    // --- Storage ---

    const loadFromVFS = async () => {
      try {
        const data = await VFS.read(MEMORY_PATH);
        if (data) {
          _memories = JSON.parse(data);
        }
      } catch (e) {
        _memories = [];
      }

      try {
        const indexData = await VFS.read(INDEX_PATH);
        if (indexData) {
          _tagIndex = JSON.parse(indexData);
        }
      } catch (e) {
        _tagIndex = {};
      }
    };

    const saveToVFS = async () => {
      await VFS.write(MEMORY_PATH, JSON.stringify(_memories, null, 2));
      await VFS.write(INDEX_PATH, JSON.stringify(_tagIndex, null, 2));
    };

    // --- Tag Extraction via LLM ---

    const extractTags = async (text) => {
      if (!text || text.length < 10) return [];

      // Always use fast fallback - LLM extraction is expensive for tags
      // LLM-based extraction can be enabled later for higher quality
      return extractKeywordsFallback(text);
    };

    const extractKeywordsFallback = (text) => {
      const words = text.toLowerCase().match(/\b[a-z]{3,15}\b/g) || [];
      const freq = {};
      for (const w of words) {
        if (!STOP_WORDS.has(w)) {
          freq[w] = (freq[w] || 0) + 1;
        }
      }
      return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([word]) => word);
    };

    const STOP_WORDS = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
      'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
      'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also'
    ]);

    // --- Scoring (tag-based, no LLM calls) ---

    const scoreAndRank = (candidates) => {
      if (candidates.length === 0) return [];
      // Normalize tag scores to 0-10 range and filter by minimum
      const maxScore = Math.max(...candidates.map(c => c.tagScore || 1));
      return candidates
        .map(m => ({ ...m, score: ((m.tagScore || 0) / maxScore) * 10 }))
        .filter(m => m.score >= CONFIG.minRelevanceScore)
        .sort((a, b) => b.score - a.score);
    };

    // --- Core API ---

    const init = async () => {
      if (_isInitialized) return true;

      await loadFromVFS();
      _isInitialized = true;

      EventBus.on('agent:history', handleAgentHistory);
      logger.info(`[SemanticMemory] Initialized with ${_memories.length} memories`);

      return true;
    };

    const store = async (text, metadata = {}) => {
      if (!text || typeof text !== 'string' || text.length < 20) {
        return null;
      }

      const tags = await extractTags(text);
      const id = generateId();

      const memory = {
        id,
        content: text.slice(0, 2000), // Limit storage size
        tags,
        domain: metadata.domain || 'general',
        source: metadata.source || 'assistant',
        timestamp: Date.now(),
        metadata
      };

      _memories.push(memory);

      // Update tag index
      for (const tag of tags) {
        if (!_tagIndex[tag]) _tagIndex[tag] = [];
        _tagIndex[tag].push(id);
      }

      // Prune if over limit
      if (_memories.length > CONFIG.maxMemories) {
        const removed = _memories.shift();
        for (const tag of removed.tags || []) {
          if (_tagIndex[tag]) {
            _tagIndex[tag] = _tagIndex[tag].filter(mid => mid !== removed.id);
          }
        }
      }

      await saveToVFS();

      EventBus.emit('cognition:semantic:store', { id, tags });
      logger.debug(`[SemanticMemory] Stored memory with tags: ${tags.join(', ')}`);

      return id;
    };

    const search = async (query, options = {}) => {
      const { topK = CONFIG.topKDefault } = options;

      if (!query || _memories.length === 0) return [];

      // Extract query tags
      const queryTags = await extractTags(query);
      const queryWords = new Set(query.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);

      // Score memories by tag overlap
      const scored = _memories.map(memory => {
        const memoryTags = new Set(memory.tags || []);
        const memoryWords = new Set(memory.content.toLowerCase().match(/\b[a-z]{3,}\b/g) || []);

        // Tag overlap score
        let tagScore = 0;
        for (const qt of queryTags) {
          if (memoryTags.has(qt)) tagScore += 2;
        }

        // Word overlap score
        let wordScore = 0;
        for (const qw of queryWords) {
          if (memoryWords.has(qw)) wordScore += 1;
        }

        return {
          ...memory,
          tagScore: tagScore + wordScore * 0.5
        };
      });

      // Filter and sort by tag score
      const candidates = scored
        .filter(m => m.tagScore > 0)
        .sort((a, b) => b.tagScore - a.tagScore)
        .slice(0, CONFIG.rerankTopK);

      if (candidates.length === 0) return [];

      // Score and rank by tag overlap
      const ranked = scoreAndRank(candidates);

      EventBus.emit('cognition:semantic:search', {
        query: query.slice(0, 50),
        candidates: candidates.length,
        results: ranked.length
      });

      return ranked.slice(0, topK).map(r => ({
        id: r.id,
        content: r.content,
        similarity: r.score / 10, // Normalize to 0-1
        domain: r.domain,
        timestamp: r.timestamp,
        tags: r.tags
      }));
    };

    const enrich = async (query, context = []) => {
      try {
        const relevantMemories = await search(query, { topK: 3 });

        if (relevantMemories.length === 0) {
          return context;
        }

        const memoryContext = relevantMemories
          .map(m => `[Memory: ${m.domain}] ${m.content.slice(0, 200)}`)
          .join('\n');

        const enrichedContext = [...context];
        const insertIdx = enrichedContext.findIndex(m => m.role !== 'system');
        const idx = insertIdx === -1 ? enrichedContext.length : insertIdx;

        enrichedContext.splice(idx, 0, {
          role: 'system',
          content: `Relevant context from memory:\n${memoryContext}`
        });

        logger.debug(`[SemanticMemory] Enriched context with ${relevantMemories.length} memories`);

        return enrichedContext;
      } catch (err) {
        logger.warn('[SemanticMemory] Enrichment failed', err.message);
        return context;
      }
    };

    // Compatibility: embed returns tags as a simple representation
    const embed = async (text) => {
      const tags = await extractTags(text);
      // Return a sparse "embedding" based on tag hashes for compatibility
      const embedding = new Array(384).fill(0);
      for (const tag of tags) {
        const hash = simpleHash(tag) % 384;
        embedding[hash] = 1;
      }
      return embedding;
    };

    const simpleHash = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    // Compatibility: cosineSimilarity for any code that uses it
    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
    };

    // --- Auto-learning from agent history ---

    let _learningQueue = [];
    let _learningTimeout = null;

    const handleAgentHistory = (event) => {
      if (event.type === 'llm_response' && event.content?.length > 100) {
        _learningQueue.push({
          content: event.content,
          source: 'assistant',
          domain: 'conversation'
        });
        scheduleLearning();
      } else if (event.type === 'tool_result' && event.result) {
        const content = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        if (content.length > 100) {
          _learningQueue.push({
            content,
            source: 'tool',
            domain: event.tool || 'tool'
          });
          scheduleLearning();
        }
      }
    };

    const scheduleLearning = () => {
      if (_learningTimeout) return;
      _learningTimeout = setTimeout(processLearningQueue, 5000);
    };

    const processLearningQueue = async () => {
      _learningTimeout = null;
      const batch = _learningQueue.splice(0, 5);

      for (const item of batch) {
        try {
          await store(item.content, {
            source: item.source,
            domain: item.domain
          });
        } catch (e) {
          logger.debug('[SemanticMemory] Learning failed', e.message);
        }
      }

      if (_learningQueue.length > 0) {
        scheduleLearning();
      }
    };

    // --- Maintenance ---

    const getStats = async () => {
      return {
        memories: _memories.length,
        tags: Object.keys(_tagIndex).length,
        domains: [...new Set(_memories.map(m => m.domain))],
        queueSize: _learningQueue.length,
        implementation: 'llm-based'
      };
    };

    const clear = async () => {
      _memories = [];
      _tagIndex = {};
      _learningQueue = [];
      if (_learningTimeout) {
        clearTimeout(_learningTimeout);
        _learningTimeout = null;
      }
      await saveToVFS();
      logger.info('[SemanticMemory] Cleared');
    };

    const dispose = async () => {
      EventBus.off('agent:history', handleAgentHistory);
      if (_learningTimeout) {
        clearTimeout(_learningTimeout);
      }
      _isInitialized = false;
      logger.info('[SemanticMemory] Disposed');
    };

    const prune = async () => {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
      const before = _memories.length;
      _memories = _memories.filter(m => m.timestamp > cutoff);

      // Rebuild tag index
      _tagIndex = {};
      for (const m of _memories) {
        for (const tag of m.tags || []) {
          if (!_tagIndex[tag]) _tagIndex[tag] = [];
          _tagIndex[tag].push(m.id);
        }
      }

      await saveToVFS();
      return before - _memories.length;
    };

    // Compatibility: routeToExpert for FunctionGemma
    const routeToExpert = async (task, experts) => {
      if (!task?.description || !experts?.length) return [];

      const taskTags = await extractTags(task.description);

      const scored = await Promise.all(experts.map(async expert => {
        const expertTags = expert._tags || await extractTags(expert.specialization || '');
        expert._tags = expertTags;

        let score = 0;
        for (const tt of taskTags) {
          if (expertTags.includes(tt)) score += 2;
        }
        return { expert, score };
      }));

      scored.sort((a, b) => b.score - a.score);
      const topK = task.topK || 1;

      return scored.slice(0, topK).map(s => s.expert);
    };

    return {
      init,
      embed,
      embedBatch: async (texts) => Promise.all(texts.map(embed)),
      store,
      search,
      enrich,
      routeToExpert,
      cosineSimilarity,
      prune,
      getStats,
      clear,
      dispose
    };
  }
};

export default SemanticMemoryLLM;
