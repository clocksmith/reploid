/**
 * @fileoverview Embedding Store
 * VFS-backed storage for semantic memory embeddings.
 * Provides vector storage, similarity search, temporal indexing,
 * and Ebbinghaus-style adaptive forgetting.
 *
 * Storage: /.memory/embeddings/*.json (one file per memory)
 *          /.memory/vocab.json (vocabulary index)
 */

const EmbeddingStore = {
  metadata: {
    id: 'EmbeddingStore',
    version: '3.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger, generateId, Errors } = Utils;

    const MEMORY_DIR = '/.memory/embeddings';
    const VOCAB_PATH = '/.memory/vocab.json';
    const MAX_MEMORIES = 10000;

    // Adaptive forgetting configuration (Ebbinghaus-style)
    const FORGETTING_CONFIG = {
      decayHalfLifeMs: 86400000 * 7,  // 7 days base half-life
      accessBoostFactor: 0.15,         // Each access adds 15% to strength
      minRetentionScore: 0.1,          // Threshold for pruning
      importanceBoostFactor: 0.25      // Importance metadata boost
    };

    let initialized = false;

    // --- Helpers ---

    const memoryPath = (id) => `${MEMORY_DIR}/${id}.json`;

    const ensureDir = async () => {
      if (!initialized) {
        try {
          const exists = await VFS.exists(MEMORY_DIR);
          if (!exists) {
            await VFS.mkdir(MEMORY_DIR);
          }
        } catch {
          // Directory may already exist
        }
        initialized = true;
      }
    };

    const readJSON = async (path) => {
      try {
        const content = await VFS.read(path);
        return JSON.parse(content);
      } catch {
        return null;
      }
    };

    const writeJSON = async (path, data) => {
      await VFS.write(path, JSON.stringify(data));
    };

    // --- Database Setup ---

    const init = async () => {
      await ensureDir();
      logger.info('[EmbeddingStore] Initialized (VFS-backed)');
      return true;
    };

    // --- Memory Operations ---

    const addMemory = async (memory) => {
      await ensureDir();
      const id = memory.id || generateId('mem');

      const entry = {
        id,
        content: memory.content,
        embedding: memory.embedding, // Array
        domain: memory.domain || 'general',
        timestamp: Date.now(),
        accessCount: 0,
        source: memory.source || 'assistant',
        metadata: memory.metadata || {}
      };

      await writeJSON(memoryPath(id), entry);
      logger.debug(`[EmbeddingStore] Added memory: ${id}`);
      return id;
    };

    const getMemory = async (id) => {
      await ensureDir();
      return readJSON(memoryPath(id));
    };

    const getAllMemories = async () => {
      await ensureDir();
      try {
        const files = await VFS.list(MEMORY_DIR);
        const memories = [];

        for (const file of files) {
          if (file.endsWith('.json')) {
            const memory = await readJSON(file);
            if (memory) memories.push(memory);
          }
        }

        return memories;
      } catch {
        return [];
      }
    };

    const updateAccessCount = async (id) => {
      const memory = await getMemory(id);
      if (!memory) return;

      memory.accessCount = (memory.accessCount || 0) + 1;
      await writeJSON(memoryPath(id), memory);
      return true;
    };

    const deleteMemory = async (id) => {
      await ensureDir();
      try {
        await VFS.delete(memoryPath(id));
        logger.debug(`[EmbeddingStore] Deleted memory: ${id}`);
        return true;
      } catch {
        return false;
      }
    };

    // --- Similarity Search ---

    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
      return magnitude === 0 ? 0 : dotProduct / magnitude;
    };

    const searchSimilar = async (queryEmbedding, topK = 5, minSimilarity = 0.5) => {
      const memories = await getAllMemories();
      const queryArray = Array.isArray(queryEmbedding)
        ? queryEmbedding
        : Array.from(queryEmbedding);

      const scored = memories
        .filter(m => m.embedding && m.embedding.length > 0)
        .map(m => {
          const embArray = Array.isArray(m.embedding)
            ? m.embedding
            : Array.from(m.embedding);
          const similarity = cosineSimilarity(queryArray, embArray);
          return { memory: m, similarity };
        })
        .filter(item => item.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      // Update access counts for returned memories
      for (const item of scored) {
        await updateAccessCount(item.memory.id);
      }

      return scored;
    };

    // --- Vocabulary Operations ---

    const updateVocabulary = async (tokens) => {
      await ensureDir();
      const now = Date.now();
      let vocab = await readJSON(VOCAB_PATH) || {};

      for (const token of tokens) {
        const existing = vocab[token] || { token, frequency: 0, domains: [] };
        existing.frequency += 1;
        existing.lastSeen = now;
        vocab[token] = existing;
      }

      await writeJSON(VOCAB_PATH, vocab);
      return true;
    };

    const getVocabulary = async () => {
      await ensureDir();
      const vocab = await readJSON(VOCAB_PATH) || {};
      return Object.values(vocab);
    };

    // --- Maintenance ---

    const pruneOldMemories = async (maxAge = 7 * 24 * 60 * 60 * 1000) => {
      const memories = await getAllMemories();
      const now = Date.now();
      const cutoff = now - maxAge;

      // Sort by accessCount (LRU), then timestamp
      const candidates = memories
        .filter(m => m.timestamp < cutoff)
        .sort((a, b) => a.accessCount - b.accessCount || a.timestamp - b.timestamp);

      // Delete excess memories
      const toDelete = candidates.slice(0, Math.max(0, memories.length - MAX_MEMORIES));
      let deleted = 0;

      for (const memory of toDelete) {
        await deleteMemory(memory.id);
        deleted++;
      }

      if (deleted > 0) {
        logger.info(`[EmbeddingStore] Pruned ${deleted} old memories`);
      }

      return deleted;
    };

    const getStats = async () => {
      const memories = await getAllMemories();
      const vocab = await getVocabulary();

      return {
        memoryCount: memories.length,
        vocabularySize: vocab.length,
        maxMemories: MAX_MEMORIES,
        oldestMemory: memories.length > 0
          ? Math.min(...memories.map(m => m.timestamp))
          : null
      };
    };

    const clear = async () => {
      await ensureDir();
      try {
        const files = await VFS.list(MEMORY_DIR);
        for (const file of files) {
          await VFS.delete(file);
        }
        await VFS.delete(VOCAB_PATH);
        logger.info('[EmbeddingStore] Cleared all data');
        return true;
      } catch (e) {
        logger.warn('[EmbeddingStore] Clear failed:', e.message);
        return false;
      }
    };

    // --- Temporal Indexing & Contiguity Search ---

    const searchByTimeRange = async (startTime, endTime, options = {}) => {
      const { limit = 100, domain = null } = options;
      const memories = await getAllMemories();

      return memories
        .filter(m => {
          const inRange = m.timestamp >= startTime && m.timestamp <= endTime;
          const matchesDomain = !domain || m.domain === domain;
          return inRange && matchesDomain;
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    };

    const searchWithContiguity = async (queryEmbedding, options = {}) => {
      const {
        topK = 10,
        minSimilarity = 0.3,
        contiguityWindowMs = 60000,  // 1 minute
        contiguityBoost = 0.15
      } = options;

      // Get base semantic matches
      const baseResults = await searchSimilar(queryEmbedding, topK * 2, minSimilarity);

      if (baseResults.length < 2) return baseResults;

      // Extract timestamps
      const timestamps = baseResults.map(r =>
        r.memory.metadata?.timestamp || r.memory.timestamp
      );

      // Apply temporal contiguity boost
      const boosted = baseResults.map((result, i) => {
        const myTime = timestamps[i];
        if (!myTime) return result;

        // Check if temporally adjacent items are in result set
        const hasTemporalNeighbor = timestamps.some((t, j) => {
          if (i === j || !t) return false;
          return Math.abs(t - myTime) < contiguityWindowMs;
        });

        return {
          ...result,
          similarity: result.similarity + (hasTemporalNeighbor ? contiguityBoost : 0),
          hasContiguity: hasTemporalNeighbor
        };
      });

      // Re-sort by boosted similarity
      return boosted
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
    };

    const getRecentMemories = async (count = 20, domain = null) => {
      const memories = await getAllMemories();

      return memories
        .filter(m => !domain || m.domain === domain)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, count);
    };

    const getSessionMemories = async (sessionId) => {
      const memories = await getAllMemories();
      return memories.filter(m =>
        m.metadata?.sessionId === sessionId
      ).sort((a, b) => a.timestamp - b.timestamp);
    };

    const addMemoryWithSession = async (memory, sessionId) => {
      return addMemory({
        ...memory,
        metadata: {
          ...(memory.metadata || {}),
          sessionId,
          timestamp: Date.now()
        }
      });
    };

    // --- Adaptive Forgetting (Ebbinghaus-style) ---

    /**
     * Compute retention score for a memory using Ebbinghaus forgetting curve.
     * R = e^(-t/S) where S is strength modified by access frequency and importance.
     *
     * @param {Object} memory - Memory object with timestamp and accessCount
     * @returns {number} Retention score between minRetentionScore and 1
     */
    const computeRetentionScore = (memory) => {
      if (!memory?.timestamp) return 1;

      const age = Date.now() - memory.timestamp;
      const accessCount = memory.accessCount || 0;
      const importance = memory.metadata?.importance || 0;

      // Calculate strength: base half-life * (1 + access boost + importance boost)
      const strength = FORGETTING_CONFIG.decayHalfLifeMs * (
        1 +
        accessCount * FORGETTING_CONFIG.accessBoostFactor +
        importance * FORGETTING_CONFIG.importanceBoostFactor
      );

      // Ebbinghaus exponential decay
      const retention = Math.exp(-age / strength);

      return Math.max(FORGETTING_CONFIG.minRetentionScore, retention);
    };

    /**
     * Search with retention-weighted scoring.
     * Combines semantic similarity with memory retention for adaptive recall.
     *
     * @param {Array} queryEmbedding - Query embedding vector
     * @param {Object} options - Search options
     * @returns {Promise<Array>} Results with retention-adjusted scores
     */
    const searchWithRetention = async (queryEmbedding, options = {}) => {
      const {
        topK = 10,
        minSimilarity = 0.3,
        retentionWeight = 0.3  // How much retention affects final score
      } = options;

      const memories = await getAllMemories();
      const queryArray = Array.isArray(queryEmbedding)
        ? queryEmbedding
        : Array.from(queryEmbedding);

      const scored = memories
        .filter(m => m.embedding && m.embedding.length > 0)
        .map(m => {
          const embArray = Array.isArray(m.embedding)
            ? m.embedding
            : Array.from(m.embedding);
          const similarity = cosineSimilarity(queryArray, embArray);
          const retention = computeRetentionScore(m);

          // Weighted combination: similarity * (1 - retentionWeight) + retention * retentionWeight
          const combinedScore = similarity * (1 - retentionWeight) + retention * retentionWeight;

          return {
            memory: m,
            similarity,
            retention,
            score: combinedScore
          };
        })
        .filter(item => item.similarity >= minSimilarity)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      // Update access counts
      for (const item of scored) {
        await updateAccessCount(item.memory.id);
      }

      return scored;
    };

    /**
     * Prune memories below retention threshold.
     * Implements adaptive forgetting based on Ebbinghaus decay.
     *
     * @returns {Promise<number>} Number of memories pruned
     */
    const pruneByRetention = async () => {
      const memories = await getAllMemories();
      let pruned = 0;

      for (const memory of memories) {
        const retention = computeRetentionScore(memory);
        if (retention <= FORGETTING_CONFIG.minRetentionScore) {
          await deleteMemory(memory.id);
          pruned++;
        }
      }

      if (pruned > 0) {
        logger.info(`[EmbeddingStore] Pruned ${pruned} memories below retention threshold`);
      }

      return pruned;
    };

    /**
     * Update memory importance to affect retention.
     *
     * @param {string} id - Memory ID
     * @param {number} importance - Importance value (0-1)
     * @returns {Promise<boolean>} Success status
     */
    const updateImportance = async (id, importance) => {
      const memory = await getMemory(id);
      if (!memory) return false;

      memory.metadata = memory.metadata || {};
      memory.metadata.importance = Math.max(0, Math.min(1, importance));

      await writeJSON(memoryPath(id), memory);
      return true;
    };

    /**
     * Update memory metadata or content.
     *
     * @param {string} id - Memory ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<boolean>} Success status
     */
    const updateMemory = async (id, updates) => {
      const memory = await getMemory(id);
      if (!memory) return false;

      Object.assign(memory, updates);
      await writeJSON(memoryPath(id), memory);
      return true;
    };

    /**
     * Get memories grouped by retention level.
     *
     * @returns {Promise<Object>} Memories grouped into retention buckets
     */
    const getMemoriesByRetention = async () => {
      const memories = await getAllMemories();

      const buckets = {
        strong: [],     // retention >= 0.7
        moderate: [],   // 0.4 <= retention < 0.7
        weak: [],       // 0.2 <= retention < 0.4
        fading: []      // retention < 0.2
      };

      for (const memory of memories) {
        const retention = computeRetentionScore(memory);
        if (retention >= 0.7) {
          buckets.strong.push({ memory, retention });
        } else if (retention >= 0.4) {
          buckets.moderate.push({ memory, retention });
        } else if (retention >= 0.2) {
          buckets.weak.push({ memory, retention });
        } else {
          buckets.fading.push({ memory, retention });
        }
      }

      return buckets;
    };

    /**
     * Configure forgetting parameters.
     *
     * @param {Object} config - New configuration values
     */
    const configureForgetting = (config) => {
      Object.assign(FORGETTING_CONFIG, config);
      logger.info('[EmbeddingStore] Forgetting config updated');
    };

    return {
      init,
      addMemory,
      addMemoryWithSession,
      getMemory,
      getAllMemories,
      deleteMemory,
      updateMemory,
      searchSimilar,
      searchWithContiguity,
      searchWithRetention,
      searchByTimeRange,
      getRecentMemories,
      getSessionMemories,
      updateVocabulary,
      getVocabulary,
      pruneOldMemories,
      pruneByRetention,
      computeRetentionScore,
      updateAccessCount,
      updateImportance,
      getMemoriesByRetention,
      configureForgetting,
      getStats,
      clear
    };
  }
};

export default EmbeddingStore;
