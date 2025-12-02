/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '2.5.0',
    dependencies: [
      'Utils', 'EventBus', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'CircuitBreaker',
      'ReflectionStore?', 'ReflectionAnalyzer?', 'CognitionAPI?', 'MultiModelCoordinator?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    const {
      Utils, EventBus, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, CircuitBreaker,
      ReflectionStore, ReflectionAnalyzer, CognitionAPI, MultiModelCoordinator
    } = deps;

    const { logger, Errors } = Utils;

    const MAX_ITERATIONS = 50;
    const MAX_TOOL_CALLS_PER_ITERATION = 3;
    const MAX_NO_PROGRESS_ITERATIONS = 5; // Max consecutive iterations without tool calls
    const TOOL_EXECUTION_TIMEOUT_MS = 30000; // 30 second timeout per tool
    let _isRunning = false;
    let _abortController = null;
    let _modelConfig = null;
    let _modelConfigs = []; // Array of models for multi-model mode
    let _consensusStrategy = 'arena'; // arena, peer-review, swarm
    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

    // Debug visibility - track current context and system prompt
    let _currentContext = [];
    let _currentSystemPrompt = '';

    // Helper to update tracked context whenever it changes
    const _syncContext = (context) => {
      _currentContext = [...context];
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

    /**
     * Execute a tool with retry logic and timeout
     * @param {Object} call - Tool call object { name, args }
     * @param {number} iteration - Current iteration number
     * @returns {Promise<{result: string, error: Error|null}>}
     */
    const _executeToolWithRetry = async (call, iteration) => {
      const MAX_RETRIES = 2;
      let result = null;
      let lastError = null;

      const executeWithTimeout = () => Promise.race([
        ToolRunner.execute(call.name, call.args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool timeout after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)), TOOL_EXECUTION_TIMEOUT_MS)
        )
      ]);

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
            break;
          }

          if (attempt < MAX_RETRIES) {
            logger.warn(`[Agent] Tool ${call.name} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          }
        }
      }

      return { result, error: lastError };
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
      if (result.length > 5000 && call.name !== 'read_file') {
        processedResult = result.substring(0, 5000) + "\n... [OUTPUT TRUNCATED. USE code_intel OR read_file FOR DETAILS] ...";
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
      let context = await _buildInitialContext(goal);
      let iteration = 0;

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

          context = await ContextManager.compact(context, _modelConfig);
          _syncContext(context);

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

          // Emit token count for UI and enforce hard limit
          if (ContextManager.emitTokens) {
            ContextManager.emitTokens(context);
          }

          // CRITICAL SAFETY: Check hard token limit
          if (ContextManager.exceedsHardLimit) {
            const limitCheck = ContextManager.exceedsHardLimit(context);
            if (limitCheck.exceeded) {
              logger.error(`[Agent] STOPPING: Token limit exceeded (${limitCheck.tokens}/${limitCheck.limit})`);
              EventBus.emit('agent:error', {
                error: `Context too large: ${limitCheck.tokens} tokens exceeds ${limitCheck.limit} limit. Agent stopped for safety.`,
                cycle: iteration
              });
              throw new Error(`Token limit exceeded: ${limitCheck.tokens}/${limitCheck.limit} tokens`);
            }
          }

          let llmResponseText = '';
          const streamCallback = (text) => {
            EventBus.emit('agent:stream', text);
            llmResponseText += text;
          };

          // Multi-model execution if multiple models configured
          let response;
          let arenaResult = null;

          if (_modelConfigs.length >= 2 && MultiModelCoordinator) {
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
              response = await LLMClient.chat(context, _modelConfig || _modelConfigs[0], streamCallback);
            }
          } else {
            // Single model execution
            response = await LLMClient.chat(context, _modelConfig, streamCallback);
          }

          const llmEvent = {
            type: 'llm_response',
            cycle: iteration,
            content: response.content
          };
          EventBus.emit('agent:history', llmEvent);
          _pushActivity({ kind: 'llm_response', cycle: iteration, content: response.content });

          const responseContent = response?.content || '';

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

          const toolCalls = ResponseParser.parseToolCalls(responseContent);
          context.push({ role: 'assistant', content: responseContent });
          _syncContext(context);

          // Check for stuck loop
          const healthCheck = _checkLoopHealth(iteration, toolCalls.length, responseContent.length);
          if (healthCheck.stuck) {
            const shouldBreak = await _handleStuckLoop(healthCheck, context, iteration);
            if (shouldBreak) break;
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
              if (_toolCircuitBreaker.isOpen(call.name)) {
                const circuitState = _toolCircuitBreaker.getState(call.name);
                const remainingMs = 60000 - (Date.now() - circuitState.tripTime);
                const remainingSec = Math.ceil(remainingMs / 1000);
                logger.warn(`[Agent] Circuit breaker OPEN for ${call.name} - skipping (${remainingSec}s remaining)`);

                const skipMsg = `Tool ${call.name} is temporarily disabled due to repeated failures. Last error: ${circuitState.lastError}. Will retry in ${remainingSec}s.`;
                context.push({ role: 'user', content: `TOOL_RESULT (${call.name}):\nError: ${skipMsg}` });
                EventBus.emit('tool:circuit_skip', { tool: call.name, remainingMs, lastError: circuitState.lastError });
                continue;
              }

              logger.info(`[Agent] Tool Call: ${call.name}`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing tool: ${call.name}` });

              const { result, error } = await _executeToolWithRetry(call, iteration);

              // Handle execution result
              let finalResult = result;
              if (error && !result) {
                logger.error(`[Agent] Tool Error: ${call.name}`, error);
                finalResult = `Error: ${error.message}`;
                EventBus.emit('tool:error', { tool: call.name, error: error.message, cycle: iteration });
                _toolCircuitBreaker.recordFailure(call.name, error);
              } else if (!error) {
                _toolCircuitBreaker.recordSuccess(call.name);
              }

              _processToolResult(call, finalResult, iteration, context);
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

### Discovery
- list_tools: returns array of all available tool names (no args)
- list_files: explore directories { "path": "/dir/" }

### File Operations
- read_file: read file contents { "path": "/file.js" }
- write_file: create or modify files { "path": "/file.js", "content": "..." }
  - CRITICAL: "path" parameter is REQUIRED and must be a string starting with /
  - "content" parameter is REQUIRED and must be a string
  - For multiline content, use \\n for newlines, not literal newlines
- delete_file: remove files { "path": "/file.js" }

### Self-Modification (RSI)
- create_tool: create new tool in /tools/ { "name": "my_tool", "code": "..." }
  - name MUST be lowercase with underscores only (e.g., "my_tool" not "MyTool")
  - code MUST include: export const tool = {...} and export default call;
- load_module: hot-reload any module { "path": "/capabilities/x.js" }
- To modify /core/ files, use write_file directly

### File Utilities
- search_content: search file contents for pattern { "pattern": "text", "path": "/dir", "recursive": true, "ignoreCase": false }
- find_by_name: find files by name pattern { "path": "/dir", "name": "*.js" }
- git: version control operations { "command": "status|log|diff|add|commit", "path": "...", "message": "..." }
- create_directory: create directory { "path": "/new/dir", "parents": true }
- remove: delete file or directory { "path": "/file", "recursive": false, "force": false }
- move: move or rename { "source": "/old", "dest": "/new" }
- copy: copy file or directory { "source": "/file", "dest": "/copy", "recursive": false }

## File Discovery Protocol
- ALWAYS use list_files to discover actual file paths BEFORE attempting to read them
- NEVER assume or guess file paths based on typical naming patterns
- If a file doesn't exist, DO NOT retry with similar guessed names - the path is wrong
- Use find_by_name or search_content to search for files by name or content
- Respect error messages - "file not found" means the path is incorrect, not a transient error

## Tool Call Format
TOOL_CALL: tool_name
ARGS: { "key": "value" }

Example:
TOOL_CALL: list_tools
ARGS: {}

Example:
TOOL_CALL: read_file
ARGS: { "path": "/core/agent-loop.js" }

Example (write_file with multiline content):
TOOL_CALL: write_file
ARGS: { "path": "/tools/my_tool.js", "content": "export const tool = {\\n  name: 'my_tool',\\n  execute: async () => 'result'\\n};" }

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
      setModel: (c) => { _modelConfig = c; },
      setModels: (models) => {
        _modelConfigs = models || [];
        // Set primary model as first one for fallback
        if (models && models.length > 0) {
          _modelConfig = models[0];
        }
      },
      setConsensusStrategy: (strategy) => { _consensusStrategy = strategy || 'arena'; },
      isRunning: () => _isRunning,
      getRecentActivities,
      // Debug visibility
      getSystemPrompt: () => _currentSystemPrompt,
      getContext: () => [..._currentContext]
    };
  }
};

export default AgentLoop;
