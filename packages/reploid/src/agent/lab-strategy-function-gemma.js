/**
 * @fileoverview Lab strategy FunctionGemma routing.
 * Decides when a configured FunctionGemma orchestrator answers a cycle instead of
 * the selected model, prepares its experts once per configuration, and runs it.
 * A failed FunctionGemma call falls back to the selected model.
 */

export const getFunctionGemmaRoutingMode = (config) => {
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

export const shouldUseFunctionGemma = (text, config) => {
  if (!text) return false;

  const blocks = normalizePatterns(config?.autoBlocks, DEFAULT_FG_BLOCKS);
  if (matchesAny(text, blocks)) return false;

  const triggers = normalizePatterns(config?.autoTriggers, DEFAULT_FG_TRIGGERS);
  if (matchesAny(text, triggers)) return true;

  return config?.autoDefault === true;
};

export const getFunctionGemmaRoutingText = (context, goal, config) => {
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

export function createLabFunctionGemma({ deps, engine, loop }) {
  const { Utils, ContextManager, FunctionGemmaOrchestrator, TraceStore, EventBus } = deps;
  const { logger } = Utils;
  let _functionGemmaReady = false;
  let _functionGemmaHasPrefix = false;
  let _functionGemmaInitPromise = null;
  let _functionGemmaKey = null;

  const resolveFunctionGemmaConfig = () => {
    if (!FunctionGemmaOrchestrator) return null;
    const candidates = [
      loop.modelConfig?.functionGemma,
      loop.modelConfig?.functionGemmaConfig,
      loop.policy.legacyAgent.settings?.functionGemma
    ].filter(Boolean);

    if (candidates.length === 0) return null;
    const config = { ...candidates[0] };
    if (config.enabled === false) return null;
    return config;
  };

  const getFunctionGemmaModelId = (config) => {
    if (!config) return null;
    return config.modelId
      || config.baseModelId
      || config.model
      || config.baseModel
      || config.modelConfig?.modelId
      || config.modelConfig?.id
      || (loop.modelConfig?.provider === 'doppler' ? (loop.modelConfig.modelId || loop.modelConfig.id) : null);
  };

  const getFunctionGemmaModelConfig = (config) => {
    if (config?.modelConfig) return config.modelConfig;
    if (config?.baseModelConfig) return config.baseModelConfig;
    if (loop.modelConfig?.provider === 'doppler') return loop.modelConfig;
    return null;
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
      const systemPrompt = config.systemPrompt || loop.currentSystemPrompt;
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

  // Runs one cycle through FunctionGemma; on failure the caller asks the selected model.
  const generate = async ({
    context, iteration, functionGemmaConfig, functionGemmaRoutingText, functionGemmaModelId, llmStart, streamCallback
  }) => {
    let response;
    let functionGemmaResult = null;
    let functionGemmaInfo = null;
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

      functionGemmaResult = await engine.provider(() => FunctionGemmaOrchestrator.execute(task, { ...options, signal: loop.abortController.signal }));
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

      if (TraceStore && loop.traceSessionId) {
        await TraceStore.record(loop.traceSessionId, 'llm:response', {
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
      loop.abortController.signal.throwIfAborted();
      logger.error('[Agent] FunctionGemma execution failed, falling back to LLM:', error);
      response = null;
    }
    return { response, functionGemmaInfo };
  };

  return {
    resolveFunctionGemmaConfig,
    getFunctionGemmaModelId,
    ensureFunctionGemmaReady,
    resetFunctionGemmaState,
    isReady: () => _functionGemmaReady,
    generate
  };
}
