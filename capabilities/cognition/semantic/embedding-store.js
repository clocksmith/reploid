/**
 * @fileoverview Embedding Store
 * IndexedDB-backed storage for semantic memory embeddings.
 * Provides vector storage, similarity search, and LRU pruning.
 */

const EmbeddingStore = {
  metadata: {
    id: 'EmbeddingStore',
    version: '1.0.0',
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

    return {
      init,
      addMemory,
      getMemory,
      getAllMemories,
      deleteMemory,
      searchSimilar,
      updateVocabulary,
      getVocabulary,
      pruneOldMemories,
      getStats,
      clear
    };
  }
};

export default EmbeddingStore;
