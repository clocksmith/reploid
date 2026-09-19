import { isTransientProviderFailure, providerRetryDelay } from './provider-recovery.js';
import { createExecutionEngine } from './engine.js';
import { TURN_NEXT, TURN_STOP, TURN_RETURN } from './engine.js';
/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

import { createCycleArtifactWriter } from './cycle-artifacts.js';
import { requireResolvedConfig, freezeJson } from '../config/index.js';

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '1.2.0', // MemoryManager integration
    genesis: { introduced: 'capsule' },
    dependencies: [
      'Utils', 'EventBus', 'VFS?', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'CircuitBreaker', 'SchemaRegistry',
      'ToolExecutor',
      'ReflectionStore?', 'ReflectionAnalyzer?', 'CognitionAPI?', 'MultiModelCoordinator?', 'FunctionGemmaOrchestrator?', 'TraceStore?',
      'MemoryManager?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    let policy = requireResolvedConfig(deps.config);
    const engine = createExecutionEngine({ onEvent: deps.onExecutionEvent });
    let closed = false, activeAttempt = null, runtimeMode = null;
    if (!deps.Storage || typeof deps.getRuntimeMode !== 'function' || typeof deps.buildInitialContext !== 'function' || !deps.Policies) {
      throw new TypeError('Legacy agent requires explicit storage, mode, prompt and policy ports');
    }
    const getReploidStorage = () => deps.Storage;
    const {
  MANAGED_SERVER_PROXY_REJECT_STATUSES,
  TRANSIENT_PROVIDER_STATUSES,
  compactContextForManagedProvider,
  getModelIterationLimit,
  getProviderErrorStatus,
  getProviderRetryAfterMs,
  getToolSchemaName,
  isManagedServerProxyModel,
  measureContextChars,
  parseWaitDirective,
  renderModelContextForTrace,
  resolveAgentCycleIntervalMs,
  resolveProviderThrottleConfig,
  stringifyMessageContent
} = deps.Policies;
    const subscriptions = [];
    const borrowedEvents = deps.EventBus;
    deps = { ...deps, EventBus: { ...borrowedEvents, on(...args) {
      const unsubscribe = borrowedEvents.on(...args);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    } } };
    const {
      Utils, EventBus, VFS, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, CircuitBreaker, SchemaRegistry, ToolExecutor,
      ReflectionStore, ReflectionAnalyzer, CognitionAPI, MultiModelCoordinator, FunctionGemmaOrchestrator, TraceStore,
      MemoryManager
    } = deps;

    const { logger, Errors } = Utils;
    const BUILD_READ_ONLY_DISCOVERY_LIMIT = policy.legacyAgent.discoveryLimit;
    const DEFAULT_MAX_TOOL_CALLS = policy.legacyAgent.maxToolCalls;

    const getMaxToolCalls = () => policy.legacyAgent.maxToolCalls;
    const getProviderThrottleConfig = (model = _modelConfig) => resolveProviderThrottleConfig([
      model?.agentThrottle, model?.providerThrottle, model?.throttle?.provider,
      policy.legacyAgent.settings?.providerThrottle
    ]);

    const sleepWithAbort = delayMs => engine.delay(Math.max(0, Math.floor(Number(delayMs) || 0)));

    const getConfiguredMaxIterations = () =>
      getModelIterationLimit(_modelConfig || _modelConfigs[0]);

    const isBuildGoal = (goalText = '') => /\b(build|create|make|implement|write|edit|modify|update|fix|patch|add|inject|stage|load|promote)\b/i
      .test(String(goalText || ''));

    const filterToolSchemasForMutation = (schemas = []) =>
      schemas.filter((schema) => {
        const name = getToolSchemaName(schema);
        return name && !isReadOnlyTool(name);
      });

    const messageSignature = (message = {}) =>
      `${message?.role || 'unknown'}\u0000${stringifyMessageContent(message?.content)}`;

    const getModelRequestDelta = (messages = []) => {
      const previous = _lastModelRequestSnapshot || [];
      let delta = messages;
      let mode = previous.length > 0 ? 'delta' : 'initial';

      if (previous.length > 0) {
        let prefix = 0;
        while (
          prefix < previous.length
          && prefix < messages.length
          && messageSignature(previous[prefix]) === messageSignature(messages[prefix])
        ) {
          prefix++;
        }
        delta = messages.slice(prefix);

        if (prefix === 0) {
          const lastPrevious = messageSignature(previous[previous.length - 1]);
          const matchingIndex = messages.findIndex((message) => messageSignature(message) === lastPrevious);
          if (matchingIndex >= 0) {
            delta = messages.slice(matchingIndex + 1);
          } else {
            delta = messages.slice(-4);
            mode = 'envelope changed';
          }
        }
      }

      _lastModelRequestSnapshot = messages.map((message) => ({ ...message }));
      return {
        contextDeltaMessages: delta.map((message) => ({ ...message })),
        contextDeltaCount: delta.length,
        contextDeltaChars: measureContextChars(delta),
        contextDeltaMode: mode
      };
    };

    // Use SchemaRegistry for read-only tool detection (no longer hardcoded)
    const isReadOnlyTool = (name) => {
      if (SchemaRegistry?.isToolReadOnly) {
        return SchemaRegistry.isToolReadOnly(name);
      }
      // Fallback if SchemaRegistry not available
      const FALLBACK_READ_ONLY = ['ReadFile', 'ListFiles', 'Grep', 'Find', 'Head', 'Tail', 'FileOutline', 'ListTools'];
      return FALLBACK_READ_ONLY.includes(name);
    };

    const getAgentCycleIntervalMs = () => policy.legacyAgent.settings?.cycleIntervalMs ?? 0;

    const waitForCycleInterval = async (nextIteration) => {
      if (nextIteration <= 1) return;
      const delayMs = getAgentCycleIntervalMs(_modelConfig);
      if (delayMs <= 0) return;
      const previousCycle = nextIteration - 1;
      EventBus.emit('agent:status', {
        state: 'WAITING',
        activity: `Waiting ${Math.ceil(delayMs / 1000)}s before cycle ${nextIteration}`,
        cycle: previousCycle,
        cycleThrottleDelayMs: delayMs,
        nextCycle: nextIteration
      });
      EventBus.emit('agent:history', {
        type: 'cycle_throttle',
        cycle: previousCycle,
        content: `Waiting ${Math.ceil(delayMs / 1000)}s before cycle ${nextIteration}`,
        throttleDelayMs: delayMs,
        nextCycle: nextIteration,
        ts: Date.now()
      });
      _pushActivity({
        kind: 'cycle_throttle',
        cycle: previousCycle,
        throttleDelayMs: delayMs,
        nextCycle: nextIteration
      });
      await sleepWithAbort(delayMs, _abortController?.signal);
    };

    const resolveFunctionGemmaConfig = () => {
      if (!FunctionGemmaOrchestrator) return null;
      const candidates = [
        _modelConfig?.functionGemma,
        _modelConfig?.functionGemmaConfig,
        policy.legacyAgent.settings?.functionGemma
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
    const SINGLE_TOOL_NUDGE_THRESHOLD = 1; // Nudge after every single-tool iteration
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
    let _lastModelRequestSnapshot = [];
    let _traceSessionId = null;
    let _providerResumeState = null;
    let _providerResumePromise = null;
    let _lastProviderRequestAt = null;

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
    const RECOVERABLE_TOOL_INPUT_ERROR_PATTERNS = [
      /^File not found:/i,
      /^Missing .+ argument/i,
      /^Invalid argument line:/i,
      /^Invalid (backend|mode|offset|length)/i,
      /^Path traversal is not allowed/i,
      /^OPFS path not allowed:/i,
      /^VFS supports text mode only/i,
      /^offset\/length are only supported/i,
      /^Read range exceeds file size/i,
      /^Read length exceeds maxBytes/i,
      /^maxBytes /i,
      /^File too large/i,
      /^Unsupported VFS entry type/i,
      /^Tool not found:/i,
      /^Tool '.+' not permitted/i,
      /^Policy violation:/i,
      /^Operation rejected by user/i
    ];

    const isRecoverableToolInputError = (error) => {
      const message = String(error?.message || error || '');
      return RECOVERABLE_TOOL_INPUT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
    };

    const isRecoverableToolPreconditionError = (call = {}, error) => {
      const name = String(call?.name || '');
      const message = String(error?.message || error || '');
      if (name !== 'LoadModule') return false;
      return (
        /^LoadModule only supports promoted \/self paths/i.test(message)
        || /^Tool module has a leading pipe literal marker/i.test(message)
      );
    };

    const sanitizeRecoveredVfsPath = (value) => {
      const path = String(value || '').trim();
      if (!path.startsWith('/')) return null;
      if (path.split('/').includes('..')) return null;
      if (/[\s"'`<>]/.test(path)) return null;
      return path.replace(/\/+$/, '') || '/';
    };

    const getRecoveryCallFromToolError = (call, error) => {
      if (!call || !isReadOnlyTool(call.name)) return null;
      const message = String(error?.message || error || '');
      if (call.name === 'ReadFile') {
        const match = message.match(/Retry with ReadFile path:\s+(\S+)\./);
        const suggestedPath = sanitizeRecoveredVfsPath(match?.[1]);
        const currentPath = sanitizeRecoveredVfsPath(call.args?.path || call.args?.file);
        if (!suggestedPath || suggestedPath === currentPath) return null;
        return {
          name: 'ReadFile',
          args: {
            ...(call.args || {}),
            path: suggestedPath
          },
          reason: 'near_miss_path'
        };
      }
      return null;
    };

    const _recordToolExecutionError = (call, error, iteration) => {
      const message = error?.message || String(error);
      EventBus.emit('tool:error', { tool: call.name, error: message, cycle: iteration });
      if (isRecoverableToolInputError(error) || isRecoverableToolPreconditionError(call, error)) {
        EventBus.emit('tool:input_error', { tool: call.name, error: message, cycle: iteration });
        return;
      }
      _toolCircuitBreaker.recordFailure(call.name, error);
    };

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

    const findConfiguredModel = (modelId) => {
      const id = String(modelId || '');
      const all = [_modelConfig, ..._modelConfigs].filter(Boolean);
      return all.find((model) => (
        String(model.id || model.model || model.modelId || '') === id
      )) || _modelConfig || all[0] || null;
    };

    const getModelIdentity = (model = {}) => (
      String(model.id || model.model || model.modelId || model.name || '')
    );

    const isTransientProviderError = isTransientProviderFailure;

    const isManagedProviderRequestError = (error) => {
      const status = getProviderErrorStatus(error);
      return MANAGED_SERVER_PROXY_REJECT_STATUSES.has(status)
        && isManagedServerProxyModel(_modelConfig || _modelConfigs[0]);
    };

    const clampProviderBackoffMs = (value, model) => {
      const config = getProviderThrottleConfig(model);
      return Math.min(
        config.providerBackoffMaxMs,
        Math.max(0, Math.floor(Number(value) || 0))
      );
    };

    const computeProviderBackoffMs = (attempt, error, model = _modelConfig) => {
      const config = getProviderThrottleConfig(model);
      return providerRetryDelay(error, { attempt, baseMs: config.providerBackoffBaseMs,
        maxMs: config.providerBackoffMaxMs, jitterRatio: config.providerBackoffJitterRatio });
    };

    const applyProviderRequestThrottle = async (model, iteration) => {
      const config = getProviderThrottleConfig(model);
      const intervalMs = config.minProviderRequestIntervalMs;
      const now = Date.now();
      const delayMs = _lastProviderRequestAt !== null
        ? Math.max(0, intervalMs - (now - _lastProviderRequestAt))
        : 0;

      if (delayMs > 0) {
        const retryAt = now + delayMs;
        const modelId = getModelIdentity(model) || 'unknown';
        EventBus.emit('agent:history', {
          type: 'provider_throttle',
          cycle: iteration,
          model: modelId,
          provider: model?.provider || null,
          throttleDelayMs: delayMs,
          retryAt,
          ts: now
        });
        EventBus.emit('agent:status', {
          state: 'WAITING',
          activity: 'Provider throttle',
          cycle: iteration,
          throttleDelayMs: delayMs,
          retryAt
        });
        _pushActivity({
          kind: 'provider_throttle',
          cycle: iteration,
          model: modelId,
          provider: model?.provider || null,
          throttleDelayMs: delayMs,
          retryAt
        });
        await sleepWithAbort(delayMs, _abortController?.signal);
      }

      _lastProviderRequestAt = Date.now();
    };

    const chatWithProviderThrottle = async (context, model, streamCallback, options, iteration) => {
      await applyProviderRequestThrottle(model, iteration);
      const signal = _abortController.signal;
      return LLMClient.chat(context, model, chunk => {
        if (!signal.aborted && !closed) streamCallback?.(chunk);
      }, { ...options, signal });
    };

    const getProviderRecoveryCandidates = (primaryModel) => {
      const candidates = [];
      const add = (model) => {
        if (!model) return;
        const key = `${model.provider || ''}:${getModelIdentity(model)}`;
        if (!key || candidates.some((entry) => entry.key === key)) return;
        candidates.push({ key, model });
      };
      add(primaryModel || _modelConfig || _modelConfigs[0]);
      _modelConfigs.forEach(add);
      if (_modelConfig) add(_modelConfig);
      return candidates.map((entry) => entry.model);
    };

    const chatWithProviderRecovery = async ({
      context,
      primaryModel,
      streamCallback = null,
      toolSchemas = [],
      iteration = 0
    }) => {
      const candidates = getProviderRecoveryCandidates(primaryModel);
      const failedModels = [];
      const { response, model } = await engine.generate({ candidates,
        request: model => chatWithProviderThrottle(context, model, streamCallback, { tools: toolSchemas }, iteration),
        onSuccess: (model, index) => {
          if (index === 0) return;
          const recoveredModel = getModelIdentity(model) || 'unknown';
          EventBus.emit('llm:provider_recovered', { cycle: iteration, model: recoveredModel,
            provider: model.provider || null, failedModels });
          EventBus.emit('agent:warning', { type: 'provider_recovered', cycle: iteration,
            model: recoveredModel, provider: model.provider || null });
          _pushActivity({ kind: 'provider_recovered', cycle: iteration,
            model: recoveredModel, provider: model.provider || null });
          _modelConfig = model;
        },
        onFailure: (error, model, index, retrying) => {
          const status = getProviderErrorStatus(error);
          const modelId = getModelIdentity(model) || 'unknown';
          failedModels.push({ model: modelId, provider: model.provider || null,
            status, error: error?.message || String(error) });
          if (!retrying) return;
          logger.warn(`[Agent] Provider ${modelId} returned transient status ${status}; trying alternate model.`);
          EventBus.emit('agent:warning', { type: 'provider_retry', cycle: iteration,
            model: modelId, provider: model.provider || null, status, error: error?.message || String(error) });
          EventBus.emit('llm:provider_retry', { cycle: iteration, model: modelId,
            provider: model.provider || null, status });
        }
      });
      return { response, modelConfig: model };
    };

    const buildModelUsed = ({ response = {}, modelId = null, provider = null, latencyMs = null } = {}) => {
      const id = response.model || modelId || null;
      const configured = findConfiguredModel(id);
      const resolvedId = id || configured?.id || configured?.model || configured?.modelId || null;
      const resolvedProvider = response.provider || provider || configured?.provider || null;
      const name = configured?.name || configured?.label || resolvedId || 'unknown';
      const label = resolvedProvider
        ? `${resolvedProvider}/${name}`
        : name;
      return {
        id: resolvedId,
        name,
        label,
        provider: resolvedProvider,
        serverType: configured?.serverType || null,
        connectionType: configured?.connectionType || configured?.mode || null,
        endpoint: configured?.endpoint || null,
        usage: response.usage || null,
        latencyMs
      };
    };

    const cycleArtifacts = createCycleArtifactWriter({ VFS, EventBus, logger });
    const _writeCycleArtifact = (iteration, name, payload = {}) => (
      cycleArtifacts.writeCycleArtifact(iteration, name, payload)
    );
    const _writeCycleOutcomeArtifacts = (payload) => (
      cycleArtifacts.writeCycleOutcomeArtifacts(payload)
    );

    const _executeTool = async (call, iteration) => {
      if (!ToolExecutor) {
        throw new Errors.ConfigError('ToolExecutor not available');
      }
      try {
      const outcome = await engine.tool({
        call, policy, listToolNames: () => ToolRunner.list?.() || [],
        authorize: deps.authorizeTool,
        retry: { maxRetries: ToolExecutor.DEFAULT_MAX_RETRIES ?? 2, delayMs: 100 },
        execute: async (name, args, control) => {
          const execution = await ToolExecutor.executeWithRetry({ ...call, name, args }, {
          ...control, maxRetries: 0, invoke: engine.invoke, timeoutMs: TOOL_EXECUTION_TIMEOUT_MS, iteration,
          trace: _traceSessionId ? { sessionId: _traceSessionId, source: 'agent' } : null
          });
          if (execution.error) throw execution.error;
          return execution;
        }
      });
      if (outcome.status !== 'completed') throw outcome.error;
      return outcome.value;
      } catch (error) {
        if (_abortController?.signal.aborted) throw error;
        return { result: null, rawResult: null, error, duration: 0 };
      }
    };

    const parsePossibleJsonResult = (result) => {
      if (result && typeof result === 'object') return result;
      if (typeof result !== 'string') return null;
      const text = result.trim();
      if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const getLogicalToolResult = (entryOrResult) => {
      if (entryOrResult && typeof entryOrResult === 'object' && 'rawResult' in entryOrResult) {
        return entryOrResult.rawResult ?? parsePossibleJsonResult(entryOrResult.result) ?? entryOrResult.result;
      }
      return entryOrResult ?? null;
    };

    const getDirectLogicalFailureReasons = (logical) => {
      if (!logical || typeof logical !== 'object') return [];
      if (!(logical.ok === false || logical.success === false)) return [];
      if (Array.isArray(logical.reasons) && logical.reasons.length > 0) {
        return logical.reasons.map((reason) => String(reason));
      }
      if (typeof logical.error === 'string' && logical.error) return [logical.error];
      if (typeof logical.message === 'string' && logical.message) return [logical.message];
      return ['tool reported unsuccessful result'];
    };

    const getWorkerToolLogicalResult = (entry = {}) => (
      entry.rawResult
      ?? parsePossibleJsonResult(entry.result)
      ?? entry.result
      ?? null
    );

    const getWorkerResultPayload = (entry = {}) => (
      entry.value
      ?? entry.result
      ?? entry
    );

    const getWorkerLogicalFailureReasons = (logical) => {
      if (!logical || typeof logical !== 'object') return [];
      if (!Array.isArray(logical.results) || !('awaited' in logical || 'timedOut' in logical)) return [];

      const reasons = [];
      for (const workerEntry of logical.results) {
        const workerId = workerEntry?.workerId || 'worker';
        if (workerEntry?.status === 'rejected' || workerEntry?.status === 'error') {
          reasons.push(`${workerId}: ${workerEntry.error || 'worker failed'}`);
          continue;
        }

        const workerResult = getWorkerResultPayload(workerEntry);
        if (workerResult?.status === 'error') {
          reasons.push(`${workerId}: ${workerResult.error || 'worker failed'}`);
        }
        for (const reason of getDirectLogicalFailureReasons(workerResult)) {
          reasons.push(`${workerId}: ${reason}`);
        }

        const toolResults = Array.isArray(workerResult?.toolResults) ? workerResult.toolResults : [];
        for (const toolEntry of toolResults) {
          const toolName = toolEntry?.tool || toolEntry?.name || 'worker tool';
          const logicalToolResult = getWorkerToolLogicalResult(toolEntry);
          const toolReasons = getDirectLogicalFailureReasons(logicalToolResult);
          if (toolReasons.length > 0) {
            reasons.push(`${workerId}/${toolName}: ${toolReasons.join('; ')}`);
          } else if (toolEntry?.success === false || toolEntry?.ok === false) {
            reasons.push(`${workerId}/${toolName}: ${toolEntry.error || 'tool reported unsuccessful result'}`);
          }
        }
      }
      return reasons;
    };

    const getLogicalToolFailureReasons = (result) => {
      const logical = getLogicalToolResult(result);
      return [
        ...getDirectLogicalFailureReasons(logical),
        ...getWorkerLogicalFailureReasons(logical)
      ];
    };

    const isLogicalToolFailureResult = (result) => {
      return getLogicalToolFailureReasons(result).length > 0;
    };

    const handleSuccessfulToolResult = (call, result) => {
      _toolCircuitBreaker.recordSuccess(call.name);
      if (call.name === 'Promote' && result?.ok === true && result?.promoted === true) {
        // A previous LoadModule failure may have been caused by the target not existing yet.
        // Once Promote succeeds, clear that stale precondition failure for the next cycle.
        _toolCircuitBreaker.recordSuccess('LoadModule');
      }
    };

    const _recordLogicalToolFailure = (call, result, iteration) => {
      const reasons = getLogicalToolFailureReasons(result).join('; ') || 'tool reported unsuccessful result';
      _recordToolExecutionError(call, new Error(reasons), iteration);
    };

    const _executeToolWithRecovery = async (call, iteration) => {
      const first = await _executeTool(call, iteration);
      if (!first.error || first.result) {
        const logicalResult = getLogicalToolResult(first);
        if (!first.error && !isLogicalToolFailureResult(logicalResult)) {
          handleSuccessfulToolResult(call, logicalResult);
        } else if (!first.error && isLogicalToolFailureResult(logicalResult)) {
          _recordLogicalToolFailure(call, logicalResult, iteration);
        }
        return {
          call,
          finalResult: first.result,
          result: logicalResult,
          rawResult: first.rawResult,
          duration: first.duration
        };
      }

      const recoveryCall = getRecoveryCallFromToolError(call, first.error);
      if (recoveryCall) {
        const message = first.error?.message || String(first.error);
        logger.warn(`[Agent] Recovering ${call.name} from tool hint: ${message}`);
        EventBus.emit('tool:recovery', {
          tool: call.name,
          args: call.args || {},
          recoveryTool: recoveryCall.name,
          recoveryArgs: recoveryCall.args || {},
          reason: recoveryCall.reason,
          error: message,
          cycle: iteration
        });
        _pushActivity({
          kind: 'tool_recovery',
          cycle: iteration,
          tool: call.name,
          args: call.args || {},
          recoveryTool: recoveryCall.name,
          recoveryArgs: recoveryCall.args || {},
          reason: recoveryCall.reason,
          error: message
        });

        const recovered = await _executeTool(recoveryCall, iteration);
        if (!recovered.error || recovered.result) {
          const logicalResult = getLogicalToolResult(recovered);
          if (!recovered.error && !isLogicalToolFailureResult(logicalResult)) {
            handleSuccessfulToolResult(recoveryCall, logicalResult);
          } else if (!recovered.error && isLogicalToolFailureResult(logicalResult)) {
            _recordLogicalToolFailure(recoveryCall, logicalResult, iteration);
          }
          return {
            call: recoveryCall,
            finalResult: recovered.result,
            result: logicalResult,
            rawResult: recovered.rawResult,
            duration: recovered.duration,
            recoveredFrom: call,
            recovery: recoveryCall
          };
        }

        logger.error(`[Agent] Tool Recovery Error: ${recoveryCall.name}`, recovered.error);
        _recordToolExecutionError(recoveryCall, recovered.error, iteration);
        return {
          call: recoveryCall,
          finalResult: `Error: ${recovered.error.message}`,
          result: getLogicalToolResult(recovered),
          rawResult: recovered.rawResult,
          duration: recovered.duration,
          recoveredFrom: call,
          recovery: recoveryCall
        };
      }

      logger.error(`[Agent] Tool Error: ${call.name}`, first.error);
      _recordToolExecutionError(call, first.error, iteration);
      return {
        call,
        finalResult: `Error: ${first.error.message}`,
        result: getLogicalToolResult(first),
        rawResult: first.rawResult,
        duration: first.duration
      };
    };

    const getToolExecutionFailureReason = (entry) => {
      if (!entry) return null;
      if (entry.errorKind === 'parse_error') {
        return `Parse error before execution: ${entry.call?.error || 'Invalid tool arguments'}`;
      }
      if (typeof entry.finalResult === 'string' && entry.finalResult.startsWith('Error:')) {
        return entry.finalResult;
      }
      const result = getLogicalToolResult(entry) ?? entry.finalResult;
      if (isLogicalToolFailureResult(result)) {
        const reasons = getLogicalToolFailureReasons(result).join('; ') || 'tool reported unsuccessful result';
        return `Error: ${entry.call?.name || 'Tool'} failed: ${reasons}`;
      }
      return null;
    };

    const isToolExecutionFailure = (entry) => !!getToolExecutionFailureReason(entry);

    const summarizeToolResultForBatch = (value) => {
      const text = stringifyMessageContent(value);
      return text.length > 800
        ? `${text.slice(0, 800)}\n... [result preview truncated]`
        : text;
    };

    const formatToolCallParseErrorResult = (call = {}) => {
      const argsPreview = call.args && Object.keys(call.args).length > 0
        ? stringifyMessageContent(call.args)
        : '';
      const lines = [
        'TOOL_CALL_PARSE_ERROR',
        `Tool: ${call.name || 'Tool'}`,
        `Error: ${call.error || 'Invalid tool argument JSON'}`,
        'Status: tool was not executed.',
        'Next action: retry the intended operation with one valid JSON argument object that matches the tool schema.',
        'Keep commentary outside the argument object. Do not add evidence/protocol keys unless the schema requires them.'
      ];
      if (argsPreview) {
        lines.push(`Parsed args preview: ${argsPreview.slice(0, 500)}`);
      }
      return lines.join('\n');
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
          const summaryResponse = await chatWithProviderThrottle(context, _modelConfig, null, undefined, iteration);
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
    const _processToolResult = (call, result, iteration, context, duration, modelUsed = null) => {
      // Smart truncation
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      let processedResult = resultStr;
      if (resultStr.length > 5000 && call.name !== 'ReadFile') {
        processedResult = resultStr.substring(0, 5000) + "\n... [OUTPUT TRUNCATED. USE FileOutline OR ReadFile FOR DETAILS] ...";
      }

      context.push({
        role: 'user',
        content: `TOOL_RESULT (${call.name}):\n${processedResult}`
      });

      EventBus.emit('agent:history', {
        type: 'tool_result',
        cycle: iteration,
        model: modelUsed?.id || null,
        provider: modelUsed?.provider || null,
        modelLabel: modelUsed?.label || null,
        modelUsed,
        tool: call.name,
        args: call.args,
        result: processedResult,
        durationMs: duration ?? null
      });
      _pushActivity({ kind: 'tool_result', cycle: iteration, modelUsed, tool: call.name, args: call.args, result: processedResult });
      _logReflection(call, processedResult, iteration);
    };

    const clearProviderResumeTimer = () => {
      engine.cancelRetry();
      _providerResumeState = null;
    };

    const scheduleProviderResume = (resumeState, delayMs) => {
      clearProviderResumeTimer();

      const retryAt = Date.now() + delayMs;
      _providerResumeState = {
        ...resumeState,
        delayMs,
        retryAt
      };

      engine.scheduleRetry(delayMs, () => {
        const state = _providerResumeState;
        _providerResumeState = null;

        if (!state || _isRunning) return;
        const resumeKind = state.resumeKind || 'provider';
        const resumeType = resumeKind === 'tool_cooldown' ? 'tool_cooldown_resume' : 'provider_resume';
        EventBus.emit('agent:history', {
          type: resumeType,
          cycle: state.iteration,
          attempt: state.providerRetryAttempt,
          content: state.resumeContent || 'Resuming after provider backoff',
          ts: Date.now()
        });
        EventBus.emit('agent:status', {
          state: 'RESUMING',
          activity: state.resumeActivity || 'Retrying provider request',
          cycle: state.iteration,
          retryAttempt: state.providerRetryAttempt
        });
        _pushActivity({
          kind: resumeType,
          cycle: state.iteration,
          attempt: state.providerRetryAttempt
        });

        _providerResumePromise = startRun(state.goal, state).catch((error) => {
          logger.error('[Agent] Provider resume failed:', error);
          EventBus.emit('agent:error', {
            error: error?.message || String(error),
            cycle: state.iteration
          });
        });
      });
    };

    const runAttempt = async (goal, resumeState, signal) => {
      if (_isRunning) throw new Errors.StateError('Agent already running');
      if (!_modelConfig) throw new Errors.ConfigError('No model configured');

      const isResume = !!resumeState;
      if (!isResume) {
        clearProviderResumeTimer();
      }

      _isRunning = true;
      _abortController = { signal, abort: reason => engine.cancel(reason) };
      if (!isResume) {
        _resetLoopHealth();
        _toolCircuitBreaker.reset();
        _lastModelRequestSnapshot = [];
      }

      logger.info(`[Agent] ${isResume ? 'Resuming' : 'Starting'} cycle. Goal: "${goal}"`);
      EventBus.emit('agent:status', {
        state: isResume ? 'RESUMING' : 'STARTING',
        activity: isResume ? 'Resuming after provider backoff' : 'Initializing...',
        cycle: resumeState?.iteration ?? 0
      });

      if (!isResume) {
        await StateManager.setGoal(goal);
      }
      if (TraceStore) {
        _traceSessionId = await TraceStore.startSession({
          source: 'agent',
          goal,
          modelId: _modelConfig?.id || null,
          resumedFromProviderBackoff: isResume,
          resumeAttempt: resumeState?.providerRetryAttempt ?? 0
        });
      }

      // Initialize MemoryManager for this session
      if (MemoryManager && !isResume) {
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

      let context = isResume && Array.isArray(resumeState.context)
        ? resumeState.context.map((entry) => ({ ...entry }))
        : await _buildInitialContext(goal);
      if (!isResume) {
        EventBus.emit('agent:history', {
          type: 'system_prompt',
          cycle: 0,
          content: _currentSystemPrompt
        });
        _pushActivity({ kind: 'system_prompt', cycle: 0, content: _currentSystemPrompt });
      }
      let iteration = Number.isFinite(Number(resumeState?.iteration))
        ? Math.max(0, Math.floor(Number(resumeState.iteration)))
        : 0;
      const maxIterations = getConfiguredMaxIterations();
      const functionGemmaConfig = resolveFunctionGemmaConfig();
      let functionGemmaEnabled = !!functionGemmaConfig;
      let providerParked = false;
      let providerParkReason = null;
      let scheduledProviderResume = false;
      let providerRetryAttempt = Math.max(0, Math.floor(Number(resumeState?.providerRetryAttempt) || 0));
      let consecutiveReadOnlyBuildBatches = Math.max(0, Math.floor(Number(resumeState?.consecutiveReadOnlyBuildBatches) || 0));
      let mutationGateAnnounced = consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;
      const buildGoal = isBuildGoal(goal);
      if (functionGemmaEnabled) {
        functionGemmaEnabled = await ensureFunctionGemmaReady(context, functionGemmaConfig);
      }

      // Update tracked context after initialization
      _currentContext = [...context];

      try {
        if (await engine.turns({ canContinue: () => _isRunning && iteration < maxIterations, turn: async () => {
          if (_abortController.signal.aborted) return TURN_STOP;

          await waitForCycleInterval(iteration + 1);
          if (_abortController.signal.aborted) return TURN_STOP;

          iteration++;
          await StateManager.incrementCycle();
          logger.info(`[Agent] Iteration ${iteration}`);
          const stateBefore = iteration === 1 ? 'Seed' : 'Shadow';
          await _writeCycleArtifact(iteration, 'input.json', {
            stateBefore,
            event: 'cycle:start',
            goal,
            model: _modelConfig?.id || null,
            provider: _modelConfig?.provider || null,
            contextLength: context.length,
            contextPreview: context.slice(-5)
          });

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
          if (contextResult.compacted) {
            const compactionContent = `Context compacted: ${contextResult.previousTokens}->${contextResult.newTokens} tokens`;
            EventBus.emit('agent:history', {
              type: 'context_compacted',
              cycle: iteration,
              content: compactionContent,
              previousTokens: contextResult.previousTokens,
              newTokens: contextResult.newTokens,
              ts: Date.now()
            });
            _pushActivity({
              kind: 'context_compacted',
              cycle: iteration,
              previousTokens: contextResult.previousTokens,
              newTokens: contextResult.newTokens
            });
            if (MemoryManager?.onContextCompacted) {
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

                  EventBus.emit('memory:retrieval_block', {
                    cycle: iteration,
                    query: lastUserMsg.content.slice(0, 120),
                    totalTokens: Math.ceil(memoryContext.length / 4),
                    contextItems: relevant.length,
                    block: memoryContext,
                    ts: Date.now()
                  });
                }
              }
            } catch (e) {
              logger.debug('[Agent] MemoryManager retrieval skipped:', e.message);
            }
          }

          const envelopeResult = compactContextForManagedProvider(context, _modelConfig || _modelConfigs[0]);
          if (envelopeResult.changed) {
            context = envelopeResult.context;
            _syncContext(context);
            EventBus.emit('agent:history', {
              type: 'provider_context_envelope',
              cycle: iteration,
              content: `Prepared provider request envelope: ${envelopeResult.previousMessages}->${envelopeResult.newMessages} messages, ${envelopeResult.previousChars}->${envelopeResult.newChars} chars`,
              previousMessages: envelopeResult.previousMessages,
              newMessages: envelopeResult.newMessages,
              previousChars: envelopeResult.previousChars,
              newChars: envelopeResult.newChars,
              ts: Date.now()
            });
            _pushActivity({
              kind: 'provider_context_envelope',
              cycle: iteration,
              previousMessages: envelopeResult.previousMessages,
              newMessages: envelopeResult.newMessages,
              previousChars: envelopeResult.previousChars,
              newChars: envelopeResult.newChars
            });
          }

          let llmResponseText = '';
          const streamCallback = (text) => {
            EventBus.emit('agent:stream', text);
            llmResponseText += text;
          };

          // Get tool schemas for native tool calling (if supported)
          const toolSchemas = ToolRunner.getToolSchemas ? ToolRunner.getToolSchemas() : [];
          const mutationGateActive = buildGoal && consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;
          const activeToolSchemas = mutationGateActive
            ? filterToolSchemasForMutation(toolSchemas)
            : toolSchemas;
          if (mutationGateActive && !mutationGateAnnounced) {
            const gateMsg = `BUILD PROGRESS GATE: ${consecutiveReadOnlyBuildBatches} read-only discovery batches completed. The next response must stage or change something with ${getMutationProgressToolList()}, or say DONE with a concrete blocker.`;
            context.push({ role: 'user', content: gateMsg });
            _syncContext(context);
            EventBus.emit('agent:history', {
              type: 'build_progress_gate',
              cycle: iteration,
              content: gateMsg,
              consecutiveReadOnlyBatches: consecutiveReadOnlyBuildBatches,
              ts: Date.now()
            });
            _pushActivity({
              kind: 'build_progress_gate',
              cycle: iteration,
              consecutiveReadOnlyBatches: consecutiveReadOnlyBuildBatches
            });
            mutationGateAnnounced = true;
          }

          const providerInputChars = measureContextChars(context);
          const offeredToolNames = activeToolSchemas
            .map((schema) => getToolSchemaName(schema))
            .filter(Boolean);
          const requestModel = _modelConfig || _modelConfigs[0] || null;
          const modelRequestContent = renderModelContextForTrace(context, activeToolSchemas);
          const modelRequestDelta = getModelRequestDelta(context);
          EventBus.emit('agent:history', {
            type: 'model_request',
            cycle: iteration,
            content: modelRequestContent,
            messageCount: context.length,
            inputChars: providerInputChars,
            toolNames: offeredToolNames,
            model: requestModel?.id || null,
            provider: requestModel?.provider || null,
            modelLabel: requestModel?.label || null,
            modelUsed: requestModel,
            mutationGateActive,
            ...modelRequestDelta,
            ts: Date.now()
          });
          _pushActivity({
            kind: 'model_request',
            cycle: iteration,
            content: modelRequestContent,
            messageCount: context.length,
            inputChars: providerInputChars,
            toolNames: offeredToolNames,
            modelUsed: requestModel,
            mutationGateActive,
            ...modelRequestDelta
          });

          // Multi-model execution if multiple models configured
          let response;
          let arenaResult = null;
          let functionGemmaResult = null;
          let functionGemmaInfo = null;
          let activeLlmModel = _modelConfig || _modelConfigs[0] || null;

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

              functionGemmaResult = await engine.provider(() => FunctionGemmaOrchestrator.execute(task, { ...options, signal: _abortController.signal }));
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
              _abortController.signal.throwIfAborted();
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
              arenaResult = await engine.provider(() => MultiModelCoordinator.execute(context,
                { ...multiModelConfig, signal: _abortController.signal }, update => {
                  if (!_abortController.signal.aborted && !closed) onUpdate(update);
                }));
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
              _abortController.signal.throwIfAborted();
              logger.error('[Agent] Multi-model execution failed, falling back to single model:', error);
              const recoveryResult = await chatWithProviderRecovery({
                context,
                primaryModel: _modelConfig || _modelConfigs[0],
                streamCallback,
                toolSchemas: activeToolSchemas,
                iteration
              });
              response = recoveryResult.response;
              activeLlmModel = recoveryResult.modelConfig;
              if (TraceStore && _traceSessionId) {
                await TraceStore.record(_traceSessionId, 'llm:response', {
                  source: 'agent',
                  iteration,
                  modelId: activeLlmModel?.id || null,
                  latencyMs: Date.now() - llmStart,
                  contentPreview: response?.content || '',
                  toolCallCount: response?.toolCalls?.length || 0,
                  usage: response?.usage || null
                }, { tags: ['llm'] });
              }
            }
          } else if (!response) {
            // Single model execution (with native tools if supported)
            const recoveryResult = await chatWithProviderRecovery({
              context,
              primaryModel: _modelConfig,
              streamCallback,
              toolSchemas: activeToolSchemas,
              iteration
            });
            response = recoveryResult.response;
            activeLlmModel = recoveryResult.modelConfig;
            if (TraceStore && _traceSessionId) {
              await TraceStore.record(_traceSessionId, 'llm:response', {
                source: 'agent',
                iteration,
                modelId: activeLlmModel?.id || null,
                latencyMs: Date.now() - llmStart,
                contentPreview: response?.content || '',
                toolCallCount: response?.toolCalls?.length || 0,
                usage: response?.usage || null
              }, { tags: ['llm'] });
            }
          }

          const interpreted = engine.interpret(response, text => ResponseParser.parseToolCalls(text));
          const responseContent = interpreted.content;
          const usage = response?.usage || {};
          const lastUserMessage = [...context].reverse().find(m => m.role === 'user');
          const responseModel = functionGemmaInfo?.modelId || arenaResult?.winner?.model || activeLlmModel?.id || _modelConfig?.id || null;
          const responseProvider = functionGemmaInfo?.provider || arenaResult?.winner?.provider || activeLlmModel?.provider || _modelConfig?.provider || null;
          const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? null;
          const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? usage.tokens ?? null;
          const contextTokenEstimate = ContextManager.countTokens(context);
          const effectiveInputTokens = inputTokens ?? contextTokenEstimate;
          const effectiveOutputTokens = outputTokens ?? null;
          const totalTokens = (Number.isFinite(effectiveInputTokens) ? effectiveInputTokens : 0)
            + (Number.isFinite(effectiveOutputTokens) ? effectiveOutputTokens : 0);
          const responseLatencyMs = Date.now() - llmStart;
          const modelUsed = buildModelUsed({
            response,
            modelId: responseModel,
            provider: responseProvider,
            latencyMs: responseLatencyMs
          });

          const llmEvent = {
            type: 'llm_response',
            cycle: iteration,
            content: response.content,
            model: modelUsed.id,
            provider: modelUsed.provider,
            modelLabel: modelUsed.label,
            modelUsed,
            latencyMs: responseLatencyMs,
            inputTokens: effectiveInputTokens,
            outputTokens: effectiveOutputTokens,
            tokens: totalTokens
          };
          EventBus.emit('agent:history', llmEvent);
          _pushActivity({ kind: 'llm_response', cycle: iteration, modelUsed, content: response.content });

          EventBus.emit('llm:complete', {
            model: modelUsed.id,
            modelName: modelUsed.name,
            modelLabel: modelUsed.label,
            provider: modelUsed.provider,
            modelUsed,
            latency: responseLatencyMs,
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
          const toolCalls = interpreted.calls;

          if (response.toolCalls?.length > 0) {
            logger.info(`[Agent] Using ${response.toolCalls.length} native tool call(s)`);
          }
          await _writeCycleArtifact(iteration, 'trace.json', {
            stateBefore,
            event: 'llm:response',
            stateAfter: toolCalls.length > 0 ? 'Shadow' : (ResponseParser.isDone(response.content) ? 'Complete' : 'Shadow'),
            model: modelUsed.id,
            provider: modelUsed.provider,
            modelName: modelUsed.name,
            modelLabel: modelUsed.label,
            modelUsed,
            usage,
            response: responseContent,
            toolCallCount: toolCalls.length
          });

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
            model: modelUsed.id,
            provider: modelUsed.provider,
            modelLabel: modelUsed.label,
            modelUsed
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
          const executableToolCallCount = toolCalls.filter((call) => !call.error).length;
          const healthCheck = _checkLoopHealth(iteration, executableToolCallCount, responseContent.length);
          if (healthCheck.stuck) {
            const shouldBreak = await _handleStuckLoop(healthCheck, context, iteration);
            if (shouldBreak) return TURN_STOP;
          }

          if (toolCalls.length > 0) {
            // Limit and partition tools
            const maxTools = getMaxToolCalls();
            const callsToExecute = toolCalls.slice(0, maxTools);
            const toolBatchStart = Date.now();
            if (toolCalls.length > maxTools) {
              const limitMsg = `Tool call limit (${maxTools}) reached. Executing first ${maxTools}.`;
              logger.warn('[Agent] ' + limitMsg);
              context.push({ role: 'user', content: limitMsg });
            }

            // Track single-tool usage for batching nudges
            if (callsToExecute.length === 1) {
              _consecutiveSingleToolCalls++;
              if (_consecutiveSingleToolCalls >= SINGLE_TOOL_NUDGE_THRESHOLD) {
                const nudgeMsg = `BATCHING TIP: emit 4-${maxTools} independent read-only tool calls in one response when exploring broad filesystem context. Use all ${maxTools} slots when there are ${maxTools} independent read-only calls. Read-only tools run in parallel; avoid spending separate cycles on ListFiles, ListTools, ReadFile, or Grep calls that do not depend on each other.`;
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
            const circuitSkips = [];
            for (const call of callsToExecute) {
              if (call.error) {
                logger.warn(`[Agent] Tool ${call.name} has parse error: ${call.error}`);
                preResults.push({
                  call,
                  finalResult: formatToolCallParseErrorResult(call),
                  skipped: true,
                  errorKind: 'parse_error'
                });
                continue;
              }
              if (_toolCircuitBreaker.isOpen(call.name)) {
                const circuitState = _toolCircuitBreaker.getState(call.name);
                const fallbackRemainingMs = 60000 - (Date.now() - circuitState.tripTime);
                const remainingMs = Math.max(0, Math.ceil(Number(circuitState.remainingMs ?? fallbackRemainingMs) || 0));
                const remainingSec = Math.ceil(remainingMs / 1000);
                logger.warn(`[Agent] Circuit breaker OPEN for ${call.name} - skipping`);
                const skipMsg = `Tool ${call.name} is temporarily disabled. Retry in ${remainingSec}s.`;
                preResults.push({ call, finalResult: `Error: ${skipMsg}`, skipped: true, retryDelayMs: remainingMs });
                circuitSkips.push({ tool: call.name, remainingMs });
                EventBus.emit('tool:circuit_skip', { tool: call.name, remainingMs });
                continue;
              }
              executableCalls.push(call);
            }

            // Partition into read-only (parallel) and mutating (sequential)
            const readOnlyCalls = executableCalls.filter(c => isReadOnlyTool(c.name));
            const mutatingCalls = executableCalls.filter(c => !isReadOnlyTool(c.name));
            const readOnlyOnlyBuildBatch = buildGoal && readOnlyCalls.length > 0 && mutatingCalls.length === 0;
            const mutationRequiredNow = readOnlyOnlyBuildBatch
              && consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;

            const allResults = [...preResults]; // Start with pre-filtered results

            // Execute read-only tools in PARALLEL
            if (mutationRequiredNow) {
              const gateMsg = `Build progress gate active after ${consecutiveReadOnlyBuildBatches} read-only discovery batches. Skipping read-only-only batch; next response must use ${getMutationProgressToolList()}, or say DONE with a concrete blocker.`;
              logger.warn(`[Agent] ${gateMsg}`);
              EventBus.emit('agent:warning', {
                type: 'build_progress_gate',
                cycle: iteration,
                consecutiveReadOnlyBatches: consecutiveReadOnlyBuildBatches,
                readOnlyTools: readOnlyCalls.map((call) => call.name)
              });
              EventBus.emit('agent:history', {
                type: 'build_progress_gate',
                cycle: iteration,
                content: gateMsg,
                consecutiveReadOnlyBatches: consecutiveReadOnlyBuildBatches,
                readOnlyTools: readOnlyCalls.map((call) => call.name),
                ts: Date.now()
              });
              _pushActivity({
                kind: 'build_progress_gate',
                cycle: iteration,
                consecutiveReadOnlyBatches: consecutiveReadOnlyBuildBatches,
                readOnlyTools: readOnlyCalls.map((call) => call.name)
              });
              for (const call of readOnlyCalls) {
                allResults.push({
                  call,
                  finalResult: `Error: ${gateMsg}`,
                  result: null,
                  duration: 0,
                  skipped: true
                });
              }
              context.push({ role: 'user', content: `BUILD PROGRESS GATE: ${gateMsg}` });
              _syncContext(context);
            } else if (readOnlyCalls.length > 0) {
              logger.info(`[Agent] Executing ${readOnlyCalls.length} read-only tools in parallel`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Parallel: ${readOnlyCalls.map(c => c.name).join(', ')}` });

              const parallelResults = await engine.batch({
                groups: [{ mode: 'parallel', calls: readOnlyCalls }],
                execute: call => _executeToolWithRecovery(call, iteration)
              });
              allResults.push(...parallelResults);
            }

            allResults.push(...await engine.batch({
              groups: mutatingCalls.map(call => ({ mode: 'sequential', calls: [call] })),
              execute: call => _executeToolWithRecovery(call, iteration),
              failed: isToolExecutionFailure, stopOnFailure: true,
              before: group => {
                const call = group.calls[0];
                logger.info(`[Agent] Tool Call: ${call.name}`);
                EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing: ${call.name}` });
              },
              skipped: (call, failedCall) => ({ call, finalResult: `Error: skipped because ${failedCall.name} failed`,
                result: null, duration: 0, skipped: true }),
              next: execution => (Array.isArray(execution.result?.nextSteps) ? execution.result.nextSteps : [])
                .filter(step => step.tool && step.args).map(step => ({ name: step.tool, args: step.args })),
              maxFollowups: getMaxToolCalls()
            }));

            if (buildGoal) {
              if (mutatingCalls.length > 0) {
                consecutiveReadOnlyBuildBatches = 0;
                mutationGateAnnounced = false;
              } else if (readOnlyCalls.length > 0) {
                consecutiveReadOnlyBuildBatches++;
              }
            }

            // Process all results into context (preserves original order for pre-results)
            for (const { call, finalResult, aborted, duration } of allResults) {
              if (aborted) continue;
              _processToolResult(call, finalResult, iteration, context, duration, modelUsed);
            }

            // Emit tool batch marker for timeline
            const uniqueTools = [];
            for (const call of callsToExecute) {
              if (!uniqueTools.includes(call.name)) uniqueTools.push(call.name);
            }
            const topTools = uniqueTools.slice(0, 3);
            const extraTools = Math.max(0, uniqueTools.length - topTools.length);
            const isBatchEntry = (entry) => callsToExecute.includes(entry.call)
              || callsToExecute.includes(entry.recoveredFrom);
            const errorCount = allResults.filter((entry) => (
              isBatchEntry(entry)
              && isToolExecutionFailure(entry)
            )).length;
            const toolBatchDurationMs = Date.now() - toolBatchStart;
            EventBus.emit('agent:history', {
              type: 'tool_batch',
              cycle: iteration,
              model: modelUsed.id,
              provider: modelUsed.provider,
              modelLabel: modelUsed.label,
              modelUsed,
              total: callsToExecute.length,
              errors: errorCount,
              tools: uniqueTools,
              calls: callsToExecute.map((call) => ({
                name: call.name,
                args: call.args || {},
                error: call.error || null
              })),
              results: allResults.map((entry) => ({
                name: entry.call?.name || 'unknown',
                args: entry.call?.args || {},
                error: getToolExecutionFailureReason(entry),
                resultPreview: summarizeToolResultForBatch(entry.finalResult ?? entry.result),
                recoveredFrom: entry.recoveredFrom
                  ? { name: entry.recoveredFrom.name, args: entry.recoveredFrom.args || {} }
                  : null,
                durationMs: entry.duration ?? null
              })),
              durationMs: toolBatchDurationMs,
              topTools,
              extraTools,
              ts: Date.now()
            });

            await _writeCycleOutcomeArtifacts({
              iteration,
              stateBefore,
              modelUsed,
              responseContent,
              toolCalls,
              callsToExecute,
              allResults,
              reason: errorCount > 0 ? 'tool errors present' : 'tool batch complete',
              done: false
            });

            const cooldownOnlyErrors = circuitSkips.length > 0 && errorCount === circuitSkips.length;
            if (cooldownOnlyErrors) {
              const retryDelayMs = Math.max(...circuitSkips.map((skip) => Number(skip.remainingMs) || 0));
              if (retryDelayMs > 0) {
                providerParked = true;
                scheduledProviderResume = true;
                providerParkReason = `Tool cooldown active; retry scheduled`;
                scheduleProviderResume({
                  goal,
                  context,
                  iteration,
                  providerRetryAttempt,
                  consecutiveReadOnlyBuildBatches,
                  resumeKind: 'tool_cooldown',
                  resumeContent: 'Resuming after tool cooldown',
                  resumeActivity: 'Retrying after tool cooldown'
                }, retryDelayMs);
                return TURN_STOP;
              }
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
            const waitDirective = parseWaitDirective(response.content);
            if (waitDirective?.delayMs > 0) {
              await _writeCycleOutcomeArtifacts({
                iteration,
                stateBefore,
                modelUsed,
                responseContent,
                toolCalls,
                callsToExecute: [],
                allResults: [],
                reason: 'wait directive',
                done: false
              });
              providerParked = true;
              scheduledProviderResume = true;
              providerParkReason = `${waitDirective.directive}: ${waitDirective.reason}`;
              scheduleProviderResume({
                goal,
                context,
                iteration,
                providerRetryAttempt,
                consecutiveReadOnlyBuildBatches,
                resumeKind: 'tool_cooldown',
                resumeContent: `Resuming after ${waitDirective.directive.toLowerCase()} wait`,
                resumeActivity: 'Retrying after wait directive'
              }, waitDirective.delayMs);
              return TURN_STOP;
            }
            if (ResponseParser.isDone(response.content)) {
              await _writeCycleOutcomeArtifacts({
                iteration,
                stateBefore,
                modelUsed,
                responseContent,
                toolCalls,
                callsToExecute: [],
                allResults: [],
                reason: 'done',
                done: true
              });
              logger.info('[Agent] Goal achieved.');
              return TURN_STOP;
            }
            await _writeCycleOutcomeArtifacts({
              iteration,
              stateBefore,
              modelUsed,
              responseContent,
              toolCalls,
              callsToExecute: [],
              allResults: [],
              reason: 'no executable tool call',
              done: false
            });
            // WebLLM requires last message to be user/tool - add continuation prompt
            let continuationMsg = 'No executable tool call detected. Use REPLOID/0 format with only key: value argument lines after TOOL:\n\nREPLOID/0\n\nTOOL: ToolName\nkey: value';
            if (iteration > 3) {
              continuationMsg = 'You must use a valid tool block or say DONE. Do not put commentary inside argument lines.';
            }
            context.push({ role: 'user', content: continuationMsg });
          }

    } }) === TURN_RETURN) return;
      } catch (err) {
        if (err instanceof Errors.AbortError || _abortController?.signal.aborted) {
          logger.info('[Agent] Cycle aborted.');
        } else if (isTransientProviderError(err)) {
          const status = getProviderErrorStatus(err);
          const throttleConfig = getProviderThrottleConfig(_modelConfig);
          const delayMs = computeProviderBackoffMs(providerRetryAttempt, err, _modelConfig);
          const nextRetryAttempt = providerRetryAttempt + 1;
          const retryAt = Date.now() + delayMs;
          providerParked = true;
          scheduledProviderResume = throttleConfig.providerAutoResume;
          providerParkReason = `Provider unavailable${status ? ` (${status})` : ''}; ${scheduledProviderResume ? 'retry scheduled' : 'auto-resume disabled'}`;
          logger.warn(`[Agent] ${providerParkReason}; parking run.`);
          EventBus.emit('agent:warning', {
            type: 'provider_unavailable',
            cycle: iteration,
            status,
            error: err?.message || String(err),
            retryAttempt: nextRetryAttempt,
            retryDelayMs: delayMs,
            retryAt,
            autoResume: scheduledProviderResume
          });
          EventBus.emit('agent:history', {
            type: 'provider_unavailable',
            cycle: iteration,
            content: providerParkReason,
            status,
            error: err?.message || String(err),
            retryAttempt: nextRetryAttempt,
            retryDelayMs: delayMs,
            retryAt,
            autoResume: scheduledProviderResume,
            ts: Date.now()
          });
          _pushActivity({
            kind: 'provider_unavailable',
            cycle: iteration,
            status,
            error: err?.message || String(err),
            retryAttempt: nextRetryAttempt,
            retryDelayMs: delayMs,
            retryAt,
            autoResume: scheduledProviderResume
          });
          try {
            await _writeCycleArtifact(iteration || 0, 'provider-recovery.json', {
              event: 'provider:parked',
              cycle: iteration,
              status,
              error: err?.message || String(err),
              retryAttempt: nextRetryAttempt,
              retryDelayMs: delayMs,
              retryAt,
              autoResume: scheduledProviderResume
            });
          } catch (artifactError) {
            logger.debug('[Agent] Failed to write provider recovery artifact:', artifactError?.message || artifactError);
          }
          if (scheduledProviderResume) {
            scheduleProviderResume({
              goal,
              context,
              iteration,
              providerRetryAttempt: nextRetryAttempt,
              consecutiveReadOnlyBuildBatches
            }, delayMs);
          }
        } else if (isManagedProviderRequestError(err)) {
          const status = getProviderErrorStatus(err);
          providerParked = true;
          scheduledProviderResume = false;
          providerParkReason = `Provider request rejected${status ? ` (${status})` : ''}: ${err?.responseMessage || err?.details?.responseMessage || err?.message || String(err)}`;
          logger.warn(`[Agent] ${providerParkReason}; parking run.`);
          EventBus.emit('agent:warning', {
            type: 'provider_request_rejected',
            cycle: iteration,
            status,
            error: err?.message || String(err),
            responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
            autoResume: false
          });
          EventBus.emit('agent:history', {
            type: 'provider_request_rejected',
            cycle: iteration,
            content: providerParkReason,
            status,
            error: err?.message || String(err),
            responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
            autoResume: false,
            ts: Date.now()
          });
          _pushActivity({
            kind: 'provider_request_rejected',
            cycle: iteration,
            status,
            error: err?.message || String(err),
            responseMessage: err?.responseMessage || err?.details?.responseMessage || null
          });
          try {
            await _writeCycleArtifact(iteration || 0, 'provider-recovery.json', {
              event: 'provider:request-rejected',
              cycle: iteration,
              status,
              error: err?.message || String(err),
              responseMessage: err?.responseMessage || err?.details?.responseMessage || null,
              autoResume: false
            });
          } catch (artifactError) {
            logger.debug('[Agent] Failed to write provider rejection artifact:', artifactError?.message || artifactError);
          }
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
            status: providerParked ? 'parked' : 'completed',
            iterations: iteration
          });
          _traceSessionId = null;
        }
        EventBus.emit('agent:status', providerParked
          ? {
              state: 'PARKED',
              activity: providerParkReason || 'Provider unavailable',
              cycle: iteration,
              retryAttempt: _providerResumeState?.providerRetryAttempt ?? providerRetryAttempt,
              retryDelayMs: _providerResumeState?.delayMs ?? null,
              retryAt: _providerResumeState?.retryAt ?? null,
              autoResume: scheduledProviderResume
            }
          : { state: 'IDLE', activity: 'Stopped' });
      }
    };

    const _logReflection = async (call, result, iteration) => {
         if (!ReflectionStore) return;
         const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
         const isError = resultStr.startsWith('Error:');
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

    const getRuntimeMode = () => runtimeMode ?? deps.getRuntimeMode();

    const getMutationProgressToolList = () => (
      getRuntimeMode() === 'zero'
        ? 'CreateTool or a created mutation tool'
        : 'WriteFile, CreateTool, EditFile, Promote, or LoadModule'
    );

    const _buildInitialContext = async (goal) => {
      const context = await deps.buildInitialContext({ goal,
        personaPrompt: await PersonaManager.getSystemPrompt(), runtimeMode: getRuntimeMode(),
        maxToolCalls: getMaxToolCalls(), discoveryLimit: BUILD_READ_ONLY_DISCOVERY_LIMIT });
      if (!Array.isArray(context)) throw new TypeError('Initial context port must return messages');
      _currentSystemPrompt = String(context.find(message => message.role === 'system')?.content || '');
      _currentContext = [...context];
      return context;
    };

    const getRecentActivities = () => [..._activityLog];
    const normalizeGoalInput = (goal) => {
      if (goal && typeof goal === 'object' && !Array.isArray(goal)) {
        return String(goal.goal ?? goal.text ?? goal.objective ?? '').trim();
      }
      return String(goal ?? '').trim();
    };
    const startRun = (goal, resumeState = null) => {
      if (closed) return Promise.reject(new Errors.StateError('Agent is closed'));
      if (activeAttempt) return Promise.reject(new Errors.StateError('Agent already running'));
      if (!resumeState) {
        policy = requireResolvedConfig(deps.resolveAttemptConfig?.(_modelConfig) || deps.config);
        runtimeMode = deps.getRuntimeMode();
      }
      activeAttempt = engine.start(signal => runAttempt(goal, resumeState, signal), { timeoutMs: policy.agent.timeoutMs })
        .finally(() => { activeAttempt = null; _isRunning = false; });
      return activeAttempt;
    };
    const run = goal => startRun(normalizeGoalInput(goal), null);
    const setModel = c => {
      if (activeAttempt || _providerResumeState) throw new Errors.StateError('Pause before changing the model');
      _modelConfig = c ? freezeJson(structuredClone(c)) : null;
      resetFunctionGemmaState();
    };

    return {
      run,
      close: async () => {
        closed = true;
        clearProviderResumeTimer();
        _abortController?.abort();
        _isRunning = false;
        for (const unsubscribe of subscriptions.splice(0)) unsubscribe?.();
        await engine.close();
      },
      stop: () => {
        clearProviderResumeTimer();
        if (_abortController) _abortController.abort();
        _isRunning = false;
      },
      setModel,
      setModels: (models) => {
        if (activeAttempt || _providerResumeState) throw new Errors.StateError('Pause before changing models');
        _modelConfigs = freezeJson(structuredClone(models || []));
        // Set primary model as first one for fallback
        if (models && models.length > 0) {
          _modelConfig = _modelConfigs[0];
        }
        resetFunctionGemmaState();
      },
      setConsensusStrategy: (strategy) => {
        if (activeAttempt || _providerResumeState) throw new Errors.StateError('Pause before changing strategy');
        _consensusStrategy = strategy || 'arena';
      },
      isRunning: () => _isRunning,
      hasPendingProviderResume: () => !!_providerResumeState,
      getRecentActivities,
      getExecutionEvents: engine.getEvents,
      checkpoint: () => engine.checkpoint({ schema: 'reploid.lab-checkpoint/v1',
        context: _currentContext, model: _modelConfig, activities: _activityLog }),
      getProviderRetryState: () => (_providerResumeState ? { ..._providerResumeState } : null),
      getProviderResumePromise: () => _providerResumePromise,
      // Debug visibility
      getSystemPrompt: () => _currentSystemPrompt,
      getContext: () => structuredClone(_currentContext),
      // Human-in-the-loop
      injectHumanMessage,
      getMessageQueue: () => [..._humanMessageQueue]
    };
  }
};

export default AgentLoop;
