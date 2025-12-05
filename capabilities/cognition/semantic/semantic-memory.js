/**
 * @fileoverview Semantic Memory
 * Evolving word embeddings that learn from conversations.
 * Uses Transformers.js for browser-native embedding generation.
 */

const SemanticMemory = {
  metadata: {
    id: 'SemanticMemory',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus', 'EmbeddingStore'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, EmbeddingStore } = deps;
    const { logger, generateId, Errors } = Utils;

    // State
    let _extractor = null;
    let _loaderPromise = null;
    let _isInitialized = false;

    // Configuration
    const CONFIG = {
      model: 'Xenova/all-MiniLM-L6-v2', // 384-dim, fast
      minSimilarity: 0.5,
      topK: 5,
      batchSize: 10,
      idleTrainingDelay: 2000
    };

    // Training queue for idle-time processing
    let _trainingQueue = [];
    let _idleCallbackId = null;

    // --- Transformers.js Setup ---

    const ensureTransformersReady = async () => {
      if (typeof window === 'undefined') {
        throw new Errors.ConfigError('SemanticMemory requires browser environment');
      }

      if (window.transformers?.pipeline) return window.transformers;
      if (_loaderPromise) return _loaderPromise;

      _loaderPromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3')
        .then(mod => {
          window.transformers = {
            pipeline: mod.pipeline,
            env: mod.env
          };
          mod.env.backends.onnx.wasm.proxy = false;
          return window.transformers;
        })
        .catch(err => {
          _loaderPromise = null;
          logger.error('[SemanticMemory] Failed to load Transformers.js', err);
          throw new Errors.ConfigError('Failed to load Transformers.js');
        });

      return _loaderPromise;
    };

    const loadEmbeddingModel = async () => {
      if (_extractor) return _extractor;

      const tf = await ensureTransformersReady();

      logger.info(`[SemanticMemory] Loading embedding model: ${CONFIG.model}`);

      EventBus.emit('cognition:status', {
        subsystem: 'semantic',
        state: 'loading',
        message: 'Loading embedding model...'
      });

      try {
        _extractor = await tf.pipeline('feature-extraction', CONFIG.model, {
          device: navigator.gpu ? 'webgpu' : 'wasm',
          dtype: 'fp32',
          progress_callback: (progress) => {
            if (progress.status === 'progress' && progress.total > 0) {
              const percent = Math.round((progress.loaded / progress.total) * 100);
              EventBus.emit('cognition:status', {
                subsystem: 'semantic',
                state: 'loading',
                progress: percent,
                message: `Loading model: ${percent}%`
              });
            }
          }
        });

        logger.info('[SemanticMemory] Embedding model loaded');
        EventBus.emit('cognition:status', {
          subsystem: 'semantic',
          state: 'ready',
          message: 'Embedding model ready'
        });

        return _extractor;
      } catch (err) {
        logger.error('[SemanticMemory] Failed to load embedding model', err);
        _extractor = null;
        throw new Errors.ApiError('Failed to load embedding model');
      }
    };

    // --- Core API ---

    const init = async () => {
      if (_isInitialized) return true;

      await EmbeddingStore.init();
      // Don't load model eagerly - load on first use
      _isInitialized = true;

      // Listen for conversation events for auto-learning
      EventBus.on('agent:history', handleAgentHistory);

      logger.info('[SemanticMemory] Initialized');
      return true;
    };

    const embed = async (text) => {
      if (!text || typeof text !== 'string') {
        throw new Errors.ValidationError('Text is required for embedding');
      }

      await loadEmbeddingModel();

      try {
        const output = await _extractor(text, {
          pooling: 'mean',
          normalize: true
        });

        // Convert to regular array for storage
        const embedding = Array.from(output.data);

        EventBus.emit('cognition:semantic:embed', {
          text: text.slice(0, 50) + '...',
          dimensions: embedding.length
        });

        return embedding;
      } catch (err) {
        logger.error('[SemanticMemory] Embedding failed', err);
        throw new Errors.ApiError('Failed to generate embedding');
      }
    };

    const embedBatch = async (texts) => {
      const embeddings = [];
      for (const text of texts) {
        const emb = await embed(text);
        embeddings.push(emb);
      }
      return embeddings;
    };

    const store = async (text, metadata = {}) => {
      const embedding = await embed(text);

      const id = await EmbeddingStore.addMemory({
        content: text,
        embedding,
        domain: metadata.domain || 'general',
        source: metadata.source || 'assistant',
        metadata
      });

      // Update vocabulary with tokens
      const tokens = tokenize(text);
      await EmbeddingStore.updateVocabulary(tokens);

      EventBus.emit('cognition:semantic:store', { id, text: text.slice(0, 50) });

      return id;
    };

    const search = async (query, options = {}) => {
      const { topK = CONFIG.topK, minSimilarity = CONFIG.minSimilarity } = options;

      const queryEmbedding = await embed(query);
      const results = await EmbeddingStore.searchSimilar(queryEmbedding, topK, minSimilarity);

      EventBus.emit('cognition:semantic:search', {
        query: query.slice(0, 50),
        results: results.length
      });

      return results.map(r => ({
        id: r.memory.id,
        content: r.memory.content,
        similarity: r.similarity,
        domain: r.memory.domain,
        timestamp: r.memory.timestamp
      }));
    };

    const enrich = async (query, context = []) => {
      try {
        const relevantMemories = await search(query, { topK: 3 });

        if (relevantMemories.length === 0) {
          return context;
        }

        // Build memory context string
        const memoryContext = relevantMemories
          .map(m => `[Memory ${m.domain}] ${m.content.slice(0, 200)}`)
          .join('\n');

        // find insertion point (after system messages)
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
        logger.warn('[SemanticMemory] Enrichment failed, using original context', err);
        return context;
      }
    };

    // --- Tokenization ---

    const tokenize = (text) => {
      if (!text) return [];
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2);
    };

    // --- Idle-time Learning ---

    const handleAgentHistory = (event) => {
      if (event.type === 'llm_response' && event.content) {
        queueForLearning({
          content: event.content,
          source: 'assistant',
          domain: 'conversation'
        });
      } else if (event.type === 'tool_result' && event.result) {
        queueForLearning({
          content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
          source: 'tool',
          domain: event.tool || 'tool'
        });
      }
    };

    const queueForLearning = (item) => {
      _trainingQueue.push(item);

      // Schedule idle-time processing
      if (!_idleCallbackId && _trainingQueue.length >= CONFIG.batchSize) {
        scheduleIdleLearning();
      }
    };

    const scheduleIdleLearning = () => {
      if ('requestIdleCallback' in window) {
        _idleCallbackId = requestIdleCallback(processLearningQueue, {
          timeout: 60000 // Max 1 minute wait
        });
      } else {
        // Fallback for Safari
        _idleCallbackId = setTimeout(processLearningQueue, CONFIG.idleTrainingDelay);
      }
    };

    const processLearningQueue = async (deadline) => {
      _idleCallbackId = null;

      const hasTimeRemaining = deadline?.timeRemaining
        ? () => deadline.timeRemaining() > 10
        : () => true;

      let processed = 0;

      while (_trainingQueue.length > 0 && hasTimeRemaining() && processed < CONFIG.batchSize) {
        const item = _trainingQueue.shift();

        try {
          // Only store substantial content
          if (item.content && item.content.length > 50) {
            await store(item.content, {
              source: item.source,
              domain: item.domain
            });
            processed++;
          }
        } catch (err) {
          logger.warn('[SemanticMemory] Failed to process learning item', err);
        }
      }

      if (processed > 0) {
        logger.debug(`[SemanticMemory] Processed ${processed} items from learning queue`);
        EventBus.emit('cognition:learning:semantic', { processed });
      }

      // Reschedule if more items pending
      if (_trainingQueue.length > 0) {
        scheduleIdleLearning();
      }
    };

    // --- Maintenance ---

    const prune = async () => {
      return EmbeddingStore.pruneOldMemories();
    };

    const getStats = async () => {
      const storeStats = await EmbeddingStore.getStats();
      return {
        ...storeStats,
        modelLoaded: !!_extractor,
        model: CONFIG.model,
        queueSize: _trainingQueue.length
      };
    };

    const clear = async () => {
      _trainingQueue = [];
      if (_idleCallbackId) {
        if ('cancelIdleCallback' in window) {
          cancelIdleCallback(_idleCallbackId);
        } else {
          clearTimeout(_idleCallbackId);
        }
        _idleCallbackId = null;
      }
      return EmbeddingStore.clear();
    };

    const dispose = async () => {
      await clear();
      EventBus.off('agent:history', handleAgentHistory);
      if (_extractor?.dispose) {
        await _extractor.dispose();
      }
      _extractor = null;
      _isInitialized = false;
      logger.info('[SemanticMemory] Disposed');
    };

    return {
      init,
      embed,
      embedBatch,
      store,
      search,
      enrich,
      prune,
      getStats,
      clear,
      dispose
    };
  }
};

export default SemanticMemory;
