/**
 * @fileoverview Embedding Store
 * IndexedDB-backed storage for semantic memory embeddings.
 * Provides vector storage, similarity search, temporal indexing,
 * and Ebbinghaus-style adaptive forgetting.
 */

const EmbeddingStore = {
  metadata: {
    id: 'EmbeddingStore',
    version: '2.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger, generateId, Errors } = Utils;

    const DB_NAME = 'reploid-semantic-v1';
    const STORE_MEMORIES = 'memories';
    const STORE_VOCAB = 'vocabulary';
    const MAX_MEMORIES = 10000;

    // Adaptive forgetting configuration (Ebbinghaus-style)
    const FORGETTING_CONFIG = {
      decayHalfLifeMs: 86400000 * 7,  // 7 days base half-life
      accessBoostFactor: 0.15,         // Each access adds 15% to strength
      minRetentionScore: 0.1,          // Threshold for pruning
      importanceBoostFactor: 0.25      // Importance metadata boost
    };

    let db = null;

    // --- Database Setup ---

    const openDB = () => {
      return new Promise((resolve, reject) => {
        if (db) return resolve(db);

        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (event) => {
          const d = event.target.result;

          // Memories store
          if (!d.objectStoreNames.contains(STORE_MEMORIES)) {
            const memStore = d.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
            memStore.createIndex('timestamp', 'timestamp', { unique: false });
            memStore.createIndex('domain', 'domain', { unique: false });
            memStore.createIndex('accessCount', 'accessCount', { unique: false });
          }

          // Vocabulary store
          if (!d.objectStoreNames.contains(STORE_VOCAB)) {
            const vocabStore = d.createObjectStore(STORE_VOCAB, { keyPath: 'token' });
            vocabStore.createIndex('frequency', 'frequency', { unique: false });
            vocabStore.createIndex('lastSeen', 'lastSeen', { unique: false });
          }
        };

        request.onsuccess = (e) => {
          db = e.target.result;
          logger.info('[EmbeddingStore] Database connected');
          resolve(db);
        };

        request.onerror = () => {
          reject(new Errors.StateError('Failed to open EmbeddingStore DB'));
        };
      });
    };

    const init = async () => {
      await openDB();
      return true;
    };

    // --- Memory Operations ---

    const addMemory = async (memory) => {
      await openDB();
      const id = memory.id || generateId('mem');

      const entry = {
        id,
        content: memory.content,
        embedding: memory.embedding, // Float32Array or array
        domain: memory.domain || 'general',
        timestamp: Date.now(),
        accessCount: 0,
        source: memory.source || 'assistant',
        metadata: memory.metadata || {}
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        store.put(entry).onsuccess = () => {
          logger.debug(`[EmbeddingStore] Added memory: ${id}`);
          resolve(id);
        };
        tx.onerror = () => reject(new Errors.ArtifactError(`Failed to add memory: ${id}`));
      });
    };

    const getMemory = async (id) => {
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readonly');
        const req = tx.objectStore(STORE_MEMORIES).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(new Errors.ArtifactError(`Failed to get memory: ${id}`));
      });
    };

    const getAllMemories = async () => {
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readonly');
        const req = tx.objectStore(STORE_MEMORIES).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(new Errors.ArtifactError('Failed to get all memories'));
      });
    };

    const updateAccessCount = async (id) => {
      await openDB();
      const memory = await getMemory(id);
      if (!memory) return;

      memory.accessCount = (memory.accessCount || 0) + 1;

      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        store.put(memory).onsuccess = () => resolve(true);
        tx.onerror = () => reject(new Errors.ArtifactError(`Failed to update access count: ${id}`));
      });
    };

    const deleteMemory = async (id) => {
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readwrite');
        const req = tx.objectStore(STORE_MEMORIES).delete(id);
        req.onsuccess = () => {
          logger.debug(`[EmbeddingStore] Deleted memory: ${id}`);
          resolve(true);
        };
        req.onerror = () => reject(new Errors.ArtifactError(`Failed to delete memory: ${id}`));
      });
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
      await openDB();
      const now = Date.now();

      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_VOCAB], 'readwrite');
        const store = tx.objectStore(STORE_VOCAB);

        let completed = 0;
        const total = tokens.length;

        for (const token of tokens) {
          const getReq = store.get(token);
          getReq.onsuccess = () => {
            const existing = getReq.result;
            const entry = existing || { token, frequency: 0, domains: [] };
            entry.frequency += 1;
            entry.lastSeen = now;
            store.put(entry);
            completed++;
            if (completed === total) resolve(true);
          };
        }

        if (total === 0) resolve(true);
        tx.onerror = () => reject(new Errors.ArtifactError('Failed to update vocabulary'));
      });
    };

    const getVocabulary = async () => {
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_VOCAB], 'readonly');
        const req = tx.objectStore(STORE_VOCAB).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(new Errors.ArtifactError('Failed to get vocabulary'));
      });
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
      await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES, STORE_VOCAB], 'readwrite');
        tx.objectStore(STORE_MEMORIES).clear();
        tx.objectStore(STORE_VOCAB).clear();
        tx.oncomplete = () => {
          logger.info('[EmbeddingStore] Cleared all data');
          resolve(true);
        };
        tx.onerror = () => reject(new Errors.ArtifactError('Failed to clear store'));
      });
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
      await openDB();
      const memory = await getMemory(id);
      if (!memory) return false;

      memory.metadata = memory.metadata || {};
      memory.metadata.importance = Math.max(0, Math.min(1, importance));

      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_MEMORIES], 'readwrite');
        const store = tx.objectStore(STORE_MEMORIES);
        store.put(memory).onsuccess = () => resolve(true);
        tx.onerror = () => reject(new Errors.ArtifactError(`Failed to update importance: ${id}`));
      });
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
      updateImportance,
      getMemoriesByRetention,
      configureForgetting,
      getStats,
      clear
    };
  }
};

export default EmbeddingStore;
