/**
 * @fileoverview Cognition API
 * Unified entry point for the neurosymbolic cognition system.
 * Orchestrates semantic memory, symbolic reasoning, and learning.
 */

const CognitionAPI = {
  metadata: {
    id: 'CognitionAPI',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: [
      'Utils',
      'EventBus',
      'SemanticMemory',
      'KnowledgeGraph',
      'RuleEngine',
      'SymbolGrounder'
    ],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const {
      Utils,
      EventBus,
      SemanticMemory,
      KnowledgeGraph,
      RuleEngine,
      SymbolGrounder
    } = deps;
    const { logger, generateId } = Utils;

    // Load boot config from localStorage if available
    const bootConfig = typeof window !== 'undefined' && window.getCognitionConfig
      ? window.getCognitionConfig()
      : {};

    // State
    let _isInitialized = false;
    let _config = {
      semantic: { enabled: bootConfig.semantic ?? true },
      symbolic: { enabled: bootConfig.symbolic ?? true },
      learning: { enabled: true, autoLearn: true, minConfidence: 0.8 }
    };

    // Circuit breakers for graceful degradation
    const _circuits = {
      semantic: { failures: 0, lastFailure: 0, open: false },
      symbolic: { failures: 0, lastFailure: 0, open: false },
      learning: { failures: 0, lastFailure: 0, open: false }
    };

    const CIRCUIT_THRESHOLD = 3;
    const CIRCUIT_RESET_MS = 60000;

    // --- Lifecycle ---

    const init = async () => {
      if (_isInitialized) return true;

      logger.info('[CognitionAPI] Initializing...');

      try {
        // Initialize subsystems in parallel where possible
        await Promise.all([
          KnowledgeGraph.init(),
          RuleEngine.init()
        ]);

        // SemanticMemory loads model lazily
        await SemanticMemory.init();

        _isInitialized = true;
        logger.info('[CognitionAPI] Initialized successfully');

        EventBus.emit('cognition:status', {
          subsystem: 'all',
          state: 'ready'
        });

        return true;
      } catch (err) {
        logger.error('[CognitionAPI] Initialization failed', err);
        throw err;
      }
    };

    // --- Circuit Breaker Logic ---

    const isCircuitOpen = (subsystem) => {
      const circuit = _circuits[subsystem];
      if (!circuit?.open) return false;

      // Check if circuit should reset
      if (Date.now() - circuit.lastFailure > CIRCUIT_RESET_MS) {
        circuit.open = false;
        circuit.failures = 0;
        logger.info(`[CognitionAPI] Circuit ${subsystem} reset`);
        return false;
      }

      return true;
    };

    const recordFailure = (subsystem) => {
      const circuit = _circuits[subsystem];
      if (!circuit) return;

      circuit.failures++;
      circuit.lastFailure = Date.now();

      if (circuit.failures >= CIRCUIT_THRESHOLD) {
        circuit.open = true;
        logger.warn(`[CognitionAPI] Circuit ${subsystem} opened after ${circuit.failures} failures`);
        EventBus.emit('cognition:degraded', {
          subsystem,
          reason: 'Circuit breaker opened'
        });
      }
    };

    const recordSuccess = (subsystem) => {
      const circuit = _circuits[subsystem];
      if (!circuit) return;

      if (circuit.failures > 0) {
        circuit.failures = Math.max(0, circuit.failures - 1);
      }
    };

    // --- Semantic Memory Interface ---

    const semantic = {
      async enrich(query, context = []) {
        if (!_config.semantic.enabled || isCircuitOpen('semantic')) {
          return context;
        }

        try {
          const result = await SemanticMemory.enrich(query, context);
          recordSuccess('semantic');
          return result;
        } catch (err) {
          logger.warn('[CognitionAPI] Semantic enrichment failed', err);
          recordFailure('semantic');
          return context;
        }
      },

      async search(query, options = {}) {
        if (!_config.semantic.enabled || isCircuitOpen('semantic')) {
          return [];
        }

        try {
          const result = await SemanticMemory.search(query, options);
          recordSuccess('semantic');
          return result;
        } catch (err) {
          logger.warn('[CognitionAPI] Semantic search failed', err);
          recordFailure('semantic');
          return [];
        }
      },

      async store(text, metadata = {}) {
        if (!_config.semantic.enabled || isCircuitOpen('semantic')) {
          return null;
        }

        try {
          const result = await SemanticMemory.store(text, metadata);
          recordSuccess('semantic');
          return result;
        } catch (err) {
          logger.warn('[CognitionAPI] Semantic store failed', err);
          recordFailure('semantic');
          return null;
        }
      },

      async embed(text) {
        if (!_config.semantic.enabled || isCircuitOpen('semantic')) {
          return null;
        }

        try {
          const result = await SemanticMemory.embed(text);
          recordSuccess('semantic');
          return result;
        } catch (err) {
          recordFailure('semantic');
          throw err;
        }
      },

      getStats: () => SemanticMemory.getStats()
    };

    // --- Symbolic Engine Interface ---

    const symbolic = {
      async validate(response, context = {}) {
        if (!_config.symbolic.enabled || isCircuitOpen('symbolic')) {
          return { valid: true, skipped: true, violations: [] };
        }

        try {
          // Ground the response to symbolic entities
          const grounding = await SymbolGrounder.ground(response, context);

          // Run validation
          const validation = await RuleEngine.validate();

          recordSuccess('symbolic');

          return {
            valid: validation.valid,
            violations: validation.violations,
            suggestions: validation.suggestions,
            grounding
          };
        } catch (err) {
          logger.warn('[CognitionAPI] Symbolic validation failed', err);
          recordFailure('symbolic');
          return { valid: true, skipped: true, violations: [] };
        }
      },

      async infer() {
        if (!_config.symbolic.enabled || isCircuitOpen('symbolic')) {
          return [];
        }

        try {
          const result = await RuleEngine.infer();
          recordSuccess('symbolic');
          return result;
        } catch (err) {
          logger.warn('[CognitionAPI] Symbolic inference failed', err);
          recordFailure('symbolic');
          return [];
        }
      },

      addEntity: (entity) => KnowledgeGraph.addEntity(entity),
      getEntity: (id) => KnowledgeGraph.getEntity(id),
      addTriple: (s, p, o, m) => KnowledgeGraph.addTriple(s, p, o, m),
      query: (pattern) => KnowledgeGraph.query(pattern),
      addRule: (rule) => RuleEngine.addRule(rule),
      addConstraint: (c) => RuleEngine.addConstraint(c),

      getStats: () => ({
        ...KnowledgeGraph.getStats(),
        ...RuleEngine.getStats()
      })
    };

    // --- Learning Interface ---

    const learning = {
      async extract(response, context = {}) {
        if (!_config.learning.enabled || isCircuitOpen('learning')) {
          return { learned: false, deferred: true };
        }

        try {
          // Ground the response
          const grounding = await SymbolGrounder.ground(response, context);

          // Filter by confidence threshold
          const highConfidenceEntities = grounding.newEntities.filter(
            e => e.score >= _config.learning.minConfidence
          );

          const highConfidenceRelations = grounding.relations.filter(
            r => r.confidence >= _config.learning.minConfidence
          );

          // Auto-learn if enabled
          if (_config.learning.autoLearn) {
            await SymbolGrounder.integrateGrounding({
              ...grounding,
              newEntities: highConfidenceEntities,
              relations: highConfidenceRelations
            });

            // Store in semantic memory
            if (response.length > 50) {
              await SemanticMemory.store(response, {
                domain: context.domain || 'conversation',
                source: 'assistant'
              });
            }
          }

          recordSuccess('learning');

          EventBus.emit('cognition:learning:extract', {
            entities: highConfidenceEntities.length,
            relations: highConfidenceRelations.length
          });

          return {
            learned: true,
            entities: highConfidenceEntities.length,
            relations: highConfidenceRelations.length,
            grounding
          };
        } catch (err) {
          logger.warn('[CognitionAPI] Learning extraction failed', err);
          recordFailure('learning');
          return { learned: false, error: err.message };
        }
      },

      async feedback(responseId, quality, corrections = {}) {
        // Future: Use feedback for reinforcement learning
        EventBus.emit('cognition:learning:feedback', {
          responseId,
          quality,
          corrections
        });
        return true;
      }
    };

    // --- Unified Query Interface ---

    const query = async (input, options = {}) => {
      const queryId = generateId('cog');
      const startTime = Date.now();

      EventBus.emit('cognition:query:start', { queryId, input: input.slice?.(0, 100) });

      try {
        const result = {
          queryId,
          enrichment: null,
          validation: null,
          learned: null,
          metadata: {
            subsystemsUsed: [],
            duration: 0
          }
        };

        // Phase 1: Semantic enrichment (pre-processing)
        if (options.useSemanticEnrichment !== false && _config.semantic.enabled) {
          result.enrichment = await semantic.enrich(
            input.query || input,
            input.context || []
          );
          result.metadata.subsystemsUsed.push('semantic');
        }

        // Phase 2: Neural inference is handled externally by LLMClient

        // Phase 3: Symbolic validation (post-processing)
        if (options.useSymbolicValidation !== false && _config.symbolic.enabled && input.response) {
          result.validation = await symbolic.validate(input.response, {
            cycle: input.cycle
          });
          result.metadata.subsystemsUsed.push('symbolic');
        }

        // Phase 4: Learning (post-response)
        if (options.enableLearning !== false && _config.learning.enabled && input.response) {
          result.learned = await learning.extract(input.response, {
            cycle: input.cycle,
            domain: input.domain
          });
          result.metadata.subsystemsUsed.push('learning');
        }

        result.metadata.duration = Date.now() - startTime;

        EventBus.emit('cognition:query:complete', {
          queryId,
          duration: result.metadata.duration
        });

        return result;
      } catch (err) {
        EventBus.emit('cognition:query:error', {
          queryId,
          error: err.message
        });
        throw err;
      }
    };

    // --- Configuration ---

    const configure = (newConfig) => {
      _config = {
        ..._config,
        ...newConfig,
        semantic: { ..._config.semantic, ...newConfig.semantic },
        symbolic: { ..._config.symbolic, ...newConfig.symbolic },
        learning: { ..._config.learning, ...newConfig.learning }
      };
      logger.info('[CognitionAPI] Configuration updated', _config);
    };

    const getConfig = () => ({ ..._config });

    // --- Status & Health ---

    const getStatus = () => ({
      initialized: _isInitialized,
      config: _config,
      circuits: {
        semantic: { ...(_circuits.semantic), open: isCircuitOpen('semantic') },
        symbolic: { ...(_circuits.symbolic), open: isCircuitOpen('symbolic') },
        learning: { ...(_circuits.learning), open: isCircuitOpen('learning') }
      }
    });

    const healthCheck = async () => {
      const status = {
        semantic: false,
        symbolic: false,
        learning: false
      };

      try {
        await SemanticMemory.getStats();
        status.semantic = true;
      } catch {}

      try {
        KnowledgeGraph.getStats();
        status.symbolic = true;
      } catch {}

      status.learning = status.semantic && status.symbolic;

      return status;
    };

    // --- Cleanup ---

    const dispose = async () => {
      await SemanticMemory.dispose();
      _isInitialized = false;
      logger.info('[CognitionAPI] Disposed');
    };

    return {
      init,
      query,
      semantic,
      symbolic,
      learning,
      configure,
      getConfig,
      getStatus,
      healthCheck,
      dispose
    };
  }
};

export default CognitionAPI;
