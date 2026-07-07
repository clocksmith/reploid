/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../instance.js';
import { createCycleArtifactWriter } from './cycle-artifacts.js';

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
    const {
      Utils, EventBus, VFS, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, CircuitBreaker, SchemaRegistry, ToolExecutor,
      ReflectionStore, ReflectionAnalyzer, CognitionAPI, MultiModelCoordinator, FunctionGemmaOrchestrator, TraceStore,
      MemoryManager
    } = deps;

    const { logger, Errors } = Utils;
    const MAX_ITERATIONS = 256;
    const MANAGED_SERVER_PROXY_TYPE = 'firebase-function';
    const MANAGED_SERVER_PROXY_MAX_ITERATIONS = 99;
    const MANAGED_SERVER_PROXY_REJECT_STATUSES = new Set([400, 413]);
    const MANAGED_SERVER_CONTEXT_ENVELOPE = Object.freeze({
      maxMessages: 64,
      targetMessages: 56,
      maxInputChars: 120000,
      targetInputChars: 100000,
      keepRecentMessages: 32,
      maxMessageChars: 16000
    });
    const BUILD_READ_ONLY_DISCOVERY_LIMIT = 3;
    const DEFAULT_MAX_TOOL_CALLS = 8;
    const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
    const DEFAULT_PROVIDER_THROTTLE = Object.freeze({
      minProviderRequestIntervalMs: 0,
      providerBackoffBaseMs: 15000,
      providerBackoffMaxMs: 300000,
      providerBackoffJitterRatio: 0.20,
      providerAutoResume: true
    });
    const DEFAULT_AGENT_CYCLE_THROTTLE = Object.freeze({
      cycleIntervalMs: 7700
    });

    // Configurable limits - can be overridden via StateManager config
    const getMaxToolCalls = () => {
      try {
        const config = StateManager?.getState()?.config || {};
        return config.maxToolCallsPerIteration || DEFAULT_MAX_TOOL_CALLS;
      } catch {
        return DEFAULT_MAX_TOOL_CALLS;
      }
    };

    const getStateConfig = () => {
      try {
        return StateManager?.getState?.()?.config || {};
      } catch {
        return {};
      }
    };

    const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null);

    const finiteNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const clampNumber = (value, fallback, min, max) => {
      const parsed = finiteNumber(value, fallback);
      return Math.min(max, Math.max(min, parsed));
    };

    const getProviderThrottleConfig = (model = _modelConfig) => {
      const stateConfig = getStateConfig();
      const localConfig = readLocalStorageJson('REPLOID_PROVIDER_THROTTLE');
      const sources = [
        model?.agentThrottle,
        model?.providerThrottle,
        model?.throttle?.provider,
        stateConfig.agentThrottle,
        stateConfig.providerThrottle,
        localConfig
      ].filter((entry) => entry && typeof entry === 'object');
      const merged = Object.assign({}, DEFAULT_PROVIDER_THROTTLE, ...sources);

      const maxBackoff = Math.floor(clampNumber(
        firstDefined(merged.providerBackoffMaxMs, merged.backoffMaxMs),
        DEFAULT_PROVIDER_THROTTLE.providerBackoffMaxMs,
        0,
        3600000
      ));

      return {
        minProviderRequestIntervalMs: Math.floor(clampNumber(
          firstDefined(
            merged.minProviderRequestIntervalMs,
            merged.providerMinRequestIntervalMs,
            merged.minRequestIntervalMs,
            merged.requestIntervalMs
          ),
          DEFAULT_PROVIDER_THROTTLE.minProviderRequestIntervalMs,
          0,
          3600000
        )),
        providerBackoffBaseMs: Math.floor(clampNumber(
          firstDefined(merged.providerBackoffBaseMs, merged.backoffBaseMs),
          DEFAULT_PROVIDER_THROTTLE.providerBackoffBaseMs,
          0,
          maxBackoff
        )),
        providerBackoffMaxMs: maxBackoff,
        providerBackoffJitterRatio: clampNumber(
          firstDefined(merged.providerBackoffJitterRatio, merged.backoffJitterRatio, merged.jitterRatio),
          DEFAULT_PROVIDER_THROTTLE.providerBackoffJitterRatio,
          0,
          1
        ),
        providerAutoResume: merged.providerAutoResume !== false && merged.autoResume !== false
      };
    };

    const sleepWithAbort = (delayMs, signal) => new Promise((resolve, reject) => {
      const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
      if (delay === 0) {
        resolve();
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason || new Errors.AbortError('Aborted'));
        return;
      }
      const timer = setTimeout(resolve, delay);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new Errors.AbortError('Aborted'));
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });

    const normalizeIterationLimit = (value, fallback = MAX_ITERATIONS) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      const limit = Math.floor(parsed);
      if (limit < 1) return fallback;
      return Math.min(limit, MAX_ITERATIONS);
    };

    const getModelIterationLimit = (model) => {
      if (model?.managedServerProxy || model?.serverType === MANAGED_SERVER_PROXY_TYPE) {
        return Math.min(
          normalizeIterationLimit(
            model?.maxIterations ?? model?.iterationLimit,
            MANAGED_SERVER_PROXY_MAX_ITERATIONS
          ),
          MANAGED_SERVER_PROXY_MAX_ITERATIONS
        );
      }
      return normalizeIterationLimit(model?.maxIterations ?? model?.iterationLimit);
    };

    const getConfiguredMaxIterations = () =>
      getModelIterationLimit(_modelConfig || _modelConfigs[0]);

    const isBuildGoal = (goalText = '') => /\b(build|create|make|implement|write|edit|modify|update|fix|patch|add|inject|stage|load|promote)\b/i
      .test(String(goalText || ''));

    const getToolSchemaName = (schema = {}) =>
      schema?.function?.name || schema?.name || schema?.tool || '';

    const filterToolSchemasForMutation = (schemas = []) =>
      schemas.filter((schema) => {
        const name = getToolSchemaName(schema);
        return name && !isReadOnlyTool(name);
      });

    const isManagedServerProxyModel = (model) =>
      !!(model?.managedServerProxy || model?.serverType === MANAGED_SERVER_PROXY_TYPE);

    const getManagedContextEnvelope = (model) => {
      if (!isManagedServerProxyModel(model)) return null;
      const configured = model?.contextEnvelope || model?.providerEnvelope || model?.requestEnvelope || {};
      const maxMessages = Math.floor(clampNumber(
        configured.maxMessages,
        MANAGED_SERVER_CONTEXT_ENVELOPE.maxMessages,
        4,
        256
      ));
      const maxInputChars = Math.floor(clampNumber(
        configured.maxInputChars,
        MANAGED_SERVER_CONTEXT_ENVELOPE.maxInputChars,
        4096,
        1000000
      ));
      return {
        maxMessages,
        targetMessages: Math.min(maxMessages, Math.floor(clampNumber(
          configured.targetMessages,
          MANAGED_SERVER_CONTEXT_ENVELOPE.targetMessages,
          4,
          maxMessages
        ))),
        maxInputChars,
        targetInputChars: Math.min(maxInputChars, Math.floor(clampNumber(
          configured.targetInputChars,
          MANAGED_SERVER_CONTEXT_ENVELOPE.targetInputChars,
          2048,
          maxInputChars
        ))),
        keepRecentMessages: Math.floor(clampNumber(
          configured.keepRecentMessages,
          MANAGED_SERVER_CONTEXT_ENVELOPE.keepRecentMessages,
          4,
          maxMessages
        )),
        maxMessageChars: Math.floor(clampNumber(
          configured.maxMessageChars,
          MANAGED_SERVER_CONTEXT_ENVELOPE.maxMessageChars,
          1000,
          maxInputChars
        ))
      };
    };

    const stringifyMessageContent = (content) => {
      if (typeof content === 'string') return content;
      if (content === null || content === undefined) return '';
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    };

    const measureContextChars = (messages = []) =>
      messages.reduce((sum, message) => sum + stringifyMessageContent(message?.content).length, 0);

    const clipProviderMessage = (message, maxChars) => {
      const content = stringifyMessageContent(message?.content);
      if (content.length <= maxChars) {
        return { ...message, content };
      }
      const headLength = Math.max(200, Math.floor(maxChars * 0.62));
      const tailLength = Math.max(200, maxChars - headLength - 96);
      const omitted = content.length - headLength - tailLength;
      return {
        ...message,
        content: `${content.slice(0, headLength).trimEnd()}\n\n[provider context clipped ${omitted} chars]\n\n${content.slice(-tailLength).trimStart()}`
      };
    };

    const compactContextForManagedProvider = (context, model) => {
      const envelope = getManagedContextEnvelope(model);
      if (!envelope) {
        return {
          context,
          changed: false,
          previousMessages: context.length,
          newMessages: context.length,
          previousChars: measureContextChars(context),
          newChars: measureContextChars(context)
        };
      }

      const previousMessages = context.length;
      const previousChars = measureContextChars(context);
      if (previousMessages <= envelope.targetMessages && previousChars <= envelope.targetInputChars) {
        return {
          context,
          changed: false,
          previousMessages,
          newMessages: previousMessages,
          previousChars,
          newChars: previousChars
        };
      }

      const anchored = new Map();
      const addIndex = (index) => {
        if (index >= 0 && index < context.length) anchored.set(index, context[index]);
      };
      addIndex(context.findIndex((message) => message?.role === 'system'));
      addIndex(context.findIndex((message) => message?.role === 'user'));
      const lastCompactionIndex = context.findLastIndex
        ? context.findLastIndex((message) => stringifyMessageContent(message?.content).includes('[CONTEXT COMPACTED'))
        : (() => {
            for (let index = context.length - 1; index >= 0; index--) {
              if (stringifyMessageContent(context[index]?.content).includes('[CONTEXT COMPACTED')) return index;
            }
            return -1;
          })();
      addIndex(lastCompactionIndex);

      let tailCount = Math.min(envelope.keepRecentMessages, context.length);
      let selected = [];
      while (tailCount >= 4) {
        const picked = new Map(anchored);
        const tailStart = Math.max(0, context.length - tailCount);
        for (let index = tailStart; index < context.length; index++) {
          picked.set(index, context[index]);
        }
        selected = [...picked.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, message]) => clipProviderMessage(message, envelope.maxMessageChars));

        while (selected.length > envelope.targetMessages) {
          const removableIndex = selected.findIndex((message, index) => (
            index > 1
            && !stringifyMessageContent(message?.content).includes('[CONTEXT COMPACTED')
          ));
          if (removableIndex === -1) break;
          selected.splice(removableIndex, 1);
        }

        if (measureContextChars(selected) <= envelope.targetInputChars && selected.length <= envelope.targetMessages) {
          break;
        }
        tailCount -= 4;
      }

      let newChars = measureContextChars(selected);
      if (newChars > envelope.targetInputChars && selected.length > 0) {
        const perMessageBudget = Math.max(800, Math.floor(envelope.targetInputChars / selected.length) - 64);
        selected = selected.map((message) => clipProviderMessage(message, Math.min(envelope.maxMessageChars, perMessageBudget)));
        newChars = measureContextChars(selected);
      }

      return {
        context: selected,
        changed: true,
        previousMessages,
        newMessages: selected.length,
        previousChars,
        newChars
      };
    };

    const renderModelContextForTrace = (messages = [], tools = []) => {
      const renderedMessages = messages.map((message, index) => {
        const role = String(message?.role || 'unknown').toUpperCase();
        const content = stringifyMessageContent(message?.content);
        return `## Message ${index + 1} / ${messages.length} [${role}]\n${content}`;
      }).join('\n\n');
      const toolNames = tools
        .map((schema) => getToolSchemaName(schema))
        .filter(Boolean);
      const toolText = toolNames.length > 0
        ? `\n\n## Tools offered\n${toolNames.map((name) => `- ${name}`).join('\n')}`
        : '\n\n## Tools offered\n- none';
      return `${renderedMessages}${toolText}`;
    };

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

    const readLocalStorageJson = (key) => {
      const storage = getReploidStorage();
      try {
        const raw = storage.getItem(key);
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

    const readLocalStorageNumber = (key) => {
      const storage = getReploidStorage();
      try {
        const raw = storage.getItem(key);
        if (raw === null || raw === undefined || raw === '') return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      } catch (e) {
        logger.warn(`[Agent] Failed to parse ${key}: ${e.message}`);
        return null;
      }
    };

    const getAgentCycleIntervalMs = (model = _modelConfig) => {
      const stateConfig = getStateConfig();
      const localConfig = readLocalStorageJson('REPLOID_AGENT_CYCLE_THROTTLE');
      const localSeconds = readLocalStorageNumber('REPLOID_CYCLE_INTERVAL_SECONDS');
      const sources = [
        stateConfig.agentCycleThrottle,
        stateConfig.cycleThrottle,
        model?.agentCycleThrottle,
        model?.cycleThrottle,
        localConfig
      ].filter((entry) => entry && typeof entry === 'object');
      const merged = Object.assign({}, DEFAULT_AGENT_CYCLE_THROTTLE, ...sources);
      const intervalMs = firstDefined(
        merged.cycleIntervalMs,
        merged.secondsBetweenCyclesMs,
        merged.cycleDelayMs,
        merged.minCycleIntervalMs,
        merged.secondsBetweenCycles !== undefined ? Number(merged.secondsBetweenCycles) * 1000 : undefined,
        merged.cycleIntervalSeconds !== undefined ? Number(merged.cycleIntervalSeconds) * 1000 : undefined,
        localSeconds !== null ? localSeconds * 1000 : undefined
      );
      return Math.floor(clampNumber(intervalMs, DEFAULT_AGENT_CYCLE_THROTTLE.cycleIntervalMs, 0, 3600000));
    };

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
    let _providerResumeTimer = null;
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

    const getProviderErrorStatus = (error) => {
      const direct = Number(error?.status ?? error?.details?.status ?? error?.details?.statusCode);
      if (Number.isFinite(direct)) return direct;
      const match = String(error?.message || error || '').match(/\b([45]\d\d)\b/);
      return match ? Number(match[1]) : null;
    };

    const isTransientProviderError = (error) => {
      const status = getProviderErrorStatus(error);
      return TRANSIENT_PROVIDER_STATUSES.has(status);
    };

    const isManagedProviderRequestError = (error) => {
      const status = getProviderErrorStatus(error);
      return MANAGED_SERVER_PROXY_REJECT_STATUSES.has(status)
        && isManagedServerProxyModel(_modelConfig || _modelConfigs[0]);
    };

    const getProviderRetryAfterMs = (error) => {
      const direct = Number(error?.retryAfterMs ?? error?.details?.retryAfterMs);
      if (Number.isFinite(direct) && direct >= 0) return direct;
      const retryAfter = error?.retryAfter ?? error?.details?.retryAfter;
      if (retryAfter === undefined || retryAfter === null) return null;

      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

      const retryAt = Date.parse(String(retryAfter));
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());

      return null;
    };

    const parseWaitDirective = (content = '') => {
      const text = String(content || '').trim();
      const match = text.match(/(?:^|\n)\s*(IDLE|PARK):\s*([\s\S]*)$/i);
      if (!match) return null;
      const directive = match[1].toUpperCase();
      const reason = match[2].trim();
      const durationMatch = reason.match(/\b(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)\b/i);
      if (!durationMatch) {
        return { directive, reason, delayMs: 0 };
      }
      const amount = Number(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      let multiplier = 1000;
      if (unit.startsWith('ms') || unit.startsWith('millisecond')) multiplier = 1;
      if (unit === 'm' || unit.startsWith('min')) multiplier = 60000;
      return {
        directive,
        reason,
        delayMs: Math.max(0, Math.floor(amount * multiplier))
      };
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
      const retryAfterMs = getProviderRetryAfterMs(error);
      if (retryAfterMs !== null) return clampProviderBackoffMs(retryAfterMs, model);

      const exponent = Math.max(0, Math.floor(Number(attempt) || 0));
      const baseDelay = Math.min(
        config.providerBackoffMaxMs,
        config.providerBackoffBaseMs * (2 ** exponent)
      );
      const jitter = Math.floor(baseDelay * config.providerBackoffJitterRatio * Math.random());
      return clampProviderBackoffMs(baseDelay + jitter, model);
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
      return LLMClient.chat(context, model, streamCallback, options);
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
      let lastError = null;
      const failedModels = [];
      for (let index = 0; index < candidates.length; index++) {
        const model = candidates[index];
        try {
          const response = await chatWithProviderThrottle(context, model, streamCallback, { tools: toolSchemas }, iteration);
          if (index > 0) {
            const recoveredModel = getModelIdentity(model) || 'unknown';
            EventBus.emit('llm:provider_recovered', {
              cycle: iteration,
              model: recoveredModel,
              provider: model.provider || null,
              failedModels
            });
            EventBus.emit('agent:warning', {
              type: 'provider_recovered',
              cycle: iteration,
              model: recoveredModel,
              provider: model.provider || null
            });
            _pushActivity({
              kind: 'provider_recovered',
              cycle: iteration,
              model: recoveredModel,
              provider: model.provider || null
            });
            _modelConfig = model;
          }
          return { response, modelConfig: model };
        } catch (error) {
          lastError = error;
          const status = getProviderErrorStatus(error);
          const modelId = getModelIdentity(model) || 'unknown';
          failedModels.push({
            model: modelId,
            provider: model.provider || null,
            status,
            error: error?.message || String(error)
          });
          if (!isTransientProviderError(error) || index === candidates.length - 1) {
            throw error;
          }
          logger.warn(`[Agent] Provider ${modelId} returned transient status ${status}; trying alternate model.`);
          EventBus.emit('agent:warning', {
            type: 'provider_retry',
            cycle: iteration,
            model: modelId,
            provider: model.provider || null,
            status,
            error: error?.message || String(error)
          });
          EventBus.emit('llm:provider_retry', {
            cycle: iteration,
            model: modelId,
            provider: model.provider || null,
            status
          });
        }
      }
      throw lastError || new Error('No provider candidates available');
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
      const { result, rawResult, error, duration } = await ToolExecutor.executeWithRetry(call, {
        timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
        iteration,
        trace: _traceSessionId ? { sessionId: _traceSessionId, source: 'agent' } : null
      });
      return { result, rawResult, error, duration };
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
      if (_providerResumeTimer) {
        clearTimeout(_providerResumeTimer);
        _providerResumeTimer = null;
      }
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

      _providerResumeTimer = setTimeout(() => {
        const state = _providerResumeState;
        _providerResumeTimer = null;
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
      }, delayMs);
    };

    const startRun = async (goal, resumeState = null) => {
      if (_isRunning) throw new Errors.StateError('Agent already running');
      if (!_modelConfig) throw new Errors.ConfigError('No model configured');

      const isResume = !!resumeState;
      if (!isResume) {
        clearProviderResumeTimer();
      }

      _isRunning = true;
      _abortController = new AbortController();
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
        while (_isRunning && iteration < maxIterations) {
          if (_abortController.signal.aborted) break;

          await waitForCycleInterval(iteration + 1);
          if (_abortController.signal.aborted) break;

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

          const responseContent = response?.content || '';
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
          const toolCalls = response.toolCalls?.length > 0
            ? response.toolCalls
            : ResponseParser.parseToolCalls(responseContent);

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
            if (shouldBreak) break;
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
                preResults.push({ call, finalResult: `Error: ${call.error}`, skipped: true });
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

              const parallelResults = await Promise.all(readOnlyCalls.map(async (call) => {
                if (_abortController.signal.aborted) return { call, finalResult: 'Aborted', aborted: true };
                return _executeToolWithRecovery(call, iteration);
              }));
              allResults.push(...parallelResults);
            }

            // Execute mutating tools SEQUENTIALLY
            for (let mutationIndex = 0; mutationIndex < mutatingCalls.length; mutationIndex++) {
              const call = mutatingCalls[mutationIndex];
              if (_abortController.signal.aborted) break;
              logger.info(`[Agent] Tool Call: ${call.name}`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing: ${call.name}` });

              const execution = await _executeToolWithRecovery(call, iteration);
              const { result } = execution;
              allResults.push(execution);

              if (isToolExecutionFailure(execution)) {
                const remainingMutations = mutatingCalls.slice(mutationIndex + 1);
                for (const skippedCall of remainingMutations) {
                  allResults.push({
                    call: skippedCall,
                    finalResult: `Error: skipped because ${call.name} failed`,
                    result: null,
                    duration: 0,
                    skipped: true
                  });
                }
                break;
              }

              // Handle recursive tool chains (sequential within)
              if (result && typeof result === 'object' && result.nextSteps && Array.isArray(result.nextSteps)) {
                logger.info(`[Agent] Recursive tool chain from ${call.name}`);
                for (const step of result.nextSteps) {
                  if (step.tool && step.args) {
                    const chainedCall = { name: step.tool, args: step.args };
                    const chainedExecution = await _executeToolWithRecovery(chainedCall, iteration);
                    allResults.push(chainedExecution);
                    if (typeof chainedExecution.finalResult === 'string' && chainedExecution.finalResult.startsWith('Error:')) {
                      break;
                    }
                  }
                }
              }
            }

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
                break;
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
              break;
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
              break;
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
        }
      } catch (err) {
        if (err instanceof Errors.AbortError) {
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

    const getRuntimeMode = () => {
      if (typeof window !== 'undefined' && typeof window.getReploidMode === 'function') {
        return window.getReploidMode();
      }
      return getReploidStorage().getItem('REPLOID_MODE') || 'reploid';
    };

    const getMutationProgressToolList = () => (
      getRuntimeMode() === 'zero'
        ? 'WriteFile, EditFile, CreateTool, or LoadModule'
        : 'WriteFile, CreateTool, EditFile, Promote, or LoadModule'
    );

    const extractPersonaSection = (personaPrompt = '') => {
      const match = String(personaPrompt || '').match(/\n## PERSONA:[\s\S]*$/);
      return match ? match[0].trim() : '';
    };

    const buildZeroSystemPrompt = (personaPrompt, goal) => {
      const personaSection = extractPersonaSection(personaPrompt);
      return `
You are Zero, a browser-local tabula-rasa RSI agent.
Improve this goal and keep iterating until it is truly complete:
${goal}

${personaSection ? `${personaSection}\n` : ''}

## Scope and constraints
- This is a self-contained browser substrate (IndexedDB VFS, DOM/CSS, workers, Service Worker loading).
- No host shell/filesystem/process claims. Use the provided tools and paths only.
- The loop is RSI: after each mutation, verify a real artifact before deciding the next move.

## Writable boundary (critical)
- Read from live paths (e.g. /core, /ui, /styles, /tools, /config, /artifacts, /shadow).
- Candidate edits go to /shadow, evidence to /artifacts.
- Zero cannot write arbitrary /self files directly. Runtime tools load only from /self.

## Zero tool creation workflow
- Use CreateTool for new runtime tools. In Zero it stages /shadow/tools/MyTool.js, validates the candidate, writes hash-bound activation evidence under /artifacts, installs /self/tools/MyTool.js, and loads it.
- Use LoadModule only to reload an already installed /self tool.
- Never write candidates under /lab, never LoadModule a /shadow path, and do not use Promote in Zero.

## Required tools
ReadFile, ListFiles, Grep, ListTools, WriteFile, EditFile, CreateTool, LoadModule.

## Calling style
- Use REPLOID/0 with TOOL blocks and one tool call minimum.
- For tools, send code only as raw content (no markdown wrapper):  
  export const tool = { name, description, inputSchema, call };
  export default tool;

Evidence JSON must be strict JSON only (no fences, no trailing prose).
      `.trim();
    };

    const _buildInitialContext = async (goal) => {
      const personaPrompt = await PersonaManager.getSystemPrompt();

      const systemPrompt = getRuntimeMode() === 'zero'
        ? buildZeroSystemPrompt(personaPrompt, goal)
        : `
${personaPrompt}

You are an autonomous agent. Your self is the code in the VFS plus the LLM that processes it. Your environment is a same-origin browser substrate with explicit tools, permissions, storage, workers, model lanes, and peer transports.

## Tool Call Format
\`\`\`
REPLOID/0

TOOL: ToolName
key: value

TOOL: WriteFile
path: /shadow/tools/example.js
content <<EOF
export const tool = { name: 'Example', description: 'demo', inputSchema: { type: 'object' } };
EOF
\`\`\`

## Core Tools
- ListTools: see all available tools
- ListFiles: list directory contents using path: /dir/
- ReadFile: read files using path: /file.js
- WriteFile: write candidates/evidence under /shadow, /artifacts, or /cycles using content <<EOF
- CreateTool: stage new tool candidates under /shadow/tools using name: MyTool and code <<EOF
- Grep: search file contents using pattern:, path:, recursive:
- Find: find files by name using path: / and name: *.js
- EditFile: find/replace in file; use args-json: {...} only when a tool truly needs nested structure

## Creating Tools
Tool candidates start under /shadow/tools and become loadable only after Promote places them under /self/tools:
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
/self/ (canonical awakened self) | /.system/ (state.json) | /.memory/ (knowledge-graph.json, reflections.json) | /core/ (agent-loop, llm-client, etc.) | /capabilities/ | /tools/ (seed tools) | /shadow/tools/ (candidate tools) | /ui/ | /styles/
Memory lives under /.memory (not .memories). Artifacts and receipts live under /artifacts or opfs:/artifacts. Base styles: /styles/rd.css, /styles/boot.css, /styles/proto/index.css.

## Browser Environment
The browser is the ecosystem: a same-origin lab enclosure with persistent VFS state, visual runtime, local compute lanes, and peer coordination.
- A terminal exposes host shell power. Reploid's browser substrate exposes bounded self-mutation, inspectable UI, rollback-friendly storage, permission-mediated APIs, and browser-to-browser peer slots.
- IndexedDB stores live self, memory, traces, and code.
- OPFS stores larger artifacts, receipts, checkpoints, and eval payloads when available.
- Service Worker and blob module loading turn VFS files into executable ES modules.
- Web Workers isolate verification, tool execution, local jobs, and parallel candidate work.
- WebGPU, WASM, canvas, and media APIs are browser compute and media surfaces when capabilities exist.
- WebRTC, BroadcastChannel, and WebSocket paths are peer slots, witnesses, receipts, and coordination channels.
- DOM, CSS, Custom Elements, and Shadow DOM are the operator control surface and observable runtime. The main UI container is #app.
- Clipboard, File System Access, notifications, wake locks, storage estimates, and share flows are permission-mediated browser APIs.
- Verify capability presence before relying on any browser primitive.
- Do not claim raw operating-system filesystem, shell, process, or arbitrary network access. Use visible tools, configured providers, peer slots, and gates.

## Batching
- You can emit up to ${getMaxToolCalls()} tool calls per response.
- Default to batching independent read-only work.
- Use 4-${getMaxToolCalls()} independent read-only calls together when inspecting unrelated roots or files.
- Use all ${getMaxToolCalls()} tool-call slots when broad discovery has ${getMaxToolCalls()} independent read-only calls.
- Do not spend separate cycles on independent ListFiles, ListTools, ReadFile, Grep, or Find calls.
- Read-only tools run in PARALLEL. Mutating tools run sequentially after read-only tools.
- Discovery budget for build goals is ${BUILD_READ_ONLY_DISCOVERY_LIMIT} read-only batches. After that, use WriteFile, CreateTool, EditFile, Promote, or LoadModule instead of another read-only-only batch.

## Rules
- Act within configured HITL and security policy
- Use at least one tool per response (unless DONE)
- Batch independent tool calls by default
- Prefer REPLOID/0 TOOL blocks over escaped JSON
- After writing code: LOAD it, EXECUTE it, VERIFY it works
- Use ListFiles before assuming paths exist
- Default to Shadow for self changes: write evidence, receipts, rollback notes, and gate state before promotion
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
    const run = (goal) => startRun(goal, null);

    return {
      run,
      stop: () => {
        clearProviderResumeTimer();
        if (_abortController) _abortController.abort();
        _isRunning = false;
      },
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
      hasPendingProviderResume: () => !!_providerResumeState,
      getRecentActivities,
      getProviderRetryState: () => (_providerResumeState ? { ..._providerResumeState } : null),
      getProviderResumePromise: () => _providerResumePromise,
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
