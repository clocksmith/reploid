/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '1.2.0', // MemoryManager integration
    genesis: { introduced: 'spark' },
    dependencies: [
      'Utils', 'EventBus', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'CircuitBreaker', 'SchemaRegistry',
      'ToolExecutor',
      'ReflectionStore?', 'ReflectionAnalyzer?', 'CognitionAPI?', 'MultiModelCoordinator?', 'FunctionGemmaOrchestrator?', 'TraceStore?',
      'MemoryManager?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    const {
      Utils, EventBus, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, CircuitBreaker, SchemaRegistry, ToolExecutor,
      ReflectionStore, ReflectionAnalyzer, CognitionAPI, MultiModelCoordinator, FunctionGemmaOrchestrator, TraceStore,
      MemoryManager
    } = deps;

    const { logger, Errors } = Utils;

    const MAX_ITERATIONS = 256;
    const DEFAULT_MAX_TOOL_CALLS = 5;

    // Configurable limits - can be overridden via StateManager config
    const getMaxToolCalls = () => {
      try {
        const config = StateManager?.getState()?.config || {};
        return config.maxToolCallsPerIteration || DEFAULT_MAX_TOOL_CALLS;
      } catch {
        return DEFAULT_MAX_TOOL_CALLS;
      }
    };

    // Use SchemaRegistry for read-only tool detection (no longer hardcoded)
    const isReadOnlyTool = (name) => {
      if (SchemaRegistry?.isToolReadOnly) {
        return SchemaRegistry.isToolReadOnly(name);
      }
      // Fallback if SchemaRegistry not available
      const FALLBACK_READ_ONLY = ['ReadFile', 'ListFiles', 'Grep', 'Find', 'Cat', 'Head', 'Tail', 'Ls', 'Pwd', 'ListTools', 'ListMemories', 'ListKnowledge'];
      return FALLBACK_READ_ONLY.includes(name);
    };

    const readLocalStorageJson = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
        return null;
      } catch (e) {
        logger.warn(`[Agent] Failed to parse ${key}: ${e.message}`);
        return null;
      }
    };

    const getFunctionGemmaConfigFromState = () => {
      try {
        const state = StateManager?.getState?.();
        return state?.functionGemma || state?.config?.functionGemma || null;
      } catch {
        return null;
      }
    };

    const resolveFunctionGemmaConfig = () => {
      if (!FunctionGemmaOrchestrator) return null;
      const candidates = [
        _modelConfig?.functionGemma,
        _modelConfig?.functionGemmaConfig,
        getFunctionGemmaConfigFromState(),
        readLocalStorageJson('REPLOID_FUNCTIONGEMMA_CONFIG')
      ].filter(Boolean);

      if (candidates.length === 0) return null;
      const config = { ...candidates[0] };
      if (config.enabled === false) return null;
      return config;
    };

    const getFunctionGemmaRoutingMode = (config) => {
      if (!config) return 'disabled';
      if (config.enabled === false) return 'disabled';

      const mode = (config.routingMode || config.mode || '').toLowerCase();
      if (['disabled', 'off', 'none'].includes(mode)) return 'disabled';
      if (['auto', 'heuristic'].includes(mode)) return 'auto';
      if (mode === 'always') return 'always';

      if (config.autoRouting === true || config.useHeuristic === true) return 'auto';
      if (config.autoRouting === false || config.useHeuristic === false) return 'always';
      if (Array.isArray(config.autoTriggers) || Array.isArray(config.autoBlocks) || config.autoDefault === true) {
        return 'auto';
      }

      return 'always';
    };

    const DEFAULT_FG_TRIGGERS = [
      /\bjson\b/i,
      /\bschema\b/i,
      /\bstructured\b/i,
      /\byaml\b/i,
      /\bxml\b/i,
      /\bcsv\b/i,
      /\btable\b/i,
      /\btype signature\b/i,
      /\binterface\b/i,
      /\btypescript\b/i,
      /\bjavascript\b/i,
      /\bcode\b/i,
      /\bclass\b/i,
      /\bpatch\b/i,
      /\bdiff\b/i,
      /\boutput format\b/i
    ];

    const DEFAULT_FG_BLOCKS = [
      'list files', 'read file', 'open file', 'edit file', 'update file', 'write file',
      'grep', 'search repo', 'search code', 'find file',
      'run tests', 'run test', 'install', 'build', 'compile',
      'shell', 'terminal', 'command line', 'cli', 'git',
      /\b[a-z0-9._-]+\/[a-z0-9._-]+\.(js|ts|jsx|tsx|json|md|css|html|yml|yaml)\b/i
    ];

    const normalizePatterns = (patterns, fallback) => {
      if (!Array.isArray(patterns) || patterns.length === 0) return fallback;
      return patterns;
    };

    const matchesPattern = (text, pattern) => {
      if (!pattern) return false;
      if (pattern instanceof RegExp) return pattern.test(text);
      if (typeof pattern === 'string') return text.toLowerCase().includes(pattern.toLowerCase());
      return false;
    };

    const matchesAny = (text, patterns) => {
      if (!text) return false;
      return patterns.some((pattern) => matchesPattern(text, pattern));
    };

    const shouldUseFunctionGemma = (text, config) => {
      if (!text) return false;

      const blocks = normalizePatterns(config?.autoBlocks, DEFAULT_FG_BLOCKS);
      if (matchesAny(text, blocks)) return false;

      const triggers = normalizePatterns(config?.autoTriggers, DEFAULT_FG_TRIGGERS);
      if (matchesAny(text, triggers)) return true;

      return config?.autoDefault === true;
    };

    const getFunctionGemmaModelId = (config) => {
      if (!config) return null;
      return config.modelId
        || config.baseModelId
        || config.model
        || config.baseModel
        || config.modelConfig?.modelId
        || config.modelConfig?.id
        || (_modelConfig?.provider === 'doppler' ? (_modelConfig.modelId || _modelConfig.id) : null);
    };

    const getFunctionGemmaModelConfig = (config) => {
      if (config?.modelConfig) return config.modelConfig;
      if (config?.baseModelConfig) return config.baseModelConfig;
      if (_modelConfig?.provider === 'doppler') return _modelConfig;
      return null;
    };

    const getFunctionGemmaRoutingText = (context, goal, config) => {
      if (config?.routingText) return config.routingText;
      const lastUserMsg = [...context].reverse().find((m) => m.role === 'user');
      return lastUserMsg?.content || goal || '';
    };

    const buildPromptFromContext = (context, options = {}) => {
      const omitSystemPrompt = options.omitSystemPrompt === true;
      let skippedFirstSystem = false;
      return context
        .filter((m) => {
          if (!omitSystemPrompt || m.role !== 'system') return true;
          if (skippedFirstSystem) return true;
          skippedFirstSystem = true;
          return false;
        })
        .map((m) => {
          if (m.role === 'system') return `System: ${m.content}`;
          if (m.role === 'user') return `User: ${m.content}`;
          if (m.role === 'assistant') return `Assistant: ${m.content}`;
          return m.content;
        })
        .join('\n') + '\nAssistant:';
    };

    const buildFunctionGemmaKey = (config, modelId) => {
      const expertIds = Array.isArray(config?.experts)
        ? config.experts.map((expert) => expert.id || expert.adapterName || expert.adapter).filter(Boolean)
        : [];
      return JSON.stringify({
        modelId: modelId || null,
        baseUrl: config?.baseUrl || null,
        usePool: config?.usePool !== false,
        expertIds
      });
    };

    const ensureFunctionGemmaReady = async (context, config) => {
      if (!FunctionGemmaOrchestrator || !config) return false;

      const modelId = getFunctionGemmaModelId(config);
      if (!modelId && !config.manifest) {
        logger.warn('[Agent] FunctionGemma config missing modelId/manifest; skipping.');
        return false;
      }

      const experts = Array.isArray(config.experts) ? config.experts : [];
      if (experts.length === 0) {
        logger.warn('[Agent] FunctionGemma config missing experts; skipping.');
        return false;
      }

      const nextKey = buildFunctionGemmaKey(config, modelId);
      if (_functionGemmaReady && _functionGemmaKey === nextKey) {
        return true;
      }

      if (_functionGemmaInitPromise) {
        return _functionGemmaInitPromise;
      }

      _functionGemmaKey = nextKey;
      _functionGemmaInitPromise = (async () => {
        _functionGemmaReady = false;
        _functionGemmaHasPrefix = false;

        if (ContextManager?.clearExpertContext) {
          ContextManager.clearExpertContext();
        }

        await FunctionGemmaOrchestrator.initBase({
          modelId,
          manifest: config.manifest,
          baseUrl: config.baseUrl || null,
          usePool: config.usePool !== false,
          storageContext: config.storageContext
        });

        await FunctionGemmaOrchestrator.registerExperts(experts);

        if (config.combiner) {
          FunctionGemmaOrchestrator.setCombiner(config.combiner);
        }

        const modelConfig = getFunctionGemmaModelConfig(config);
        const systemPrompt = config.systemPrompt || _currentSystemPrompt;
        if (config.useSharedPrefix !== false && systemPrompt && modelConfig) {
          try {
            const prefix = await FunctionGemmaOrchestrator.initExpertContext(systemPrompt, modelConfig, experts);
            _functionGemmaHasPrefix = !!prefix?.snapshot;
          } catch (err) {
            logger.warn('[Agent] FunctionGemma shared prefix init failed:', err.message);
          }
        }

        if (config.benchmarkRouting) {
          const taskText = context?.[context.length - 1]?.content || 'benchmark';
          const benchmarkTask = { type: 'benchmark', prompt: taskText, description: taskText, routingText: taskText };
          const benchmarkOptions = typeof config.benchmarkRouting === 'object'
            ? config.benchmarkRouting
            : { runs: config.benchmarkRuns || 10, topK: config.topK || 1 };
          try {
            await FunctionGemmaOrchestrator.benchmarkRoutingLatency(benchmarkTask, benchmarkOptions);
          } catch (err) {
            logger.warn('[Agent] FunctionGemma benchmark failed:', err.message);
          }
        }

        _functionGemmaReady = true;
        return true;
      })();

      try {
        return await _functionGemmaInitPromise;
      } catch (err) {
        logger.error('[Agent] FunctionGemma init failed:', err);
        _functionGemmaReady = false;
        _functionGemmaHasPrefix = false;
        return false;
      } finally {
        _functionGemmaInitPromise = null;
      }
    };

    const resetFunctionGemmaState = () => {
      _functionGemmaReady = false;
      _functionGemmaHasPrefix = false;
      _functionGemmaInitPromise = null;
      _functionGemmaKey = null;
    };

    const MAX_NO_PROGRESS_ITERATIONS = 5; // Max consecutive iterations without tool calls
    const TOOL_EXECUTION_TIMEOUT_MS = 30000; // 30 second timeout per tool

    // Track single-tool usage for batching nudges
    let _consecutiveSingleToolCalls = 0;
    const SINGLE_TOOL_NUDGE_THRESHOLD = 3; // Nudge after 3 consecutive single-tool iterations
    let _isRunning = false;
    let _abortController = null;
    let _modelConfig = null;
    let _modelConfigs = []; // Array of models for multi-model mode
    let _consensusStrategy = 'arena'; // arena, peer-review, swarm
    let _functionGemmaReady = false;
    let _functionGemmaHasPrefix = false;
    let _functionGemmaInitPromise = null;
    let _functionGemmaKey = null;
    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

    // Debug visibility - track current context and system prompt
    let _currentContext = [];
    let _currentSystemPrompt = '';
    let _traceSessionId = null;

    // Human-in-the-loop message queue
    let _humanMessageQueue = [];

    // Helper to update tracked context whenever it changes
    const _syncContext = (context) => {
      _currentContext = [...context];
    };

    // Inject a human message into the agent's context
    const injectHumanMessage = (content, type = 'context') => {
      _humanMessageQueue.push({ content, type, timestamp: Date.now() });
      EventBus.emit('human:message-queued', { content, type });
      logger.info(`[Agent] Human message queued (${type}): ${content.substring(0, 50)}...`);
    };

    // Listen for human messages from UI
    EventBus.on('human:message', ({ content, type }) => {
      injectHumanMessage(content, type);
    }, 'AgentLoop');

    // Stuck loop detection state
    let _loopHealth = {
      consecutiveNoToolCalls: 0,
      lastResponseLength: 0,
      repeatedShortResponses: 0
    };

    const _resetLoopHealth = () => {
      _loopHealth = {
        consecutiveNoToolCalls: 0,
        lastResponseLength: 0,
        repeatedShortResponses: 0
      };
    };

    // Circuit breaker for failing tools - use shared utility
    const _toolCircuitBreaker = CircuitBreaker.create({
      threshold: 3,
      resetMs: 60000,
      name: 'AgentToolCircuit',
      emitEvents: true
    });

    const _checkLoopHealth = (iteration, toolCallCount, responseLength) => {
      // Check 1: No tool calls for too many iterations
      if (toolCallCount === 0) {
        _loopHealth.consecutiveNoToolCalls++;
        if (_loopHealth.consecutiveNoToolCalls >= MAX_NO_PROGRESS_ITERATIONS) {
          return {
            stuck: true,
            reason: `No tool calls for ${MAX_NO_PROGRESS_ITERATIONS} consecutive iterations`,
            action: 'request_summary'
          };
        }
      } else {
        _loopHealth.consecutiveNoToolCalls = 0;
      }

      // Check 2: Response getting very short (model degradation)
      if (responseLength < 50 && iteration > 3) {
        _loopHealth.repeatedShortResponses++;
        if (_loopHealth.repeatedShortResponses >= 3) {
          return {
            stuck: true,
            reason: 'Model producing very short responses repeatedly',
            action: 'force_stop'
          };
        }
      } else {
        _loopHealth.repeatedShortResponses = 0;
      }

      _loopHealth.lastResponseLength = responseLength;
      return { stuck: false };
    };

    const _pushActivity = (entry) => {
      _activityLog.push({ ts: Date.now(), ...entry });
      if (_activityLog.length > MAX_ACTIVITY_LOG) {
        _activityLog.shift();
      }
    };

    const _executeTool = async (call, iteration) => {
      if (!ToolExecutor) {
        throw new Errors.ConfigError('ToolExecutor not available');
      }
      const { result, error } = await ToolExecutor.executeWithRetry(call, {
        timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
        iteration,
        trace: _traceSessionId ? { sessionId: _traceSessionId, source: 'agent' } : null
      });
      return { result, error };
    };

    /**
     * Handle stuck loop detection and recovery
     * @param {Object} healthCheck - Health check result
     * @param {Array} context - Current context array
     * @param {number} iteration - Current iteration
     * @returns {Promise<boolean>} True if should break the loop
     */
    const _handleStuckLoop = async (healthCheck, context, iteration) => {
      logger.warn(`[Agent] STUCK LOOP DETECTED: ${healthCheck.reason}`);
      EventBus.emit('agent:warning', {
        type: 'stuck_loop',
        reason: healthCheck.reason,
        cycle: iteration
      });

      if (healthCheck.action === 'request_summary') {
        context.push({
          role: 'user',
          content: 'SYSTEM: You appear to be stuck without making progress. Please summarize what you have accomplished so far and what remains to be done, then stop.'
        });
        try {
          const summaryResponse = await LLMClient.chat(context, _modelConfig);
          _pushActivity({ kind: 'stuck_summary', cycle: iteration, content: summaryResponse.content });
          EventBus.emit('agent:history', { type: 'llm_response', cycle: iteration, content: summaryResponse.content });
        } catch (e) {
          logger.error('[Agent] Failed to get summary response', e);
        }
        return true;
      }
      return healthCheck.action === 'force_stop';
    };

    /**
     * Process and log tool result
     * @param {Object} call - Tool call object
     * @param {string} result - Tool result string
     * @param {number} iteration - Current iteration
     * @param {Array} context - Context array to push result to
     */
    const _processToolResult = (call, result, iteration, context) => {
      // Smart truncation
      let processedResult = result;
      if (result.length > 5000 && call.name !== 'ReadFile') {
        processedResult = result.substring(0, 5000) + "\n... [OUTPUT TRUNCATED. USE FileOutline OR ReadFile FOR DETAILS] ...";
      }

      context.push({
        role: 'user',
        content: `TOOL_RESULT (${call.name}):\n${processedResult}`
      });

      EventBus.emit('agent:history', {
        type: 'tool_result',
        cycle: iteration,
        tool: call.name,
        args: call.args,
        result: processedResult
      });
      _pushActivity({ kind: 'tool_result', cycle: iteration, tool: call.name, args: call.args, result: processedResult });
      _logReflection(call, processedResult, iteration);
    };

    const run = async (goal) => {
      if (_isRunning) throw new Errors.StateError('Agent already running');
      if (!_modelConfig) throw new Errors.ConfigError('No model configured');

      _isRunning = true;
      _abortController = new AbortController();
      _resetLoopHealth();
      _toolCircuitBreaker.reset();

      logger.info(`[Agent] Starting cycle. Goal: "${goal}"`);
      EventBus.emit('agent:status', { state: 'STARTING', activity: 'Initializing...' });

      await StateManager.setGoal(goal);
      if (TraceStore) {
        _traceSessionId = await TraceStore.startSession({
          source: 'agent',
          goal,
          modelId: _modelConfig?.id || null
        });
      }

      // Initialize MemoryManager for this session
      if (MemoryManager) {
        try {
          await MemoryManager.init();
          await MemoryManager.newSession();
          // Store the initial goal
          await MemoryManager.add({ role: 'user', content: goal, metadata: { type: 'goal' } });
          logger.debug('[Agent] MemoryManager initialized for session');
        } catch (e) {
          logger.warn('[Agent] MemoryManager initialization failed:', e.message);
        }
      }

      let context = await _buildInitialContext(goal);
      let iteration = 0;
      const functionGemmaConfig = resolveFunctionGemmaConfig();
      let functionGemmaEnabled = !!functionGemmaConfig;
      if (functionGemmaEnabled) {
        functionGemmaEnabled = await ensureFunctionGemmaReady(context, functionGemmaConfig);
      }

      // Update tracked context after initialization
      _currentContext = [...context];

      try {
        while (_isRunning && iteration < MAX_ITERATIONS) {
          if (_abortController.signal.aborted) break;

          iteration++;
          await StateManager.incrementCycle();
          logger.info(`[Agent] Iteration ${iteration}`);

          // 2. Insights / Reflection Injection
          let insights = null;
          try {
            if (ReflectionAnalyzer && ReflectionAnalyzer.api) {
              const failurePatterns = await ReflectionAnalyzer.api.detectFailurePatterns();
              if (failurePatterns.length > 0) {
                insights = failurePatterns.slice(0, 2).map(p => p.indicator);
              }
            }
          } catch (e) {
            logger.debug('[Agent] Failed to get reflection insights:', e.message);
          }

          if (insights && insights.length > 0) {
            // Append memory as user message to maintain proper message ordering
            context.push({ role: 'user', content: `[MEMORY] Watch out for these past failure patterns: ${insights.join(', ')}` });
          }

          EventBus.emit('agent:status', { state: 'THINKING', activity: `Cycle ${iteration} - Calling LLM...`, cycle: iteration });

          // Context management: compaction, warnings, and hard limit enforcement
          const contextResult = await ContextManager.manage(context, _modelConfig);
          context = contextResult.context;
          _syncContext(context);

          // Notify MemoryManager when context is compacted (for memory refresh)
          if (contextResult.compacted && MemoryManager?.onContextCompacted) {
            try {
              await MemoryManager.onContextCompacted({
                previousTokens: contextResult.previousTokens,
                newTokens: contextResult.newTokens,
                compactedContext: context
              });
              logger.debug('[Agent] Memory notified of context compaction');
            } catch (e) {
              logger.debug('[Agent] Memory refresh on compaction skipped:', e.message);
            }
          }

          // Check if context manager halted the agent (hard limit exceeded after aggressive compaction)
          if (contextResult.halted) {
            logger.error(`[Agent] STOPPING: ${contextResult.error}`);
            EventBus.emit('agent:error', {
              error: contextResult.error,
              cycle: iteration
            });
            throw new Error(contextResult.error);
          }

          // Drain human message queue before LLM call
          while (_humanMessageQueue.length > 0) {
            const msg = _humanMessageQueue.shift();
            const prefix = msg.type === 'goal' ? '[GOAL REFINEMENT]' : '[USER]';
            context.push({ role: 'user', content: `${prefix} ${msg.content}` });
            _syncContext(context);

            // Emit for history display
            EventBus.emit('agent:history', {
              type: 'human',
              cycle: iteration,
              content: msg.content,
              messageType: msg.type
            });
            _pushActivity({ kind: 'human_message', cycle: iteration, content: msg.content, messageType: msg.type });
            logger.info(`[Agent] Injected human ${msg.type} message into context`);
          }

          // Cognition: Semantic enrichment (pre-LLM)
          if (CognitionAPI) {
            try {
              const lastUserMsg = context.filter(m => m.role === 'user').pop();
              if (lastUserMsg?.content) {
                context = await CognitionAPI.semantic.enrich(lastUserMsg.content, context);
                _syncContext(context);
              }
            } catch (e) {
              logger.debug('[Agent] Cognition enrichment skipped:', e.message);
            }
          }

          // MemoryManager: Retrieve relevant episodic memories with anticipatory retrieval
          if (MemoryManager && iteration > 1) {
            try {
              const lastUserMsg = context.filter(m => m.role === 'user').pop();
              if (lastUserMsg?.content) {
                // Use anticipatoryRetrieve for task-aware context retrieval
                const retrieved = await MemoryManager.anticipatoryRetrieve(lastUserMsg.content, {
                  topK: 5,
                  includeAnticipated: true
                });
                // Filter by confidence score (episodic > 0.5, anticipated > 0.4)
                const relevant = retrieved.filter(r => {
                  if (r.type === 'anticipated') return r.score > 0.4;
                  return r.type === 'episodic' && r.score > 0.5;
                });
                if (relevant.length > 0) {
                  const memoryContext = relevant
                    .map(r => {
                      const prefix = r.type === 'anticipated'
                        ? `[Anticipated: ${r.anticipationReason}]`
                        : '[Past Context]';
                      return `${prefix} ${r.content.slice(0, 300)}`;
                    })
                    .join('\n');
                  // Insert memory after system messages
                  const insertIdx = context.findIndex(m => m.role !== 'system');
                  const idx = insertIdx === -1 ? context.length : insertIdx;
                  context.splice(idx, 0, { role: 'system', content: memoryContext });
                  _syncContext(context);
                  const anticipated = relevant.filter(r => r.type === 'anticipated').length;
                  const episodic = relevant.length - anticipated;
                  logger.debug(`[Agent] Enriched with ${episodic} episodic + ${anticipated} anticipated memories`);
                }
              }
            } catch (e) {
              logger.debug('[Agent] MemoryManager retrieval skipped:', e.message);
            }
          }

          let llmResponseText = '';
          const streamCallback = (text) => {
            EventBus.emit('agent:stream', text);
            llmResponseText += text;
          };

          // Get tool schemas for native tool calling (if supported)
          const toolSchemas = ToolRunner.getToolSchemas ? ToolRunner.getToolSchemas() : [];

          // Multi-model execution if multiple models configured
          let response;
          let arenaResult = null;
          let functionGemmaResult = null;
          let functionGemmaInfo = null;

          const llmStart = Date.now();
          const multiModelActive = _modelConfigs.length >= 2 && MultiModelCoordinator;
          const functionGemmaRoutingMode = functionGemmaEnabled
            ? getFunctionGemmaRoutingMode(functionGemmaConfig)
            : 'disabled';
          const functionGemmaRoutingText = functionGemmaEnabled
            ? getFunctionGemmaRoutingText(context, goal, functionGemmaConfig)
            : '';
          const functionGemmaModelId = functionGemmaEnabled ? getFunctionGemmaModelId(functionGemmaConfig) : null;
          const functionGemmaAutoOk = functionGemmaRoutingMode === 'always'
            || (functionGemmaRoutingMode === 'auto' && shouldUseFunctionGemma(functionGemmaRoutingText, functionGemmaConfig));
          const useFunctionGemma = functionGemmaEnabled
            && _functionGemmaReady
            && functionGemmaRoutingMode !== 'disabled'
            && functionGemmaAutoOk
            && (!multiModelActive || functionGemmaConfig?.overrideMultiModel);

          if (TraceStore && _traceSessionId) {
            const tags = ['llm'];
            if (useFunctionGemma) tags.push('functiongemma');
            await TraceStore.record(_traceSessionId, 'llm:request', {
              source: 'agent',
              iteration,
              modelId: useFunctionGemma ? functionGemmaModelId : (_modelConfig?.id || null),
              messageCount: context.length,
              messages: context.slice(-10)
            }, { tags });
          }

          if (useFunctionGemma) {
            try {
              EventBus.emit('agent:status', { state: 'THINKING', activity: `Cycle ${iteration} - FunctionGemma routing...`, cycle: iteration });
              const prompt = buildPromptFromContext(context, { omitSystemPrompt: _functionGemmaHasPrefix });
              const task = {
                id: `agent:${iteration}`,
                type: functionGemmaConfig?.taskType || 'agent',
                description: functionGemmaRoutingText,
                routingText: functionGemmaRoutingText,
                prompt,
                schema: functionGemmaConfig?.schema || null,
                schemaName: functionGemmaConfig?.schemaName || null
              };
              const options = {
                topK: functionGemmaConfig?.topK || 3,
                useExpertContext: functionGemmaConfig?.useExpertContext,
                errorRecovery: functionGemmaConfig?.errorRecovery,
                skipCache: functionGemmaConfig?.skipCache,
                promptPlacement: functionGemmaConfig?.promptPlacement,
                maxTokens: functionGemmaConfig?.maxTokens,
                temperature: functionGemmaConfig?.temperature
              };

              functionGemmaResult = await FunctionGemmaOrchestrator.execute(task, options);
              const output = functionGemmaResult?.output || '';
              response = {
                content: output,
                toolCalls: [],
                usage: null,
                functionGemma: functionGemmaResult
              };

              if (output) {
                streamCallback(output);
              }

              functionGemmaInfo = {
                modelId: functionGemmaModelId || null,
                provider: 'doppler',
                cached: functionGemmaResult?.cached || false
              };

              if (TraceStore && _traceSessionId) {
                await TraceStore.record(_traceSessionId, 'llm:response', {
                  source: 'agent',
                  iteration,
                  modelId: functionGemmaModelId || null,
                  latencyMs: Date.now() - llmStart,
                  contentPreview: output || '',
                  toolCallCount: 0,
                  functionGemma: {
                    cached: functionGemmaResult?.cached || false,
                    expert: functionGemmaResult?.expert || null,
                    topology: functionGemmaResult?.topology || null,
                    valid: typeof functionGemmaResult?.valid === 'boolean' ? functionGemmaResult.valid : null,
                    recovered: functionGemmaResult?.recovered || false,
                    errors: functionGemmaResult?.errors || []
                  }
                }, { tags: ['llm', 'functiongemma'] });
              }
            } catch (error) {
              logger.error('[Agent] FunctionGemma execution failed, falling back to LLM:', error);
              response = null;
            }
          }

          if (!response && multiModelActive) {
            logger.info(`[Agent] Multi-model mode: ${_modelConfigs.length} models, strategy: ${_consensusStrategy}`);

            const multiModelConfig = {
              mode: _consensusStrategy === 'peer-review' ? 'consensus' : _consensusStrategy,
              models: _modelConfigs
            };

            const onUpdate = (update) => {
              EventBus.emit('agent:multimodel-update', update);
            };

            try {
              arenaResult = await MultiModelCoordinator.execute(context, multiModelConfig, onUpdate);
              response = arenaResult.result;
              if (TraceStore && _traceSessionId) {
                await TraceStore.record(_traceSessionId, 'llm:response', {
                  source: 'agent',
                  iteration,
                  mode: arenaResult.mode,
                  winner: arenaResult.winner?.model || null,
                  latencyMs: Date.now() - llmStart,
                  contentPreview: response?.content || '',
                  toolCallCount: response?.toolCalls?.length || 0
                }, { tags: ['llm', 'arena'] });
              }

              // Emit arena results for UI
              EventBus.emit('agent:arena-result', {
                cycle: iteration,
                mode: arenaResult.mode,
                winner: arenaResult.winner,
                solutions: arenaResult.solutions
              });

              logger.info(`[Agent] Arena winner: ${arenaResult.winner?.model || 'unknown'}`);
            } catch (error) {
              logger.error('[Agent] Multi-model execution failed, falling back to single model:', error);
              response = await LLMClient.chat(context, _modelConfig || _modelConfigs[0], streamCallback, { tools: toolSchemas });
              if (TraceStore && _traceSessionId) {
                await TraceStore.record(_traceSessionId, 'llm:response', {
                  source: 'agent',
                  iteration,
                  modelId: (_modelConfig || _modelConfigs[0])?.id || null,
                  latencyMs: Date.now() - llmStart,
                  contentPreview: response?.content || '',
                  toolCallCount: response?.toolCalls?.length || 0,
                  usage: response?.usage || null
                }, { tags: ['llm'] });
              }
            }
          } else if (!response) {
            // Single model execution (with native tools if supported)
            response = await LLMClient.chat(context, _modelConfig, streamCallback, { tools: toolSchemas });
            if (TraceStore && _traceSessionId) {
              await TraceStore.record(_traceSessionId, 'llm:response', {
                source: 'agent',
                iteration,
                modelId: _modelConfig?.id || null,
                latencyMs: Date.now() - llmStart,
                contentPreview: response?.content || '',
                toolCallCount: response?.toolCalls?.length || 0,
                usage: response?.usage || null
              }, { tags: ['llm'] });
            }
          }

          const llmEvent = {
            type: 'llm_response',
            cycle: iteration,
            content: response.content
          };
          EventBus.emit('agent:history', llmEvent);
          _pushActivity({ kind: 'llm_response', cycle: iteration, content: response.content });

          const responseContent = response?.content || '';
          const usage = response?.usage || {};
          const lastUserMessage = [...context].reverse().find(m => m.role === 'user');
          const responseModel = functionGemmaInfo?.modelId || arenaResult?.winner?.model || _modelConfig?.id || null;
          const responseProvider = functionGemmaInfo?.provider || arenaResult?.winner?.provider || _modelConfig?.provider || null;
          const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? null;
          const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? usage.tokens ?? null;
          const contextTokenEstimate = ContextManager.countTokens(context);
          const effectiveInputTokens = inputTokens ?? contextTokenEstimate;
          const effectiveOutputTokens = outputTokens ?? null;
          const totalTokens = (Number.isFinite(effectiveInputTokens) ? effectiveInputTokens : 0)
            + (Number.isFinite(effectiveOutputTokens) ? effectiveOutputTokens : 0);

          EventBus.emit('llm:complete', {
            model: responseModel,
            provider: responseProvider,
            latency: Date.now() - llmStart,
            inputTokens: effectiveInputTokens,
            outputTokens: effectiveOutputTokens,
            tokens: totalTokens,
            outputText: responseContent
          });

          // Cognition: Validation and Learning (post-LLM)
          if (CognitionAPI) {
            try {
              // Validate response with symbolic engine
              const validation = await CognitionAPI.symbolic.validate(responseContent, { cycle: iteration });
              if (!validation.valid && !validation.skipped) {
                logger.debug(`[Agent] Cognition validation: ${validation.violations.length} issues`);
              }

              // Auto-learn from response
              await CognitionAPI.learning.extract(responseContent, { cycle: iteration });
            } catch (e) {
              logger.debug('[Agent] Cognition post-processing skipped:', e.message);
            }
          }

          // Use native tool calls if available, otherwise fall back to text parsing
          const toolCalls = response.toolCalls?.length > 0
            ? response.toolCalls
            : ResponseParser.parseToolCalls(responseContent);

          if (response.toolCalls?.length > 0) {
            logger.info(`[Agent] Using ${response.toolCalls.length} native tool call(s)`);
          }

          EventBus.emit('agent:decision', {
            cycle: iteration,
            goal,
            context: lastUserMessage?.content || null,
            reasoning: responseContent,
            action: {
              toolCalls: toolCalls.map(call => ({
                name: call.name || 'unknown',
                args: call.args || {},
                error: call.error || null
              })),
              toolCallCount: toolCalls.length
            },
            model: responseModel,
            provider: responseProvider
          });

          context.push({ role: 'assistant', content: responseContent });
          _syncContext(context);

          // Store in MemoryManager for long-term recall
          if (MemoryManager && responseContent.length > 50) {
            MemoryManager.add({ role: 'assistant', content: responseContent }).catch(e => {
              logger.debug('[Agent] MemoryManager add failed:', e.message);
            });
          }

          // Check for stuck loop
          const healthCheck = _checkLoopHealth(iteration, toolCalls.length, responseContent.length);
          if (healthCheck.stuck) {
            const shouldBreak = await _handleStuckLoop(healthCheck, context, iteration);
            if (shouldBreak) break;
          }

          if (toolCalls.length > 0) {
            // Limit and partition tools
            const maxTools = getMaxToolCalls();
            const callsToExecute = toolCalls.slice(0, maxTools);
            if (toolCalls.length > maxTools) {
              const limitMsg = `Tool call limit (${maxTools}) reached. Executing first ${maxTools}.`;
              logger.warn('[Agent] ' + limitMsg);
              context.push({ role: 'user', content: limitMsg });
            }

            // Track single-tool usage for batching nudges
            if (callsToExecute.length === 1) {
              _consecutiveSingleToolCalls++;
              if (_consecutiveSingleToolCalls >= SINGLE_TOOL_NUDGE_THRESHOLD) {
                const nudgeMsg = `TIP: You can batch multiple independent tool calls in one response. Read-only tools (ReadFile, ListFiles, Grep, etc.) run in parallel for speed.`;
                context.push({ role: 'user', content: nudgeMsg });
                logger.info('[Agent] Nudging model to batch tool calls');
                _consecutiveSingleToolCalls = 0; // Reset after nudge
              }
            } else {
              _consecutiveSingleToolCalls = 0; // Reset on multi-tool usage
            }

            // Pre-filter: handle parse errors and circuit breaker before execution
            const preResults = []; // Store results for tools that can't execute
            const executableCalls = [];
            for (const call of callsToExecute) {
              if (call.error) {
                logger.warn(`[Agent] Tool ${call.name} has parse error: ${call.error}`);
                preResults.push({ call, finalResult: `Error: ${call.error}`, skipped: true });
                continue;
              }
              if (_toolCircuitBreaker.isOpen(call.name)) {
                const circuitState = _toolCircuitBreaker.getState(call.name);
                const remainingMs = 60000 - (Date.now() - circuitState.tripTime);
                const remainingSec = Math.ceil(remainingMs / 1000);
                logger.warn(`[Agent] Circuit breaker OPEN for ${call.name} - skipping`);
                const skipMsg = `Tool ${call.name} is temporarily disabled. Retry in ${remainingSec}s.`;
                preResults.push({ call, finalResult: `Error: ${skipMsg}`, skipped: true });
                EventBus.emit('tool:circuit_skip', { tool: call.name, remainingMs });
                continue;
              }
              executableCalls.push(call);
            }

            // Partition into read-only (parallel) and mutating (sequential)
            const readOnlyCalls = executableCalls.filter(c => isReadOnlyTool(c.name));
            const mutatingCalls = executableCalls.filter(c => !isReadOnlyTool(c.name));

            const allResults = [...preResults]; // Start with pre-filtered results

            // Execute read-only tools in PARALLEL
            if (readOnlyCalls.length > 0) {
              logger.info(`[Agent] Executing ${readOnlyCalls.length} read-only tools in parallel`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Parallel: ${readOnlyCalls.map(c => c.name).join(', ')}` });

              const parallelResults = await Promise.all(readOnlyCalls.map(async (call) => {
                if (_abortController.signal.aborted) return { call, finalResult: 'Aborted', aborted: true };
                const { result, error } = await _executeTool(call, iteration);
                let finalResult = result;
                if (error && !result) {
                  logger.error(`[Agent] Tool Error: ${call.name}`, error);
                  finalResult = `Error: ${error.message}`;
                  EventBus.emit('tool:error', { tool: call.name, error: error.message, cycle: iteration });
                  _toolCircuitBreaker.recordFailure(call.name, error);
                } else if (!error) {
                  _toolCircuitBreaker.recordSuccess(call.name);
                }
                return { call, finalResult, result };
              }));
              allResults.push(...parallelResults);
            }

            // Execute mutating tools SEQUENTIALLY
            for (const call of mutatingCalls) {
              if (_abortController.signal.aborted) break;
              logger.info(`[Agent] Tool Call: ${call.name}`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing: ${call.name}` });

              const { result, error } = await _executeTool(call, iteration);
              let finalResult = result;
              if (error && !result) {
                logger.error(`[Agent] Tool Error: ${call.name}`, error);
                finalResult = `Error: ${error.message}`;
                EventBus.emit('tool:error', { tool: call.name, error: error.message, cycle: iteration });
                _toolCircuitBreaker.recordFailure(call.name, error);
              } else if (!error) {
                _toolCircuitBreaker.recordSuccess(call.name);
              }
              allResults.push({ call, finalResult, result });

              // Handle recursive tool chains (sequential within)
              if (result && typeof result === 'object' && result.nextSteps && Array.isArray(result.nextSteps)) {
                logger.info(`[Agent] Recursive tool chain from ${call.name}`);
                for (const step of result.nextSteps) {
                  if (step.tool && step.args) {
                    const chainedCall = { name: step.tool, args: step.args };
                    const { result: chainedResult, error: chainedError } = await _executeTool(chainedCall, iteration);
                    let chainedFinal = chainedResult;
                    if (chainedError && !chainedResult) {
                      chainedFinal = `Error: ${chainedError.message}`;
                      _toolCircuitBreaker.recordFailure(step.tool, chainedError);
                      allResults.push({ call: chainedCall, finalResult: chainedFinal });
                      break;
                    }
                    _toolCircuitBreaker.recordSuccess(step.tool);
                    allResults.push({ call: chainedCall, finalResult: chainedFinal });
                  }
                }
              }
            }

            // Process all results into context (preserves original order for pre-results)
            for (const { call, finalResult, aborted } of allResults) {
              if (aborted) continue;
              _processToolResult(call, finalResult, iteration, context);
            }

            // Add execution telemetry feedback if batching occurred
            if (readOnlyCalls.length > 1 || (readOnlyCalls.length > 0 && mutatingCalls.length > 0)) {
              const telemetry = [];
              if (readOnlyCalls.length > 1) {
                telemetry.push(`${readOnlyCalls.length} read-only tools ran in PARALLEL`);
              }
              if (mutatingCalls.length > 0) {
                telemetry.push(`${mutatingCalls.length} mutating tools ran sequentially`);
              }
              context.push({
                role: 'user',
                content: `[Execution: ${telemetry.join(', ')}]`
              });
            }
          } else {
            if (ResponseParser.isDone(response.content)) {
              logger.info('[Agent] Goal achieved.');
              break;
            }
            // WebLLM requires last message to be user/tool - add continuation prompt
            let continuationMsg = 'No tool call detected. Use format:\n\nTOOL_CALL: tool_name\nARGS: { }';
            if (iteration > 3) {
              continuationMsg = 'You must use a tool or say DONE.';
            }
            context.push({ role: 'user', content: continuationMsg });
          }
        }
      } catch (err) {
        if (err instanceof Errors.AbortError) {
          logger.info('[Agent] Cycle aborted.');
        } else {
          logger.error('[Agent] Critical Error', err);
          throw err;
        }
      } finally {
        _isRunning = false;
        _abortController = null;
        if (TraceStore && _traceSessionId) {
          await TraceStore.endSession(_traceSessionId, {
            goal,
            status: 'completed',
            iterations: iteration
          });
          _traceSessionId = null;
        }
        EventBus.emit('agent:status', { state: 'IDLE', activity: 'Stopped' });
      }
    };

    const _logReflection = async (call, result, iteration) => {
         if (!ReflectionStore) return;
         const isError = result.startsWith('Error:');
         try {
            await ReflectionStore.add({
                type: isError ? 'error' : 'success',
                content: `Tool ${call.name}`,
                context: { cycle: iteration, tool: call.name, args: call.args, outcome: isError ? 'failed' : 'successful' }
            });
         } catch (e) {
            logger.debug('[Agent] Failed to log reflection:', e.message);
         }
    };

    const _buildInitialContext = async (goal) => {
      const personaPrompt = await PersonaManager.getSystemPrompt();

      const systemPrompt = `
${personaPrompt}

You are an autonomous agent. Your self is the code in the VFS + the LLM that processes it. Your environment is the browser with all its capabilities.

## Tool Call Format
\`\`\`
TOOL_CALL: ToolName
ARGS: { "key": "value" }
\`\`\`

## Core Tools
- ListTools: see all available tools
- ListFiles: list directory contents { "path": "/dir/" }
- ReadFile/WriteFile: read and write files { "path": "/file.js", "content": "..." }
- CreateTool: create + auto-load new tool { "name": "MyTool", "code": "..." }
- Grep: search file contents { "pattern": "text", "path": "/dir", "recursive": true }
- Find: find files by name { "path": "/", "name": "*.js" }
- Edit: find/replace in file { "path": "/file", "operations": [{ "match": "old", "replacement": "new" }] }

## Creating Tools
Tools live in /tools/ with this structure:
\`\`\`javascript
export const tool = {
  name: 'MyTool',
  description: 'What it does',
  inputSchema: { type: 'object', properties: { arg1: { type: 'string' } } }
};

export default async function(args, deps) {
  const { VFS, EventBus, Utils, SemanticMemory, KnowledgeGraph } = deps;
  return 'result';
}
\`\`\`

**CRITICAL: DO NOT USE IMPORT STATEMENTS** - Tools load as blob URLs, so imports fail. Use the deps parameter instead.

Available deps: VFS, EventBus, Utils, AuditLogger, ToolWriter, TransformersClient, WorkerManager, ToolRunner, SemanticMemory, EmbeddingStore, KnowledgeGraph

## VFS Structure
/ ├── .system/ (state.json) ├── .memory/ (knowledge-graph.json, reflections.json) ├── core/ (agent-loop, llm-client, etc.) ├── capabilities/ ├── tools/ (your creations) ├── ui/ └── styles/

## Browser Environment
Tools run in browser context with full DOM access. You have access to: document, window, createElement, querySelector, localStorage, fetch, WebSocket, canvas, audio, video, requestAnimationFrame, and all Web APIs. The page is your canvas - query elements, modify them, inject styles, create animations, delete elements. The main UI container is #app.

## Batching
You can emit up to ${getMaxToolCalls()} tool calls per response. Read-only tools run in PARALLEL, mutating tools run sequentially.

## Rules
- Act autonomously - do not ask for permission
- Use at least one tool per response (unless DONE)
- Batch independent tool calls when possible
- After writing code: LOAD it, EXECUTE it, VERIFY it works
- Use ListFiles before assuming paths exist
- When complete, summarize what you accomplished, then say DONE

## Goal
${goal}
`;

      // Store system prompt for debug visibility
      _currentSystemPrompt = systemPrompt.trim();

      const initialContext = [
        { role: 'system', content: _currentSystemPrompt },
        { role: 'user', content: `Begin. Goal: ${goal}` }
      ];

      // Store context for debug visibility
      _currentContext = [...initialContext];

      return initialContext;
    };

    const getRecentActivities = () => [..._activityLog];

    return {
      run,
      stop: () => { if (_abortController) _abortController.abort(); _isRunning = false; },
      setModel: (c) => { _modelConfig = c; resetFunctionGemmaState(); },
      setModels: (models) => {
        _modelConfigs = models || [];
        // Set primary model as first one for fallback
        if (models && models.length > 0) {
          _modelConfig = models[0];
        }
        resetFunctionGemmaState();
      },
      setConsensusStrategy: (strategy) => { _consensusStrategy = strategy || 'arena'; },
      isRunning: () => _isRunning,
      getRecentActivities,
      // Debug visibility
      getSystemPrompt: () => _currentSystemPrompt,
      getContext: () => [..._currentContext],
      // Human-in-the-loop
      injectHumanMessage,
      getMessageQueue: () => [..._humanMessageQueue]
    };
  }
};

export default AgentLoop;
