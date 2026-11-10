/**
 * @fileoverview Lab strategy cycle preparation.
 * Paces cycles, prepares each cycle's context (reflection insights, context
 * management, queued human messages, cognition and memory enrichment, the managed
 * provider envelope and the build progress gate), records the model request, and
 * detects stuck loops.
 */

export function createLabCycle({ deps, loop, pushActivity: _pushActivity, syncContext: _syncContext,
  sleepWithAbort, isReadOnlyTool, humanMessageQueue: _humanMessageQueue, getMutationProgressToolList,
  BUILD_READ_ONLY_DISCOVERY_LIMIT }, { generation }) {
  const { Utils, EventBus, ToolRunner, ContextManager, ReflectionAnalyzer, CognitionAPI, MemoryManager } = deps;
  const { logger } = Utils;
  const {
    compactContextForManagedProvider,
    getToolSchemaName,
    measureContextChars,
    renderModelContextForTrace,
    stringifyMessageContent
  } = deps.Policies;
  const { chatWithProviderThrottle } = generation;
  const MAX_NO_PROGRESS_ITERATIONS = 5; // Max consecutive iterations without tool calls
  let _lastModelRequestSnapshot = [];

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

  const resetModelRequestSnapshot = () => {
    _lastModelRequestSnapshot = [];
  };

  const getAgentCycleIntervalMs = () => loop.policy.legacyAgent.settings?.cycleIntervalMs ?? 0;

  const waitForCycleInterval = async (nextIteration) => {
    if (nextIteration <= 1) return;
    const delayMs = getAgentCycleIntervalMs(loop.modelConfig);
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
    await sleepWithAbort(delayMs, loop.abortController?.signal);
  };

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
        const summaryResponse = await chatWithProviderThrottle(context, loop.modelConfig, null, undefined, iteration);
        _pushActivity({ kind: 'stuck_summary', cycle: iteration, content: summaryResponse.content });
        EventBus.emit('agent:history', { type: 'llm_response', cycle: iteration, content: summaryResponse.content });
      } catch (e) {
        logger.error('[Agent] Failed to get summary response', e);
      }
      return true;
    }
    return healthCheck.action === 'force_stop';
  };

  // Prepares the attempt context before the model request; replaced contexts are stored on the attempt.
  const prepareCycleContext = async (attempt) => {
    const { iteration } = attempt;
    let { context } = attempt;
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
    const contextResult = await ContextManager.manage(context, loop.modelConfig);
    context = contextResult.context;
    attempt.context = context;
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
          attempt.context = context;
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

    const envelopeResult = compactContextForManagedProvider(context, loop.modelConfig || loop.modelConfigs[0]);
    if (envelopeResult.changed) {
      context = envelopeResult.context;
      attempt.context = context;
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
  };

  // Applies the build progress gate to the offered tools and records the model request.
  const announceModelRequest = (attempt) => {
    const { context, iteration, buildGoal, consecutiveReadOnlyBuildBatches } = attempt;
    // Get tool schemas for native tool calling (if supported)
    const toolSchemas = ToolRunner.getToolSchemas ? ToolRunner.getToolSchemas() : [];
    const mutationGateActive = buildGoal && consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;
    const activeToolSchemas = mutationGateActive
      ? filterToolSchemasForMutation(toolSchemas)
      : toolSchemas;
    if (mutationGateActive && !attempt.mutationGateAnnounced) {
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
      attempt.mutationGateAnnounced = true;
    }

    const providerInputChars = measureContextChars(context);
    const offeredToolNames = activeToolSchemas
      .map((schema) => getToolSchemaName(schema))
      .filter(Boolean);
    const requestModel = loop.modelConfig || loop.modelConfigs[0] || null;
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
    return activeToolSchemas;
  };

  return {
    resetModelRequestSnapshot,
    waitForCycleInterval,
    resetLoopHealth: _resetLoopHealth,
    checkLoopHealth: _checkLoopHealth,
    handleStuckLoop: _handleStuckLoop,
    prepareCycleContext,
    announceModelRequest
  };
}
