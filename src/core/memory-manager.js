/**
 * @fileoverview Memory Manager
 * Three-tier memory system: Working/Episodic/Semantic.
 * Implements MemGPT-style eviction with recursive summarization.
 *
 * @see Blueprint 0x000068: Hierarchical Memory Architecture
 */

const MemoryManager = {
  metadata: {
    id: 'MemoryManager',
    version: '1.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'VFS', 'LLMClient', 'EmbeddingStore', 'SemanticMemory', 'EventBus'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, LLMClient, EmbeddingStore, SemanticMemory, EventBus } = deps;
    const { logger, generateId, Errors } = Utils;

    // --- Configuration ---
    const CONFIG = {
      workingMemoryLimit: 8000,  // tokens
      evictionRatio: 0.25,      // evict 25% when over limit
      summaryTemperature: 0,    // deterministic summaries
      episodicPath: '/memory/episodes/',
      knowledgePath: '/memory/knowledge/',
      summaryPath: '/memory/episodes/summary.md',
      fullHistoryPath: '/memory/episodes/full.jsonl',
      maxRetrievalTokens: 4000,
      contiguityBoostMs: 60000, // 1 minute window for temporal boost
      contiguityBoost: 0.15
    };

    // --- State ---
    let _workingMemory = [];
    let _episodicSummary = '';
    let _sessionId = null;
    let _isInitialized = false;
    let _tokenEstimator = null;

    // --- Initialization ---

    const init = async () => {
      if (_isInitialized) return true;

      _sessionId = generateId('session');

      // Ensure VFS paths exist
      await ensureVfsPaths();

      // Load existing summary if available
      try {
        if (await VFS.exists(CONFIG.summaryPath)) {
          _episodicSummary = await VFS.read(CONFIG.summaryPath);
          logger.info('[MemoryManager] Loaded existing episodic summary');
        }
      } catch (err) {
        logger.warn('[MemoryManager] Could not load summary:', err.message);
      }

      _isInitialized = true;
      logger.info('[MemoryManager] Initialized', { sessionId: _sessionId });

      EventBus.emit('memory:initialized', { sessionId: _sessionId });
      return true;
    };

    const ensureVfsPaths = async () => {
      const paths = [CONFIG.episodicPath, CONFIG.knowledgePath];
      for (const path of paths) {
        if (!await VFS.exists(path)) {
          await VFS.mkdir(path);
        }
      }
    };

    // --- Token Estimation ---

    const estimateTokens = (content) => {
      if (!content) return 0;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      // Rough estimate: ~4 chars per token for English
      return Math.ceil(text.length / 4);
    };

    const estimateMessagesTokens = (messages) => {
      return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
    };

    // --- Working Memory Operations ---

    const add = async (message) => {
      if (!message || !message.role) {
        throw new Errors.ValidationError('Message must have role and content');
      }

      const entry = {
        id: generateId('msg'),
        role: message.role,
        content: message.content || '',
        timestamp: Date.now(),
        sessionId: _sessionId,
        metadata: message.metadata || {}
      };

      _workingMemory.push(entry);

      EventBus.emit('memory:working:add', {
        id: entry.id,
        role: entry.role,
        tokens: estimateTokens(entry.content)
      });

      // Check if eviction needed
      const currentTokens = estimateMessagesTokens(_workingMemory);
      if (currentTokens > CONFIG.workingMemoryLimit) {
        const toEvict = Math.ceil(_workingMemory.length * CONFIG.evictionRatio);
        await evictOldest(toEvict);
      }

      return entry.id;
    };

    const addBatch = async (messages) => {
      const ids = [];
      for (const msg of messages) {
        const id = await add(msg);
        ids.push(id);
      }
      return ids;
    };

    // --- Eviction with Recursive Summarization ---

    const evictOldest = async (count) => {
      if (count <= 0 || _workingMemory.length === 0) return [];

      const toEvict = Math.min(count, _workingMemory.length);
      const evicted = _workingMemory.splice(0, toEvict);

      logger.info(`[MemoryManager] Evicting ${evicted.length} messages`);

      EventBus.emit('memory:eviction:start', {
        count: evicted.length,
        workingRemaining: _workingMemory.length
      });

      try {
        // 1. Generate updated summary via recursive summarization
        _episodicSummary = await updateSummary(evicted);

        // 2. Persist full messages to VFS
        await persistEpisodicMessages(evicted);

        // 3. Index for semantic search
        await indexForRetrieval(evicted);

        EventBus.emit('memory:eviction:complete', {
          evictedCount: evicted.length,
          summaryLength: _episodicSummary.length
        });

      } catch (err) {
        logger.error('[MemoryManager] Eviction failed:', err.message);
        // Restore evicted messages on failure
        _workingMemory = [...evicted, ..._workingMemory];
        throw err;
      }

      return evicted;
    };

    /**
     * Estimate token count for text (rough approximation: ~4 chars per token)
     * @param {string} text - Text to estimate
     * @returns {number} Estimated token count
     */
    const estimateSummaryTokens = (text) => {
      if (!text) return 0;
      return Math.ceil(text.length / 4);
    };

    /**
     * Validate that summary achieves sufficient compression.
     * @param {string} original - Original text being summarized
     * @param {string} summary - Generated summary
     * @param {number} minCompression - Minimum compression ratio (default 0.5 = 50% reduction)
     * @returns {Object} Validation result
     */
    const validateSummary = (original, summary, minCompression = 0.5) => {
      const originalTokens = estimateSummaryTokens(original);
      const summaryTokens = estimateSummaryTokens(summary);

      if (originalTokens === 0) {
        return { valid: true, ratio: 1, reason: 'empty_original' };
      }

      const ratio = summaryTokens / originalTokens;
      const valid = ratio <= (1 - minCompression);

      return {
        valid,
        ratio,
        originalTokens,
        summaryTokens,
        reason: valid ? 'compression_ok' : 'insufficient_compression'
      };
    };

    const updateSummary = async (evictedMessages) => {
      const formattedMessages = evictedMessages
        .map(m => `[${m.role}] ${m.content}`)
        .join('\n\n');

      const prompt = _episodicSummary
        ? `You are updating a conversation summary. Be concise but preserve key facts, decisions, and context.

Previous summary:
${_episodicSummary}

New messages to incorporate:
${formattedMessages}

Updated summary (preserve all important context from both the previous summary and new messages):`
        : `Summarize this conversation concisely, preserving key facts, decisions, and context:

${formattedMessages}

Summary:`;

      try {
        const response = await LLMClient.chat(
          [{ role: 'user', content: prompt }],
          {
            temperature: CONFIG.summaryTemperature,
            max_tokens: 1000
          }
        );

        const newSummary = response.content || response;

        // Validate compression
        const inputText = _episodicSummary + '\n' + formattedMessages;
        const validation = validateSummary(inputText, newSummary);

        if (!validation.valid) {
          logger.warn('[MemoryManager] Summary compression insufficient', {
            ratio: validation.ratio.toFixed(2),
            originalTokens: validation.originalTokens,
            summaryTokens: validation.summaryTokens
          });
          // Still use the summary but log warning
          EventBus.emit('memory:summary_validation', {
            valid: false,
            ratio: validation.ratio,
            reason: validation.reason
          });
        }

        // Persist to VFS
        await VFS.write(CONFIG.summaryPath, newSummary);

        // Track summary history for drift detection (keep last 5)
        const historyPath = '/.memory/summary_history.jsonl';
        const historyEntry = JSON.stringify({
          timestamp: Date.now(),
          tokens: validation.summaryTokens,
          ratio: validation.ratio,
          sessionId: _sessionId
        }) + '\n';

        try {
          if (await VFS.exists(historyPath)) {
            const existing = await VFS.read(historyPath);
            const lines = existing.trim().split('\n').slice(-4); // Keep last 4
            await VFS.write(historyPath, lines.join('\n') + '\n' + historyEntry);
          } else {
            await VFS.write(historyPath, historyEntry);
          }
        } catch (histErr) {
          logger.debug('[MemoryManager] Summary history tracking failed:', histErr.message);
        }

        logger.info('[MemoryManager] Summary updated', {
          prevLength: _episodicSummary.length,
          newLength: newSummary.length,
          compressionRatio: validation.ratio.toFixed(2)
        });

        return newSummary;

      } catch (err) {
        logger.error('[MemoryManager] Summary generation failed:', err.message);
        // Return existing summary on failure
        return _episodicSummary;
      }
    };

    /**
     * Check for summary drift by comparing current summary against recent history.
     * Detects if summaries are growing without bounds or losing compression.
     * @returns {Promise<Object>} Drift detection result
     */
    const checkSummaryDrift = async () => {
      const historyPath = '/.memory/summary_history.jsonl';

      try {
        if (!await VFS.exists(historyPath)) {
          return { hasDrift: false, reason: 'no_history' };
        }

        const content = await VFS.read(historyPath);
        const entries = content.trim().split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        if (entries.length < 3) {
          return { hasDrift: false, reason: 'insufficient_history' };
        }

        // Check if token count is consistently increasing (drift)
        const tokenTrend = entries.slice(-3).map(e => e.tokens);
        const isIncreasing = tokenTrend.every((t, i, arr) =>
          i === 0 || t >= arr[i - 1] * 0.9 // Allow 10% variance
        );

        // Check if compression ratio is degrading
        const ratioTrend = entries.slice(-3).map(e => e.ratio);
        const avgRatio = ratioTrend.reduce((a, b) => a + b, 0) / ratioTrend.length;
        const isDegrading = avgRatio > 0.7; // Summaries should be <70% of input

        const hasDrift = isIncreasing && entries[entries.length - 1].tokens > 2000;

        return {
          hasDrift,
          isDegrading,
          currentTokens: entries[entries.length - 1]?.tokens || 0,
          avgRatio: avgRatio.toFixed(2),
          reason: hasDrift ? 'summary_growing' : isDegrading ? 'poor_compression' : 'ok',
          history: entries.slice(-3)
        };
      } catch (err) {
        logger.debug('[MemoryManager] Drift detection failed:', err.message);
        return { hasDrift: false, reason: 'error', error: err.message };
      }
    };

    const persistEpisodicMessages = async (messages) => {
      const jsonLines = messages
        .map(m => JSON.stringify({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          sessionId: m.sessionId
        }))
        .join('\n') + '\n';

      // Append to full history
      if (await VFS.exists(CONFIG.fullHistoryPath)) {
        const existing = await VFS.read(CONFIG.fullHistoryPath);
        await VFS.write(CONFIG.fullHistoryPath, existing + jsonLines);
      } else {
        await VFS.write(CONFIG.fullHistoryPath, jsonLines);
      }
    };

    const indexForRetrieval = async (messages) => {
      for (const msg of messages) {
        if (msg.content && msg.content.length > 50) {
          try {
            await EmbeddingStore.addMemory({
              content: msg.content,
              domain: 'episodic',
              source: msg.role,
              metadata: {
                timestamp: msg.timestamp,
                sessionId: msg.sessionId,
                messageId: msg.id
              }
            });
          } catch (err) {
            logger.warn('[MemoryManager] Failed to index message:', err.message);
          }
        }
      }
    };

    // --- Retrieval ---

    const retrieve = async (query, options = {}) => {
      const {
        maxTokens = CONFIG.maxRetrievalTokens,
        includeSummary = true,
        includeEpisodic = true,
        topK = 10
      } = options;

      const context = [];
      let tokenCount = 0;

      // 1. Always include current summary (high-level context)
      if (includeSummary && _episodicSummary) {
        const summaryTokens = estimateTokens(_episodicSummary);
        if (tokenCount + summaryTokens <= maxTokens) {
          context.push({
            type: 'summary',
            content: _episodicSummary,
            tokens: summaryTokens
          });
          tokenCount += summaryTokens;
        }
      }

      // 2. Semantic search for relevant episodic memories
      if (includeEpisodic && query) {
        try {
          const queryEmbedding = await SemanticMemory.embed(query);
          const results = await EmbeddingStore.searchSimilar(queryEmbedding, topK * 2, 0.3);

          // Apply temporal contiguity boost
          const boosted = applyTemporalBoost(results);

          // Add until token budget exhausted
          for (const result of boosted) {
            const tokens = estimateTokens(result.memory.content);
            if (tokenCount + tokens > maxTokens) break;

            context.push({
              type: 'episodic',
              content: result.memory.content,
              score: result.similarity,
              timestamp: result.memory.timestamp,
              tokens
            });
            tokenCount += tokens;
          }
        } catch (err) {
          logger.warn('[MemoryManager] Semantic search failed:', err.message);
        }
      }

      EventBus.emit('memory:retrieve', {
        query: query?.slice(0, 50),
        contextItems: context.length,
        totalTokens: tokenCount
      });

      return context;
    };

    const applyTemporalBoost = (results) => {
      if (results.length < 2) return results;

      const timestamps = results.map(r => r.memory.metadata?.timestamp || r.memory.timestamp);

      return results.map((result, i) => {
        const myTime = timestamps[i];
        if (!myTime) return result;

        // Check if adjacent items are temporally close
        const hasAdjacent = timestamps.some((t, j) => {
          if (i === j || !t) return false;
          return Math.abs(t - myTime) < CONFIG.contiguityBoostMs;
        });

        return {
          ...result,
          similarity: result.similarity + (hasAdjacent ? CONFIG.contiguityBoost : 0)
        };
      }).sort((a, b) => b.similarity - a.similarity);
    };

    // --- Context Building ---

    const getContext = async (query) => {
      const retrieved = await retrieve(query);

      return {
        working: [..._workingMemory],
        retrieved,
        summary: _episodicSummary,
        sessionId: _sessionId,
        stats: {
          workingCount: _workingMemory.length,
          workingTokens: estimateMessagesTokens(_workingMemory),
          retrievedCount: retrieved.length,
          hasSummary: !!_episodicSummary
        }
      };
    };

    const buildContextMessages = async (query, options = {}) => {
      const { maxTokens = 6000 } = options;
      const context = await getContext(query);
      const messages = [];
      let tokenCount = 0;

      // 1. Add summary as system context
      if (context.summary) {
        const summaryMsg = {
          role: 'system',
          content: `[Conversation Context]\n${context.summary}`
        };
        const tokens = estimateTokens(summaryMsg.content);
        if (tokenCount + tokens <= maxTokens) {
          messages.push(summaryMsg);
          tokenCount += tokens;
        }
      }

      // 2. Add retrieved episodic memories
      const episodic = context.retrieved.filter(r => r.type === 'episodic');
      if (episodic.length > 0) {
        const memoryContent = episodic
          .map(r => `[Memory] ${r.content.slice(0, 500)}`)
          .join('\n');
        const memoryMsg = {
          role: 'system',
          content: `[Relevant Memories]\n${memoryContent}`
        };
        const tokens = estimateTokens(memoryMsg.content);
        if (tokenCount + tokens <= maxTokens) {
          messages.push(memoryMsg);
          tokenCount += tokens;
        }
      }

      // 3. Add working memory (recent messages)
      for (const msg of context.working) {
        const tokens = estimateTokens(msg.content) + 4;
        if (tokenCount + tokens > maxTokens) break;
        messages.push({ role: msg.role, content: msg.content });
        tokenCount += tokens;
      }

      return messages;
    };

    // --- Anticipatory Retrieval ---

    // Task patterns that predict future information needs
    const TASK_PATTERNS = {
      coding: {
        keywords: ['implement', 'code', 'function', 'class', 'bug', 'fix', 'refactor'],
        anticipate: ['error patterns', 'similar implementations', 'related files']
      },
      debugging: {
        keywords: ['error', 'fail', 'broken', 'crash', 'exception', 'debug'],
        anticipate: ['past errors', 'stack traces', 'fixes applied']
      },
      planning: {
        keywords: ['plan', 'design', 'architect', 'structure', 'organize'],
        anticipate: ['previous decisions', 'constraints discussed', 'requirements']
      },
      research: {
        keywords: ['find', 'search', 'look for', 'where is', 'how does'],
        anticipate: ['previous searches', 'discovered locations', 'file patterns']
      }
    };

    const detectTaskType = (query) => {
      const lowerQuery = query.toLowerCase();
      for (const [taskType, pattern] of Object.entries(TASK_PATTERNS)) {
        if (pattern.keywords.some(kw => lowerQuery.includes(kw))) {
          return { type: taskType, anticipate: pattern.anticipate };
        }
      }
      return null;
    };

    const anticipatoryRetrieve = async (query, options = {}) => {
      const { topK = 5, includeAnticipated = true } = options;
      const results = [];

      // 1. Standard retrieval
      const standard = await retrieve(query, { ...options, topK });
      results.push(...standard);

      // 2. Anticipatory retrieval based on task type
      if (includeAnticipated) {
        const taskInfo = detectTaskType(query);
        if (taskInfo) {
          for (const anticipationType of taskInfo.anticipate) {
            try {
              const anticipated = await retrieve(anticipationType, { topK: 2, includeSummary: false });
              for (const item of anticipated) {
                // Mark as anticipated and add if not duplicate
                if (!results.some(r => r.content === item.content)) {
                  results.push({
                    ...item,
                    type: 'anticipated',
                    anticipationReason: anticipationType
                  });
                }
              }
            } catch (err) {
              logger.debug('[MemoryManager] Anticipatory retrieval failed:', err.message);
            }
          }

          EventBus.emit('memory:anticipatory', {
            taskType: taskInfo.type,
            anticipatedCount: results.filter(r => r.type === 'anticipated').length
          });
        }
      }

      return results;
    };

    // --- Adaptive Forgetting ---

    // Forgetting curve parameters (Ebbinghaus-inspired)
    const FORGETTING_CONFIG = {
      baseHalfLife: 24 * 60 * 60 * 1000,  // 1 day base half-life
      accessBoost: 1.5,                    // Each access multiplies half-life
      importanceWeights: {
        goal: 5.0,        // Goals are very important
        decision: 3.0,    // Decisions are important
        error: 2.5,       // Errors should be remembered
        tool_result: 1.0, // Tool results are standard
        assistant: 1.2,   // Assistant responses slightly important
        user: 1.5         // User messages more important
      },
      minRetention: 0.1,  // Minimum retention probability to keep
      maxMemories: 5000   // Hard cap on total memories
    };

    const calculateRetention = (memory, now) => {
      const age = now - (memory.timestamp || now);
      const accessCount = memory.accessCount || 0;
      const importance = FORGETTING_CONFIG.importanceWeights[memory.source] ||
                        FORGETTING_CONFIG.importanceWeights[memory.metadata?.type] || 1.0;

      // Adjusted half-life based on access and importance
      const halfLife = FORGETTING_CONFIG.baseHalfLife *
                      Math.pow(FORGETTING_CONFIG.accessBoost, accessCount) *
                      importance;

      // Exponential decay: R = e^(-t/halfLife)
      const retention = Math.exp(-age / halfLife);

      return {
        retention,
        age,
        accessCount,
        importance,
        halfLife
      };
    };

    const adaptivePrune = async (options = {}) => {
      const { dryRun = false, verbose = false } = options;
      const now = Date.now();
      const memories = await EmbeddingStore.getAllMemories();

      if (memories.length <= FORGETTING_CONFIG.maxMemories * 0.8) {
        // Not near capacity, skip pruning
        return { pruned: 0, evaluated: memories.length };
      }

      // Calculate retention for all memories
      const evaluated = memories.map(m => ({
        memory: m,
        ...calculateRetention(m, now)
      }));

      // Sort by retention (lowest first)
      evaluated.sort((a, b) => a.retention - b.retention);

      // Prune memories below threshold or to reach target
      const targetCount = Math.floor(FORGETTING_CONFIG.maxMemories * 0.7);
      const toRemove = Math.max(
        0,
        evaluated.filter(e => e.retention < FORGETTING_CONFIG.minRetention).length,
        memories.length - targetCount
      );

      const toPrune = evaluated.slice(0, toRemove);
      let pruned = 0;

      if (!dryRun) {
        for (const item of toPrune) {
          try {
            await EmbeddingStore.deleteMemory(item.memory.id);
            pruned++;
          } catch (err) {
            logger.warn('[MemoryManager] Failed to prune memory:', err.message);
          }
        }
      }

      const result = {
        pruned: dryRun ? 0 : pruned,
        wouldPrune: toPrune.length,
        evaluated: memories.length,
        avgRetention: evaluated.reduce((s, e) => s + e.retention, 0) / evaluated.length,
        lowestRetention: evaluated[0]?.retention || 1
      };

      if (verbose) {
        logger.info('[MemoryManager] Adaptive prune:', result);
      }

      EventBus.emit('memory:prune:adaptive', result);

      return result;
    };

    // --- Accessors ---

    const getWorking = () => [..._workingMemory];

    const getSummary = () => _episodicSummary;

    const getSessionId = () => _sessionId;

    const getStats = async () => {
      const embeddingStats = await EmbeddingStore.getStats();

      return {
        sessionId: _sessionId,
        workingMemory: {
          count: _workingMemory.length,
          tokens: estimateMessagesTokens(_workingMemory),
          limit: CONFIG.workingMemoryLimit
        },
        episodic: {
          summaryLength: _episodicSummary.length,
          indexedMemories: embeddingStats.memoryCount
        },
        config: { ...CONFIG }
      };
    };

    // --- Maintenance ---

    const clearWorking = () => {
      const cleared = _workingMemory.length;
      _workingMemory = [];
      EventBus.emit('memory:working:cleared', { count: cleared });
      return cleared;
    };

    const clearSummary = async () => {
      _episodicSummary = '';
      if (await VFS.exists(CONFIG.summaryPath)) {
        await VFS.delete(CONFIG.summaryPath);
      }
      EventBus.emit('memory:summary:cleared');
    };

    const newSession = async () => {
      // Evict all working memory before starting new session
      if (_workingMemory.length > 0) {
        await evictOldest(_workingMemory.length);
      }

      _sessionId = generateId('session');
      _workingMemory = [];

      EventBus.emit('memory:session:new', { sessionId: _sessionId });

      logger.info('[MemoryManager] New session started', { sessionId: _sessionId });
      return _sessionId;
    };

    const dispose = async () => {
      // Persist any remaining working memory
      if (_workingMemory.length > 0) {
        try {
          await evictOldest(_workingMemory.length);
        } catch (err) {
          logger.warn('[MemoryManager] Failed to persist on dispose:', err.message);
        }
      }

      _workingMemory = [];
      _episodicSummary = '';
      _sessionId = null;
      _isInitialized = false;

      logger.info('[MemoryManager] Disposed');
    };

    /**
     * Called when context is compacted by ContextManager.
     * Refreshes memory index and optionally updates summary.
     * @param {Object} info - Compaction info
     * @param {number} info.previousTokens - Token count before compaction
     * @param {number} info.newTokens - Token count after compaction
     * @param {Array} info.compactedContext - The compacted context
     * @returns {Promise<void>}
     */
    const onContextCompacted = async (info) => {
      if (!_isInitialized) return;

      const { previousTokens, newTokens, compactedContext } = info;
      logger.debug(`[MemoryManager] Context compacted: ${previousTokens} -> ${newTokens} tokens`);

      try {
        // Extract any summaries from compacted context for memory indexing
        const summaryMsgs = compactedContext.filter(m =>
          m.role === 'user' && m.content?.includes('[messages compacted]')
        );

        if (summaryMsgs.length > 0) {
          // Re-index the compaction summary into episodic memory
          for (const msg of summaryMsgs) {
            await add({
              role: 'system',
              content: `[Compaction Summary] ${msg.content.slice(0, 500)}`,
              timestamp: Date.now()
            });
          }
          logger.debug(`[MemoryManager] Indexed ${summaryMsgs.length} compaction summaries`);
        }

        // Emit event for observability
        EventBus.emit('memory:context_compacted', {
          previousTokens,
          newTokens,
          compressionRatio: newTokens / previousTokens,
          summariesIndexed: summaryMsgs.length
        });
      } catch (err) {
        logger.warn('[MemoryManager] Failed to process context compaction:', err.message);
      }
    };

    return {
      init,
      add,
      addBatch,
      evictOldest,
      retrieve,
      anticipatoryRetrieve,
      adaptivePrune,
      calculateRetention,
      checkSummaryDrift,
      getContext,
      buildContextMessages,
      getWorking,
      getSummary,
      getSessionId,
      getStats,
      clearWorking,
      clearSummary,
      newSession,
      dispose,
      onContextCompacted
    };
  }
};

export default MemoryManager;
