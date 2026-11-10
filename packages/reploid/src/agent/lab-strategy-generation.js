import { getModelIdentity } from './lab-strategy-provider-recovery.js';
import {
  getFunctionGemmaRoutingMode,
  getFunctionGemmaRoutingText,
  shouldUseFunctionGemma
} from './lab-strategy-function-gemma.js';

/**
 * @fileoverview Lab strategy model generation.
 * Throttles provider requests, falls back across configured models through the
 * engine, chooses FunctionGemma, multi-model or single-model generation for a
 * cycle, and records the interpreted response.
 */

export function createLabGeneration({ deps, engine, loop, pushActivity: _pushActivity,
  syncContext: _syncContext, sleepWithAbort, writeCycleArtifact: _writeCycleArtifact }, { functionGemma, providerRecovery }) {
  const {
    Utils, EventBus, LLMClient, ContextManager, ResponseParser, CognitionAPI, MultiModelCoordinator, TraceStore,
    MemoryManager
  } = deps;
  const { logger } = Utils;
  const { getProviderErrorStatus } = deps.Policies;
  const { getProviderThrottleConfig } = providerRecovery;
  const { getFunctionGemmaModelId } = functionGemma;
  let _lastProviderRequestAt = null;

  const findConfiguredModel = (modelId) => {
    const id = String(modelId || '');
    const all = [loop.modelConfig, ...loop.modelConfigs].filter(Boolean);
    return all.find((model) => (
      String(model.id || model.model || model.modelId || '') === id
    )) || loop.modelConfig || all[0] || null;
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
      await sleepWithAbort(delayMs, loop.abortController?.signal);
    }

    _lastProviderRequestAt = Date.now();
  };

  const chatWithProviderThrottle = async (context, model, streamCallback, options, iteration) => {
    await applyProviderRequestThrottle(model, iteration);
    const signal = loop.abortController.signal;
    return LLMClient.chat(context, model, chunk => {
      if (!signal.aborted && !loop.closed) streamCallback?.(chunk);
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
    add(primaryModel || loop.modelConfig || loop.modelConfigs[0]);
    loop.modelConfigs.forEach(add);
    if (loop.modelConfig) add(loop.modelConfig);
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
        loop.modelConfig = model;
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

  // Asks FunctionGemma, the multi-model coordinator or the selected model for one response.
  const generate = async (attempt, { activeToolSchemas, functionGemmaConfig, functionGemmaEnabled }) => {
    const { goal, context, iteration } = attempt;
    const streamCallback = (text) => {
      EventBus.emit('agent:stream', text);
    };

    // Multi-model execution if multiple models configured
    let response;
    let arenaResult = null;
    let functionGemmaInfo = null;
    let activeLlmModel = loop.modelConfig || loop.modelConfigs[0] || null;

    const llmStart = Date.now();
    const multiModelActive = loop.modelConfigs.length >= 2 && MultiModelCoordinator;
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
      && functionGemma.isReady()
      && functionGemmaRoutingMode !== 'disabled'
      && functionGemmaAutoOk
      && (!multiModelActive || functionGemmaConfig?.overrideMultiModel);

    if (TraceStore && loop.traceSessionId) {
      const tags = ['llm'];
      if (useFunctionGemma) tags.push('functiongemma');
      await TraceStore.record(loop.traceSessionId, 'llm:request', {
        source: 'agent',
        iteration,
        modelId: useFunctionGemma ? functionGemmaModelId : (loop.modelConfig?.id || null),
        messageCount: context.length,
        messages: context.slice(-10)
      }, { tags });
    }

    if (useFunctionGemma) {
      ({ response, functionGemmaInfo } = await functionGemma.generate({
        context, iteration, functionGemmaConfig, functionGemmaRoutingText, functionGemmaModelId, llmStart, streamCallback
      }));
    }

    if (!response && multiModelActive) {
      logger.info(`[Agent] Multi-model mode: ${loop.modelConfigs.length} models, strategy: ${loop.consensusStrategy}`);

      const multiModelConfig = {
        mode: loop.consensusStrategy === 'peer-review' ? 'consensus' : loop.consensusStrategy,
        models: loop.modelConfigs
      };

      const onUpdate = (update) => {
        EventBus.emit('agent:multimodel-update', update);
      };

      try {
        arenaResult = await engine.provider(() => MultiModelCoordinator.execute(context,
          { ...multiModelConfig, signal: loop.abortController.signal }, update => {
            if (!loop.abortController.signal.aborted && !loop.closed) onUpdate(update);
          }));
        response = arenaResult.result;
        if (TraceStore && loop.traceSessionId) {
          await TraceStore.record(loop.traceSessionId, 'llm:response', {
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
        loop.abortController.signal.throwIfAborted();
        logger.error('[Agent] Multi-model execution failed, falling back to single model:', error);
        const recoveryResult = await chatWithProviderRecovery({
          context,
          primaryModel: loop.modelConfig || loop.modelConfigs[0],
          streamCallback,
          toolSchemas: activeToolSchemas,
          iteration
        });
        response = recoveryResult.response;
        activeLlmModel = recoveryResult.modelConfig;
        if (TraceStore && loop.traceSessionId) {
          await TraceStore.record(loop.traceSessionId, 'llm:response', {
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
        primaryModel: loop.modelConfig,
        streamCallback,
        toolSchemas: activeToolSchemas,
        iteration
      });
      response = recoveryResult.response;
      activeLlmModel = recoveryResult.modelConfig;
      if (TraceStore && loop.traceSessionId) {
        await TraceStore.record(loop.traceSessionId, 'llm:response', {
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
    return { response, arenaResult, functionGemmaInfo, activeLlmModel, llmStart };
  };

  // Interprets and records a response, then appends it to the attempt context.
  const recordResponse = async (attempt, {
    response, arenaResult, functionGemmaInfo, activeLlmModel, llmStart, stateBefore
  }) => {
    const { goal, context, iteration } = attempt;
    const interpreted = engine.interpret(response, text => ResponseParser.parseToolCalls(text));
    const responseContent = interpreted.content;
    const usage = response?.usage || {};
    const lastUserMessage = [...context].reverse().find(m => m.role === 'user');
    const responseModel = functionGemmaInfo?.modelId || arenaResult?.winner?.model || activeLlmModel?.id || loop.modelConfig?.id || null;
    const responseProvider = functionGemmaInfo?.provider || arenaResult?.winner?.provider || activeLlmModel?.provider || loop.modelConfig?.provider || null;
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
    return { responseContent, toolCalls, modelUsed };
  };

  return { chatWithProviderThrottle, generate, recordResponse };
}
