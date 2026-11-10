import { TURN_STOP } from './engine.js';
import {
  getLogicalToolFailureReasons,
  getLogicalToolResult,
  getRecoveryCallFromToolError,
  getToolExecutionFailureReason,
  isLogicalToolFailureResult,
  isRecoverableToolInputError,
  isRecoverableToolPreconditionError,
  isToolExecutionFailure
} from './lab-strategy-tool-results.js';

/**
 * @fileoverview Lab strategy tool execution.
 * Runs a response's tool calls through the engine: parse-error and circuit-breaker
 * prefiltering, the build progress gate, parallel read-only and sequential mutating
 * batches, hinted read-only recovery, result recording, and tool cooldown parking.
 */

export function createLabTools({ deps, engine, loop, pushActivity: _pushActivity, syncContext: _syncContext,
  isReadOnlyTool, getMaxToolCalls, getMutationProgressToolList,
  writeCycleOutcomeArtifacts: _writeCycleOutcomeArtifacts, BUILD_READ_ONLY_DISCOVERY_LIMIT }, { providerRecovery }) {
  const { Utils, EventBus, ToolRunner, CircuitBreaker, ToolExecutor, ReflectionStore } = deps;
  const { logger, Errors } = Utils;
  const { stringifyMessageContent } = deps.Policies;
  const { scheduleProviderResume } = providerRecovery;
  const TOOL_EXECUTION_TIMEOUT_MS = 30000; // 30 second timeout per tool

  // Track single-tool usage for batching nudges
  let _consecutiveSingleToolCalls = 0;
  const SINGLE_TOOL_NUDGE_THRESHOLD = 1; // Nudge after every single-tool iteration

  // Circuit breaker for failing tools - use shared utility
  const _toolCircuitBreaker = CircuitBreaker.create({
    threshold: 3,
    resetMs: 60000,
    name: 'AgentToolCircuit',
    emitEvents: true
  });

  const _recordToolExecutionError = (call, error, iteration) => {
    const message = error?.message || String(error);
    EventBus.emit('tool:error', { tool: call.name, error: message, cycle: iteration });
    if (isRecoverableToolInputError(error) || isRecoverableToolPreconditionError(call, error)) {
      EventBus.emit('tool:input_error', { tool: call.name, error: message, cycle: iteration });
      return;
    }
    _toolCircuitBreaker.recordFailure(call.name, error);
  };

  const _executeTool = async (call, iteration) => {
    if (!ToolExecutor) {
      throw new Errors.ConfigError('ToolExecutor not available');
    }
    try {
    const outcome = await engine.tool({
      call, policy: loop.policy, listToolNames: () => ToolRunner.list?.() || [],
      authorize: deps.authorizeTool,
      retry: { maxRetries: ToolExecutor.DEFAULT_MAX_RETRIES ?? 2, delayMs: 100 },
      execute: async (name, args, control) => {
        const execution = await ToolExecutor.executeWithRetry({ ...call, name, args }, {
        ...control, maxRetries: 0, invoke: engine.invoke, timeoutMs: TOOL_EXECUTION_TIMEOUT_MS, iteration,
        trace: loop.traceSessionId ? { sessionId: loop.traceSessionId, source: 'agent' } : null
        });
        if (execution.error) throw execution.error;
        return execution;
      }
    });
    if (outcome.status !== 'completed') throw outcome.error;
    return outcome.value;
    } catch (error) {
      if (loop.abortController?.signal.aborted) throw error;
      return { result: null, rawResult: null, error, duration: 0 };
    }
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

    const recoveryCall = getRecoveryCallFromToolError(call, first.error, isReadOnlyTool);
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

  // Executes one response's tool calls; returns TURN_STOP when a tool cooldown parks the attempt.
  const executeToolBatch = async (attempt, { toolCalls, modelUsed, stateBefore, responseContent }) => {
    const { goal, context, iteration, buildGoal, providerRetryAttempt } = attempt;
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
      && attempt.consecutiveReadOnlyBuildBatches >= BUILD_READ_ONLY_DISCOVERY_LIMIT;

    const allResults = [...preResults]; // Start with pre-filtered results

    // Execute read-only tools in PARALLEL
    if (mutationRequiredNow) {
      const gateMsg = `Build progress gate active after ${attempt.consecutiveReadOnlyBuildBatches} read-only discovery batches. Skipping read-only-only batch; next response must use ${getMutationProgressToolList()}, or say DONE with a concrete blocker.`;
      logger.warn(`[Agent] ${gateMsg}`);
      EventBus.emit('agent:warning', {
        type: 'build_progress_gate',
        cycle: iteration,
        consecutiveReadOnlyBatches: attempt.consecutiveReadOnlyBuildBatches,
        readOnlyTools: readOnlyCalls.map((call) => call.name)
      });
      EventBus.emit('agent:history', {
        type: 'build_progress_gate',
        cycle: iteration,
        content: gateMsg,
        consecutiveReadOnlyBatches: attempt.consecutiveReadOnlyBuildBatches,
        readOnlyTools: readOnlyCalls.map((call) => call.name),
        ts: Date.now()
      });
      _pushActivity({
        kind: 'build_progress_gate',
        cycle: iteration,
        consecutiveReadOnlyBatches: attempt.consecutiveReadOnlyBuildBatches,
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
        attempt.consecutiveReadOnlyBuildBatches = 0;
        attempt.mutationGateAnnounced = false;
      } else if (readOnlyCalls.length > 0) {
        attempt.consecutiveReadOnlyBuildBatches++;
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
        attempt.providerParked = true;
        attempt.scheduledProviderResume = true;
        attempt.providerParkReason = `Tool cooldown active; retry scheduled`;
        scheduleProviderResume({
          goal,
          context,
          iteration,
          providerRetryAttempt,
          consecutiveReadOnlyBuildBatches: attempt.consecutiveReadOnlyBuildBatches,
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
  };

  return {
    resetToolCircuitBreaker: () => _toolCircuitBreaker.reset(),
    executeToolBatch
  };
}
