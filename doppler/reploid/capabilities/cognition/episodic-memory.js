/**
 * @fileoverview Episodic Memory
 * Full conversation message storage with embeddings, searchable history,
 * and integration with SemanticMemory. Implements VFS-backed persistence.
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 */

const EpisodicMemory = {
  metadata: {
    id: 'EpisodicMemory',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'SemanticMemory', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, SemanticMemory, EventBus } = deps;
    const { logger, generateId, Errors } = Utils;

    // --- Configuration ---
    const CONFIG = {
      episodesPath: '/memory/episodes/',
      indexPath: '/memory/episodes/index.json',
      manifestPath: '/memory/episodes/manifest.json',
      maxEpisodesInMemory: 1000,
      batchSize: 50,
      minContentLength: 20,
      // Temporal settings
      sessionWindowMs: 3600000,  // 1 hour session window
      // Ebbinghaus-style retention
      decayHalfLifeMs: 86400000 * 7, // 7 days
      accessBoostFactor: 0.2,
      minRetentionScore: 0.05
    };

    // --- State ---
    let _episodes = [];         // In-memory cache of recent episodes
    let _index = null;          // Episode index: { bySession: {}, byTimestamp: [], byId: {} }
    let _manifest = null;       // { totalEpisodes, sessions, lastUpdated }
    let _isInitialized = false;

    // --- Initialization ---

    const init = async () => {
      if (_isInitialized) return true;

      try {
        // Ensure directory exists
        await VFS.mkdir(CONFIG.episodesPath);

        // Load index
        if (await VFS.exists(CONFIG.indexPath)) {
          const content = await VFS.read(CONFIG.indexPath);
          _index = JSON.parse(content);
        } else {
          _index = {
            bySession: {},
            byTimestamp: [],
            byId: {}
          };
        }

        // Load manifest
        if (await VFS.exists(CONFIG.manifestPath)) {
          const content = await VFS.read(CONFIG.manifestPath);
          _manifest = JSON.parse(content);
        } else {
          _manifest = {
            totalEpisodes: 0,
            sessions: [],
            lastUpdated: Date.now(),
            version: 1
          };
        }

        _isInitialized = true;
        logger.info('[EpisodicMemory] Initialized', {
          totalEpisodes: _manifest.totalEpisodes,
          sessions: _manifest.sessions.length
        });

        return true;
      } catch (err) {
        logger.error('[EpisodicMemory] Init failed:', err.message);
        throw new Errors.StateError('EpisodicMemory initialization failed');
      }
    };

    // --- Episode Operations ---

    /**
     * Store a conversation message as an episode.
     *
     * @param {Object} message - Message object
     * @param {string} message.role - 'user' | 'assistant' | 'system' | 'tool'
     * @param {string} message.content - Message content
     * @param {Object} [options] - Storage options
     * @returns {Promise<string>} Episode ID
     */
    const store = async (message, options = {}) => {
      if (!message?.content || message.content.length < CONFIG.minContentLength) {
        return null;
      }

      const {
        sessionId = generateId('session'),
        timestamp = Date.now(),
        metadata = {}
      } = options;

      // Generate embedding
      let embedding = null;
      try {
        embedding = await SemanticMemory.embed(message.content);
      } catch (err) {
        logger.warn('[EpisodicMemory] Embedding failed:', err.message);
      }

      const episode = {
        id: generateId('ep'),
        role: message.role,
        content: message.content,
        embedding,
        sessionId,
        timestamp,
        accessCount: 0,
        metadata: {
          ...metadata,
          createdAt: Date.now()
        }
      };

      // Add to in-memory cache
      _episodes.push(episode);
      if (_episodes.length > CONFIG.maxEpisodesInMemory) {
        _episodes.shift(); // Remove oldest
      }

      // Update index
      _index.byId[episode.id] = {
        sessionId,
        timestamp,
        file: getEpisodeFilePath(sessionId)
      };

      if (!_index.bySession[sessionId]) {
        _index.bySession[sessionId] = [];
      }
      _index.bySession[sessionId].push(episode.id);

      _index.byTimestamp.push({
        id: episode.id,
        timestamp
      });
      // Keep sorted
      _index.byTimestamp.sort((a, b) => b.timestamp - a.timestamp);

      // Update manifest
      if (!_manifest.sessions.includes(sessionId)) {
        _manifest.sessions.push(sessionId);
      }
      _manifest.totalEpisodes++;
      _manifest.lastUpdated = Date.now();

      // Persist
      await persistEpisode(episode, sessionId);
      await persistIndex();
      await persistManifest();

      EventBus.emit('episodic:store', {
        id: episode.id,
        sessionId,
        role: episode.role
      });

      return episode.id;
    };

    /**
     * Store multiple messages as a batch.
     */
    const storeBatch = async (messages, options = {}) => {
      const ids = [];
      const { sessionId = generateId('session') } = options;

      for (const msg of messages) {
        const id = await store(msg, { ...options, sessionId });
        if (id) ids.push(id);
      }

      return ids;
    };

    /**
     * Retrieve an episode by ID.
     */
    const get = async (episodeId) => {
      // Check in-memory cache first
      const cached = _episodes.find(e => e.id === episodeId);
      if (cached) {
        cached.accessCount++;
        return cached;
      }

      // Load from VFS
      const indexEntry = _index.byId[episodeId];
      if (!indexEntry) return null;

      try {
        const episodes = await loadSessionEpisodes(indexEntry.sessionId);
        const episode = episodes.find(e => e.id === episodeId);
        if (episode) {
          episode.accessCount = (episode.accessCount || 0) + 1;
          // Add to cache
          _episodes.push(episode);
        }
        return episode || null;
      } catch (err) {
        logger.warn('[EpisodicMemory] Failed to load episode:', err.message);
        return null;
      }
    };

    /**
     * Get all episodes for a session.
     */
    const getSession = async (sessionId) => {
      const episodeIds = _index.bySession[sessionId];
      if (!episodeIds || episodeIds.length === 0) return [];

      return loadSessionEpisodes(sessionId);
    };

    /**
     * Get recent episodes across all sessions.
     */
    const getRecent = async (count = 20) => {
      const recentIds = _index.byTimestamp.slice(0, count).map(e => e.id);
      const episodes = [];

      for (const id of recentIds) {
        const episode = await get(id);
        if (episode) episodes.push(episode);
      }

      return episodes;
    };

    // --- Semantic Search ---

    /**
     * Search episodes by semantic similarity.
     *
     * @param {string} query - Search query
     * @param {Object} [options] - Search options
     * @returns {Promise<Array>} Matching episodes with scores
     */
    const search = async (query, options = {}) => {
      const {
        topK = 10,
        minSimilarity = 0.3,
        sessionId = null,
        timeRangeMs = null,
        useRetention = true
      } = options;

      // Generate query embedding
      const queryEmbedding = await SemanticMemory.embed(query);

      // Get candidate episodes
      let candidates = [..._episodes];

      // If not enough in cache, load more
      if (candidates.length < topK * 2) {
        const recent = await getRecent(CONFIG.maxEpisodesInMemory);
        candidates = recent;
      }

      // Filter by session if specified
      if (sessionId) {
        candidates = candidates.filter(e => e.sessionId === sessionId);
      }

      // Filter by time range if specified
      if (timeRangeMs) {
        const cutoff = Date.now() - timeRangeMs;
        candidates = candidates.filter(e => e.timestamp >= cutoff);
      }

      // Score candidates
      const scored = candidates
        .filter(e => e.embedding)
        .map(episode => {
          const similarity = cosineSimilarity(queryEmbedding, episode.embedding);
          const retention = useRetention ? computeRetention(episode) : 1;
          const score = similarity * retention;

          return {
            episode,
            similarity,
            retention,
            score
          };
        })
        .filter(r => r.similarity >= minSimilarity)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      // Update access counts
      for (const result of scored) {
        result.episode.accessCount++;
      }

      EventBus.emit('episodic:search', {
        query: query.slice(0, 50),
        resultCount: scored.length
      });

      return scored.map(r => ({
        id: r.episode.id,
        role: r.episode.role,
        content: r.episode.content,
        sessionId: r.episode.sessionId,
        timestamp: r.episode.timestamp,
        similarity: r.similarity,
        retention: r.retention,
        score: r.score
      }));
    };

    /**
     * Search with temporal contiguity boost.
     * Boosts episodes that are temporally adjacent to other high-scoring results.
     */
    const searchWithContiguity = async (query, options = {}) => {
      const {
        topK = 10,
        contiguityWindowMs = 60000,
        contiguityBoost = 0.15
      } = options;

      // Get base results
      const baseResults = await search(query, { ...options, topK: topK * 2 });

      if (baseResults.length < 2) return baseResults;

      // Apply contiguity boost
      const timestamps = baseResults.map(r => r.timestamp);

      const boosted = baseResults.map((result, i) => {
        const myTime = result.timestamp;
        const hasNeighbor = timestamps.some((t, j) => {
          if (i === j) return false;
          return Math.abs(t - myTime) < contiguityWindowMs;
        });

        return {
          ...result,
          score: result.score + (hasNeighbor ? contiguityBoost : 0),
          hasContiguity: hasNeighbor
        };
      });

      return boosted
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    };

    // --- Retention & Forgetting ---

    /**
     * Compute retention score using Ebbinghaus forgetting curve.
     */
    const computeRetention = (episode) => {
      if (!episode?.timestamp) return 1;

      const age = Date.now() - episode.timestamp;
      const accessCount = episode.accessCount || 0;

      // Strength increases with access
      const strength = CONFIG.decayHalfLifeMs * (1 + accessCount * CONFIG.accessBoostFactor);

      // Exponential decay
      const retention = Math.exp(-age / strength);

      return Math.max(CONFIG.minRetentionScore, retention);
    };

    /**
     * Prune episodes below retention threshold.
     */
    const pruneByRetention = async () => {
      let pruned = 0;
      const toPrune = [];

      // Check in-memory episodes
      _episodes = _episodes.filter(episode => {
        const retention = computeRetention(episode);
        if (retention <= CONFIG.minRetentionScore) {
          toPrune.push(episode.id);
          pruned++;
          return false;
        }
        return true;
      });

      // Remove from index
      for (const id of toPrune) {
        const entry = _index.byId[id];
        if (entry) {
          delete _index.byId[id];

          if (_index.bySession[entry.sessionId]) {
            _index.bySession[entry.sessionId] = _index.bySession[entry.sessionId]
              .filter(eid => eid !== id);
          }

          _index.byTimestamp = _index.byTimestamp.filter(e => e.id !== id);
        }
      }

      if (pruned > 0) {
        _manifest.totalEpisodes -= pruned;
        await persistIndex();
        await persistManifest();

        logger.info('[EpisodicMemory] Pruned by retention:', { pruned });
        EventBus.emit('episodic:pruned', { pruned, reason: 'retention' });
      }

      return pruned;
    };

    // --- Helper Functions ---

    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;

      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }

      const mag = Math.sqrt(normA) * Math.sqrt(normB);
      return mag === 0 ? 0 : dot / mag;
    };

    const getEpisodeFilePath = (sessionId) => {
      return `${CONFIG.episodesPath}${sessionId}.jsonl`;
    };

    const loadSessionEpisodes = async (sessionId) => {
      const filePath = getEpisodeFilePath(sessionId);

      if (!await VFS.exists(filePath)) {
        return [];
      }

      try {
        const content = await VFS.read(filePath);
        return content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      } catch (err) {
        logger.warn('[EpisodicMemory] Failed to load session:', err.message);
        return [];
      }
    };

    const persistEpisode = async (episode, sessionId) => {
      const filePath = getEpisodeFilePath(sessionId);
      const line = JSON.stringify(episode) + '\n';

      try {
        if (await VFS.exists(filePath)) {
          const existing = await VFS.read(filePath);
          await VFS.write(filePath, existing + line);
        } else {
          await VFS.write(filePath, line);
        }
      } catch (err) {
        logger.warn('[EpisodicMemory] Failed to persist episode:', err.message);
      }
    };

    const persistIndex = async () => {
      try {
        await VFS.write(CONFIG.indexPath, JSON.stringify(_index, null, 2));
      } catch (err) {
        logger.warn('[EpisodicMemory] Failed to persist index:', err.message);
      }
    };

    const persistManifest = async () => {
      try {
        await VFS.write(CONFIG.manifestPath, JSON.stringify(_manifest, null, 2));
      } catch (err) {
        logger.warn('[EpisodicMemory] Failed to persist manifest:', err.message);
      }
    };

    // --- Integration with SemanticMemory ---

    /**
     * Enrich context with relevant episodic memories.
     */
    const enrichContext = async (query, context = []) => {
      try {
        const relevantEpisodes = await search(query, { topK: 5 });

        if (relevantEpisodes.length === 0) {
          return context;
        }

        const memoryContext = relevantEpisodes
          .map(e => `[${e.role}] ${e.content.slice(0, 300)}`)
          .join('\n');

        const enrichedContext = [...context];
        const insertIdx = enrichedContext.findIndex(m => m.role !== 'system');
        const idx = insertIdx === -1 ? enrichedContext.length : insertIdx;

        enrichedContext.splice(idx, 0, {
          role: 'system',
          content: `Relevant past conversations:\n${memoryContext}`
        });

        return enrichedContext;
      } catch (err) {
        logger.warn('[EpisodicMemory] Enrichment failed:', err.message);
        return context;
      }
    };

    // --- Stats & Maintenance ---

    const getStats = () => ({
      totalEpisodes: _manifest?.totalEpisodes || 0,
      sessionsCount: _manifest?.sessions?.length || 0,
      cachedEpisodes: _episodes.length,
      lastUpdated: _manifest?.lastUpdated,
      config: {
        maxInMemory: CONFIG.maxEpisodesInMemory,
        decayHalfLifeMs: CONFIG.decayHalfLifeMs,
        minRetentionScore: CONFIG.minRetentionScore
      }
    });

    const clear = async () => {
      _episodes = [];
      _index = { bySession: {}, byTimestamp: [], byId: {} };
      _manifest = { totalEpisodes: 0, sessions: [], lastUpdated: Date.now(), version: 1 };

      // Clear VFS
      try {
        const files = await VFS.list(CONFIG.episodesPath);
        for (const file of files) {
          await VFS.delete(file);
        }
      } catch (err) {
        logger.warn('[EpisodicMemory] Clear failed:', err.message);
      }

      EventBus.emit('episodic:cleared');
      logger.info('[EpisodicMemory] Cleared');
    };

    const configure = (newConfig) => {
      Object.assign(CONFIG, newConfig);
      logger.info('[EpisodicMemory] Configuration updated');
    };

    const getConfig = () => ({ ...CONFIG });

    return {
      init,
      // Core operations
      store,
      storeBatch,
      get,
      getSession,
      getRecent,
      // Search
      search,
      searchWithContiguity,
      // Retention
      computeRetention,
      pruneByRetention,
      // Integration
      enrichContext,
      // Stats & maintenance
      getStats,
      clear,
      configure,
      getConfig
    };
  }
};

export default EpisodicMemory;
