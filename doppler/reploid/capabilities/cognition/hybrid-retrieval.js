/**
 * @fileoverview Hybrid Retrieval
 * Unified retrieval interface combining semantic search, knowledge tree summaries,
 * episodic memory, temporal contiguity, and anticipatory context prediction.
 *
 * This module orchestrates the three memory tiers:
 * - Semantic Memory (embeddings + similarity search)
 * - Knowledge Tree (hierarchical summaries)
 * - Episodic Memory (full conversation history)
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 */

const HybridRetrieval = {
  metadata: {
    id: 'HybridRetrieval',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: [
      'Utils',
      'EventBus',
      'SemanticMemory',
      'KnowledgeTree',
      'EpisodicMemory',
      'EmbeddingStore'
    ],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const {
      Utils,
      EventBus,
      SemanticMemory,
      KnowledgeTree,
      EpisodicMemory,
      EmbeddingStore
    } = deps;
    const { logger, Errors } = Utils;

    // --- Configuration ---
    const CONFIG = {
      // Weights for hybrid scoring
      weights: {
        semantic: 0.35,      // Pure embedding similarity
        summary: 0.25,       // Knowledge tree summaries
        episodic: 0.25,      // Conversation history
        temporal: 0.15       // Temporal contiguity
      },
      // Retrieval limits
      maxResults: 20,
      defaultTopK: 10,
      minSimilarity: 0.25,
      // Temporal settings
      contiguityWindowMs: 120000,  // 2 minute window
      contiguityBoost: 0.1,
      recencyBoost: 0.05,          // Boost for recent items
      recencyWindowMs: 3600000,    // 1 hour recency window
      // Anticipatory settings
      taskPatterns: {
        debug: {
          keywords: ['error', 'bug', 'crash', 'fail', 'exception', 'fix', 'broken'],
          anticipate: ['error patterns', 'stack traces', 'previous fixes', 'debugging steps']
        },
        implement: {
          keywords: ['implement', 'create', 'build', 'add', 'new feature'],
          anticipate: ['design patterns', 'similar implementations', 'architecture notes']
        },
        refactor: {
          keywords: ['refactor', 'improve', 'clean', 'optimize', 'restructure'],
          anticipate: ['code patterns', 'best practices', 'previous refactors']
        },
        test: {
          keywords: ['test', 'spec', 'coverage', 'assert', 'mock'],
          anticipate: ['test patterns', 'fixtures', 'testing strategies']
        },
        understand: {
          keywords: ['what', 'how', 'why', 'explain', 'understand', 'where'],
          anticipate: ['documentation', 'explanations', 'context']
        }
      },
      // Retention threshold
      minRetention: 0.1
    };

    // --- State ---
    let _isInitialized = false;
    let _lastQueryTimestamp = 0;
    let _queryHistory = [];  // Track recent queries for context

    // --- Initialization ---

    const init = async () => {
      if (_isInitialized) return true;

      try {
        // Initialize dependent modules if they have init methods
        const initTasks = [];

        if (KnowledgeTree?.init) initTasks.push(KnowledgeTree.init());
        if (EpisodicMemory?.init) initTasks.push(EpisodicMemory.init());
        if (EmbeddingStore?.init) initTasks.push(EmbeddingStore.init());

        await Promise.all(initTasks);

        _isInitialized = true;
        logger.info('[HybridRetrieval] Initialized');

        return true;
      } catch (err) {
        logger.error('[HybridRetrieval] Init failed:', err.message);
        return false;
      }
    };

    // --- Core Hybrid Query ---

    /**
     * Perform hybrid retrieval across all memory systems.
     *
     * @param {string} query - Search query text
     * @param {Object} [options] - Query options
     * @returns {Promise<Object>} Combined retrieval results
     */
    const query = async (queryText, options = {}) => {
      const startTime = Date.now();
      const {
        topK = CONFIG.defaultTopK,
        weights = CONFIG.weights,
        useAnticipatory = true,
        useRetention = true,
        timeRangeMs = null,
        sessionId = null
      } = options;

      // Generate query embedding
      let queryEmbedding;
      try {
        queryEmbedding = await SemanticMemory.embed(queryText);
      } catch (err) {
        logger.warn('[HybridRetrieval] Embedding failed:', err.message);
        queryEmbedding = null;
      }

      // Gather results from all sources in parallel
      const [semanticResults, summaryResults, episodicResults] = await Promise.all([
        queryEmbedding ? searchSemantic(queryEmbedding, { topK: topK * 2 }) : [],
        searchKnowledgeTree(queryText, { topK: topK * 2 }),
        searchEpisodic(queryText, { topK: topK * 2, sessionId, timeRangeMs })
      ]);

      // Merge and score results
      const merged = mergeResults(
        semanticResults,
        summaryResults,
        episodicResults,
        { weights, useRetention }
      );

      // Apply temporal contiguity boost
      const withContiguity = applyContiguityBoost(merged);

      // Apply recency boost
      const withRecency = applyRecencyBoost(withContiguity);

      // Apply anticipatory boost if enabled
      let finalResults = withRecency;
      if (useAnticipatory) {
        finalResults = await applyAnticipatoryBoost(queryText, finalResults);
      }

      // Sort and limit
      finalResults = finalResults
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, topK);

      // Track query for context
      _lastQueryTimestamp = Date.now();
      _queryHistory.push({
        query: queryText,
        timestamp: _lastQueryTimestamp,
        resultCount: finalResults.length
      });
      // Keep history bounded
      if (_queryHistory.length > 50) _queryHistory.shift();

      const duration = Date.now() - startTime;

      EventBus.emit('hybrid:query', {
        query: queryText.slice(0, 50),
        resultCount: finalResults.length,
        sources: {
          semantic: semanticResults.length,
          summary: summaryResults.length,
          episodic: episodicResults.length
        },
        duration
      });

      return {
        results: finalResults,
        metadata: {
          query: queryText,
          topK,
          weights,
          duration,
          sources: {
            semantic: semanticResults.length,
            summary: summaryResults.length,
            episodic: episodicResults.length
          }
        }
      };
    };

    // --- Source-specific Search Functions ---

    const searchSemantic = async (queryEmbedding, options = {}) => {
      const { topK = 10 } = options;

      try {
        const results = await EmbeddingStore.searchWithRetention(
          queryEmbedding,
          { topK, minSimilarity: CONFIG.minSimilarity }
        );

        return results.map(r => ({
          id: r.memory?.id,
          content: r.memory?.content,
          source: 'semantic',
          score: r.score || r.similarity,
          similarity: r.similarity,
          retention: r.retention,
          timestamp: r.memory?.timestamp,
          metadata: r.memory?.metadata
        }));
      } catch (err) {
        logger.warn('[HybridRetrieval] Semantic search failed:', err.message);
        return [];
      }
    };

    const searchKnowledgeTree = async (queryText, options = {}) => {
      const { topK = 10 } = options;

      if (!KnowledgeTree?.hybridQuery) {
        return [];
      }

      try {
        const results = await KnowledgeTree.hybridQuery(queryText, { topK });

        return results.map(r => ({
          id: r.id,
          content: r.content,
          source: 'summary',
          score: r.score,
          level: r.level,
          semanticScore: r.semanticScore,
          retention: r.retention,
          timestamp: r.timestamp,
          metadata: r.metadata
        }));
      } catch (err) {
        logger.warn('[HybridRetrieval] Knowledge tree search failed:', err.message);
        return [];
      }
    };

    const searchEpisodic = async (queryText, options = {}) => {
      const { topK = 10, sessionId = null, timeRangeMs = null } = options;

      if (!EpisodicMemory?.search) {
        return [];
      }

      try {
        const results = await EpisodicMemory.searchWithContiguity(queryText, {
          topK,
          sessionId,
          timeRangeMs,
          contiguityWindowMs: CONFIG.contiguityWindowMs
        });

        return results.map(r => ({
          id: r.id,
          content: r.content,
          source: 'episodic',
          score: r.score,
          similarity: r.similarity,
          retention: r.retention,
          timestamp: r.timestamp,
          sessionId: r.sessionId,
          role: r.role,
          hasContiguity: r.hasContiguity
        }));
      } catch (err) {
        logger.warn('[HybridRetrieval] Episodic search failed:', err.message);
        return [];
      }
    };

    // --- Merging & Scoring ---

    const mergeResults = (semantic, summary, episodic, options = {}) => {
      const { weights, useRetention = true } = options;
      const resultMap = new Map();

      // Process semantic results
      for (const r of semantic) {
        const key = r.id || r.content?.slice(0, 100);
        resultMap.set(key, {
          ...r,
          semanticScore: r.score * weights.semantic,
          summaryScore: 0,
          episodicScore: 0,
          temporalScore: 0,
          combinedScore: r.score * weights.semantic
        });
      }

      // Process summary results
      for (const r of summary) {
        const key = r.id || r.content?.slice(0, 100);
        const existing = resultMap.get(key);

        if (existing) {
          existing.summaryScore = r.score * weights.summary;
          existing.combinedScore += r.score * weights.summary;
          existing.level = r.level;
        } else {
          resultMap.set(key, {
            ...r,
            semanticScore: 0,
            summaryScore: r.score * weights.summary,
            episodicScore: 0,
            temporalScore: 0,
            combinedScore: r.score * weights.summary
          });
        }
      }

      // Process episodic results
      for (const r of episodic) {
        const key = r.id || r.content?.slice(0, 100);
        const existing = resultMap.get(key);

        if (existing) {
          existing.episodicScore = r.score * weights.episodic;
          existing.combinedScore += r.score * weights.episodic;
          existing.role = r.role;
          existing.sessionId = r.sessionId;
          existing.hasContiguity = r.hasContiguity;
        } else {
          resultMap.set(key, {
            ...r,
            semanticScore: 0,
            summaryScore: 0,
            episodicScore: r.score * weights.episodic,
            temporalScore: 0,
            combinedScore: r.score * weights.episodic
          });
        }
      }

      // Apply retention weighting if enabled
      const results = Array.from(resultMap.values());
      if (useRetention) {
        for (const r of results) {
          const retention = r.retention || 1;
          if (retention < 1) {
            r.combinedScore *= retention;
          }
        }
      }

      return results;
    };

    const applyContiguityBoost = (results) => {
      if (results.length < 2) return results;

      const timestamps = results.map(r => r.timestamp).filter(Boolean);
      if (timestamps.length < 2) return results;

      return results.map(result => {
        if (!result.timestamp) return result;

        const hasNeighbor = timestamps.some(t => {
          if (t === result.timestamp) return false;
          return Math.abs(t - result.timestamp) < CONFIG.contiguityWindowMs;
        });

        if (hasNeighbor) {
          return {
            ...result,
            temporalScore: CONFIG.contiguityBoost,
            combinedScore: result.combinedScore + CONFIG.contiguityBoost,
            hasContiguity: true
          };
        }

        return result;
      });
    };

    const applyRecencyBoost = (results) => {
      const now = Date.now();

      return results.map(result => {
        if (!result.timestamp) return result;

        const age = now - result.timestamp;
        if (age < CONFIG.recencyWindowMs) {
          const recencyFactor = 1 - (age / CONFIG.recencyWindowMs);
          const boost = CONFIG.recencyBoost * recencyFactor;

          return {
            ...result,
            recencyBoost: boost,
            combinedScore: result.combinedScore + boost
          };
        }

        return result;
      });
    };

    // --- Anticipatory Retrieval ---

    const detectTaskType = (queryText) => {
      const queryLower = queryText.toLowerCase();

      for (const [taskType, config] of Object.entries(CONFIG.taskPatterns)) {
        const matchCount = config.keywords.filter(kw => queryLower.includes(kw)).length;
        if (matchCount > 0) {
          return {
            type: taskType,
            confidence: Math.min(1, matchCount / config.keywords.length),
            anticipate: config.anticipate
          };
        }
      }

      return { type: 'general', confidence: 0, anticipate: [] };
    };

    const applyAnticipatoryBoost = async (queryText, results) => {
      const taskInfo = detectTaskType(queryText);

      if (taskInfo.type === 'general' || taskInfo.confidence === 0) {
        return results;
      }

      // Gather anticipated context
      const anticipatedIds = new Set();
      for (const anticipationType of taskInfo.anticipate.slice(0, 2)) {
        try {
          // Search for anticipated content
          const anticipated = await searchEpisodic(anticipationType, { topK: 3 });
          for (const r of anticipated) {
            anticipatedIds.add(r.id);
          }
        } catch (err) {
          logger.debug('[HybridRetrieval] Anticipatory search failed:', err.message);
        }
      }

      // Boost anticipated results
      const boostFactor = 0.15 * taskInfo.confidence;

      return results.map(result => {
        if (anticipatedIds.has(result.id)) {
          return {
            ...result,
            anticipatoryBoost: boostFactor,
            combinedScore: result.combinedScore * (1 + boostFactor),
            anticipated: true,
            taskType: taskInfo.type
          };
        }
        return result;
      });
    };

    // --- Convenience Methods ---

    /**
     * Get context-enriched messages for LLM input.
     */
    const enrichContext = async (queryText, context = [], options = {}) => {
      const { maxTokens = 4000, topK = 5 } = options;

      const { results } = await query(queryText, { topK });

      if (results.length === 0) {
        return context;
      }

      // Estimate tokens (rough: 4 chars per token)
      let tokenCount = 0;
      const contextPieces = [];

      for (const result of results) {
        const tokens = Math.ceil(result.content.length / 4);
        if (tokenCount + tokens > maxTokens) break;

        contextPieces.push({
          source: result.source,
          level: result.level,
          content: result.content.slice(0, 500)
        });
        tokenCount += tokens;
      }

      if (contextPieces.length === 0) {
        return context;
      }

      // Build context message
      const memoryContent = contextPieces
        .map(p => `[${p.source}${p.level ? ` L${p.level}` : ''}] ${p.content}`)
        .join('\n\n');

      const enrichedContext = [...context];
      const insertIdx = enrichedContext.findIndex(m => m.role !== 'system');
      const idx = insertIdx === -1 ? enrichedContext.length : insertIdx;

      enrichedContext.splice(idx, 0, {
        role: 'system',
        content: `Relevant context from memory:\n${memoryContent}`
      });

      return enrichedContext;
    };

    /**
     * Quick semantic-only search (faster).
     */
    const quickSearch = async (queryText, options = {}) => {
      const { topK = 5 } = options;

      const queryEmbedding = await SemanticMemory.embed(queryText);
      const results = await searchSemantic(queryEmbedding, { topK });

      return results;
    };

    /**
     * Get recent activity across all memory systems.
     */
    const getRecentActivity = async (count = 10) => {
      const results = [];

      // Get recent from episodic
      if (EpisodicMemory?.getRecent) {
        const episodic = await EpisodicMemory.getRecent(count);
        results.push(...episodic.map(e => ({
          ...e,
          source: 'episodic'
        })));
      }

      // Get recent from embedding store
      if (EmbeddingStore?.getRecentMemories) {
        const semantic = await EmbeddingStore.getRecentMemories(count);
        results.push(...semantic.map(m => ({
          id: m.id,
          content: m.content,
          timestamp: m.timestamp,
          source: 'semantic'
        })));
      }

      // Sort by timestamp and limit
      return results
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, count);
    };

    // --- Configuration ---

    const configure = (newConfig) => {
      // Handle nested objects specially
      if (newConfig.weights) {
        Object.assign(CONFIG.weights, newConfig.weights);
      }
      if (newConfig.taskPatterns) {
        Object.assign(CONFIG.taskPatterns, newConfig.taskPatterns);
      }

      // Apply other config values, excluding nested objects
      const { weights, taskPatterns, ...otherConfig } = newConfig;
      Object.assign(CONFIG, otherConfig);

      logger.info('[HybridRetrieval] Configuration updated');
    };

    const getConfig = () => ({
      ...CONFIG,
      weights: { ...CONFIG.weights },
      taskPatterns: { ...CONFIG.taskPatterns }
    });

    const getStats = () => ({
      initialized: _isInitialized,
      queryHistory: _queryHistory.length,
      lastQueryTimestamp: _lastQueryTimestamp,
      config: {
        weights: { ...CONFIG.weights },
        minSimilarity: CONFIG.minSimilarity,
        contiguityWindowMs: CONFIG.contiguityWindowMs
      }
    });

    return {
      init,
      // Core query
      query,
      // Convenience methods
      enrichContext,
      quickSearch,
      getRecentActivity,
      // Task detection
      detectTaskType,
      // Configuration
      configure,
      getConfig,
      getStats
    };
  }
};

export default HybridRetrieval;
