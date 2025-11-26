/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '2.4.1',
    dependencies: [
      'Utils', 'EventBus', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'ReflectionStore?', 'ReflectionAnalyzer?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    const {
      Utils, EventBus, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, ReflectionStore, ReflectionAnalyzer
    } = deps;

    const { logger, Errors } = Utils;

    const MAX_ITERATIONS = 50;
    const MAX_TOOL_CALLS_PER_ITERATION = 3;
    const MAX_NO_PROGRESS_ITERATIONS = 5; // Max consecutive iterations without tool calls
    const TOOL_EXECUTION_TIMEOUT_MS = 30000; // 30 second timeout per tool
    let _isRunning = false;
    let _abortController = null;
    let _modelConfig = null;
    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

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

    // Circuit breaker for failing tools
    const CIRCUIT_THRESHOLD = 3; // Failures before circuit opens
    const CIRCUIT_RESET_MS = 60000; // 1 minute cooldown
    const _toolCircuits = new Map(); // tool -> { count, lastError, tripTime }

    const _isCircuitOpen = (toolName) => {
      const record = _toolCircuits.get(toolName);
      if (!record) return false;

      if (record.count >= CIRCUIT_THRESHOLD) {
        const elapsed = Date.now() - record.tripTime;
        if (elapsed < CIRCUIT_RESET_MS) {
          return true; // Circuit still open
        }
        // Reset after cooldown
        _toolCircuits.delete(toolName);
        logger.info(`[Agent] Circuit breaker reset for tool: ${toolName}`);
      }
      return false;
    };

    const _recordToolFailure = (toolName, error) => {
      const record = _toolCircuits.get(toolName) || { count: 0, lastError: null, tripTime: 0 };
      record.count++;
      record.lastError = error;

      if (record.count >= CIRCUIT_THRESHOLD) {
        record.tripTime = Date.now();
        logger.warn(`[Agent] Circuit breaker TRIPPED for tool: ${toolName} after ${record.count} failures`);
        EventBus.emit('tool:circuit_open', { tool: toolName, failures: record.count, error });
      }

      _toolCircuits.set(toolName, record);
    };

    const _recordToolSuccess = (toolName) => {
      // Reset failure count on success
      if (_toolCircuits.has(toolName)) {
        _toolCircuits.delete(toolName);
      }
    };

    const _resetCircuits = () => {
      _toolCircuits.clear();
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

    const run = async (goal) => {
      if (_isRunning) throw new Errors.StateError('Agent already running');
      if (!_modelConfig) throw new Errors.ConfigError('No model configured');

      _isRunning = true;
      _abortController = new AbortController();
      _resetLoopHealth();
      _resetCircuits();

      logger.info(`[Agent] Starting cycle. Goal: "${goal}"`);
      EventBus.emit('agent:status', { state: 'STARTING', activity: 'Initializing...' });

      await StateManager.setGoal(goal);
      let context = await _buildInitialContext(goal);
      let iteration = 0;

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

          context = await ContextManager.compact(context, _modelConfig);

          // Emit token count for UI
          if (ContextManager.emitTokens) {
            ContextManager.emitTokens(context);
          }

          let llmResponseText = '';
          const streamCallback = (text) => {
            EventBus.emit('agent:stream', text);
            llmResponseText += text;
          };

          const response = await LLMClient.chat(context, _modelConfig, streamCallback);

          const llmEvent = {
            type: 'llm_response',
            cycle: iteration,
            content: response.content
          };
          EventBus.emit('agent:history', llmEvent);
          _pushActivity({ kind: 'llm_response', cycle: iteration, content: response.content });

          const responseContent = response?.content || '';
          const toolCalls = ResponseParser.parseToolCalls(responseContent);
          context.push({ role: 'assistant', content: responseContent });

          // Check for stuck loop
          const healthCheck = _checkLoopHealth(iteration, toolCalls.length, responseContent.length);
          if (healthCheck.stuck) {
            logger.warn(`[Agent] STUCK LOOP DETECTED: ${healthCheck.reason}`);
            EventBus.emit('agent:warning', {
              type: 'stuck_loop',
              reason: healthCheck.reason,
              cycle: iteration
            });

            if (healthCheck.action === 'request_summary') {
              // Ask model to summarize and conclude
              context.push({
                role: 'user',
                content: 'SYSTEM: You appear to be stuck without making progress. Please summarize what you have accomplished so far and what remains to be done, then stop.'
              });
              // Get one more response then exit
              try {
                const summaryResponse = await LLMClient.chat(context, _modelConfig);
                _pushActivity({ kind: 'stuck_summary', cycle: iteration, content: summaryResponse.content });
                EventBus.emit('agent:history', { type: 'llm_response', cycle: iteration, content: summaryResponse.content });
              } catch (e) {
                logger.error('[Agent] Failed to get summary response', e);
              }
              break;
            } else if (healthCheck.action === 'force_stop') {
              break;
            }
          }

          if (toolCalls.length > 0) {
            let executedTools = 0;
            for (const call of toolCalls) {
              if (executedTools >= MAX_TOOL_CALLS_PER_ITERATION) {
                const limitMsg = `Tool call limit (${MAX_TOOL_CALLS_PER_ITERATION}) reached for this iteration. Continue next turn.`;
                logger.warn('[Agent] ' + limitMsg);
                context.push({ role: 'user', content: limitMsg });
                break;
              }

              if (_abortController.signal.aborted) break;

              // Check for parse errors before executing
              if (call.error) {
                logger.warn(`[Agent] Tool ${call.name} has parse error: ${call.error}`);
                const result = `Error: ${call.error}`;
                context.push({ role: 'user', content: `TOOL_RESULT (${call.name}):\n${result}` });
                EventBus.emit('agent:history', { type: 'tool_result', cycle: iteration, tool: call.name, args: {}, result });
                _pushActivity({ kind: 'tool_error', cycle: iteration, tool: call.name, error: call.error });
                executedTools++;
                continue;
              }

              // Check circuit breaker before executing
              if (_isCircuitOpen(call.name)) {
                const circuitRecord = _toolCircuits.get(call.name);
                const remainingMs = CIRCUIT_RESET_MS - (Date.now() - circuitRecord.tripTime);
                const remainingSec = Math.ceil(remainingMs / 1000);
                logger.warn(`[Agent] Circuit breaker OPEN for ${call.name} - skipping (${remainingSec}s remaining)`);

                const skipMsg = `Tool ${call.name} is temporarily disabled due to repeated failures. Last error: ${circuitRecord.lastError}. Will retry in ${remainingSec}s.`;
                context.push({ role: 'user', content: `TOOL_RESULT (${call.name}):\nError: ${skipMsg}` });
                EventBus.emit('tool:circuit_skip', { tool: call.name, remainingMs, lastError: circuitRecord.lastError });
                continue;
              }

              logger.info(`[Agent] Tool Call: ${call.name}`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing tool: ${call.name}` });

              let result;
              const MAX_RETRIES = 2;
              let lastError = null;

              // Helper to execute with timeout
              const executeWithTimeout = async () => {
                return Promise.race([
                  ToolRunner.execute(call.name, call.args),
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool timeout after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)), TOOL_EXECUTION_TIMEOUT_MS)
                  )
                ]);
              };

              for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                  const toolStartTime = Date.now();
                  const rawResult = await executeWithTimeout();
                  const toolDuration = Date.now() - toolStartTime;

                  // Warn on slow tools
                  if (toolDuration > TOOL_EXECUTION_TIMEOUT_MS * 0.7) {
                    logger.warn(`[Agent] Slow tool: ${call.name} took ${toolDuration}ms`);
                    EventBus.emit('tool:slow', { tool: call.name, ms: toolDuration, cycle: iteration });
                  }

                  result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
                  // Validate serialization didn't produce undefined
                  if (result === 'undefined' || result === undefined) {
                    result = '(Tool returned no output)';
                  }
                  lastError = null;
                  break;
                } catch (err) {
                  lastError = err;
                  const isTimeout = err.message?.includes('timeout');

                  if (isTimeout) {
                    logger.error(`[Agent] Tool ${call.name} TIMEOUT - exceeded ${TOOL_EXECUTION_TIMEOUT_MS}ms`);
                    result = `Error: Tool execution timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s. The operation may still be running.`;
                    EventBus.emit('tool:timeout', { tool: call.name, timeout: TOOL_EXECUTION_TIMEOUT_MS, cycle: iteration });
                    break; // Don't retry on timeout
                  }

                  if (attempt < MAX_RETRIES) {
                    logger.warn(`[Agent] Tool ${call.name} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
                    await new Promise(r => setTimeout(r, 100 * (attempt + 1))); // Exponential backoff
                  }
                }
              }

              if (lastError && !result) {
                logger.error(`[Agent] Tool Error: ${call.name}`, lastError);
                result = `Error: ${lastError.message}`;
                EventBus.emit('tool:error', { tool: call.name, error: lastError.message, cycle: iteration });
                // Record failure for circuit breaker
                _recordToolFailure(call.name, lastError.message);
              } else if (!lastError) {
                // Record success - resets circuit breaker count
                _recordToolSuccess(call.name);
              }

              // Smart truncation
              if (result.length > 5000 && call.name !== 'read_file') {
                  result = result.substring(0, 5000) + "\n... [OUTPUT TRUNCATED. USE code_intel OR read_file FOR DETAILS] ...";
              }

              context.push({
                role: 'user',
                content: `TOOL_RESULT (${call.name}):\n${result}`
              });

              const toolEvent = {
                type: 'tool_result',
                cycle: iteration,
                tool: call.name,
                args: call.args,
                result: result
              };
              EventBus.emit('agent:history', toolEvent);
              _pushActivity({ kind: 'tool_result', cycle: iteration, tool: call.name, args: call.args, result });

              _logReflection(call, result, iteration);
              executedTools++;
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

## Tools
- list_files: explore directories
- read_file: read file contents
- write_file: create or modify files
- delete_file: remove files
- create_tool: make new tools in /tools/
- improve_core_module: modify core modules

## Tool Call Format
TOOL_CALL: tool_name
ARGS: { "key": "value" }

Example:
TOOL_CALL: read_file
ARGS: { "path": "/core/agent-loop.js" }

## Rules
- Act autonomously. Do not ask for permission.
- Every response must use at least one tool unless declaring DONE.
- Iterate: analyze results, identify improvements, apply them, repeat.
- When you modify code, check write_file output for syntax warnings. Fix any errors before proceeding.
- For recursive self-improvement: after achieving a goal, consider what blockers or inefficiencies you encountered and refactor them.
- Say DONE only when the goal is fully achieved AND all written code is verified (no syntax errors).

## Goal
${goal}
`;

      return [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: `Begin. Goal: ${goal}` }
      ];
    };

    const getRecentActivities = () => [..._activityLog];

    return {
      run,
      stop: () => { if (_abortController) _abortController.abort(); _isRunning = false; },
      setModel: (c) => { _modelConfig = c; },
      isRunning: () => _isRunning,
      getRecentActivities
    };
  }
};

export default AgentLoop;
