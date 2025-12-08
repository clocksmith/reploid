/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '1.1.0', // Parallel read-only tool execution
    genesis: { introduced: 'tabula' },
    dependencies: [
      'Utils', 'EventBus', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager', 'CircuitBreaker', 'SchemaRegistry',
      'ReflectionStore?', 'ReflectionAnalyzer?', 'CognitionAPI?', 'MultiModelCoordinator?'
    ],
    type: 'core'
  },

  factory: (deps) => {
    const {
      Utils, EventBus, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager, CircuitBreaker, SchemaRegistry,
      ReflectionStore, ReflectionAnalyzer, CognitionAPI, MultiModelCoordinator
    } = deps;

    const { logger, Errors } = Utils;

    const MAX_ITERATIONS = 50;
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
    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

    // Debug visibility - track current context and system prompt
    let _currentContext = [];
    let _currentSystemPrompt = '';

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

          // Context management: compaction, warnings, and hard limit enforcement
          const contextResult = await ContextManager.manage(context, _modelConfig);
          context = contextResult.context;
          _syncContext(context);

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
              response = await LLMClient.chat(context, _modelConfig || _modelConfigs[0], streamCallback, { tools: toolSchemas });
            }
          } else {
            // Single model execution (with native tools if supported)
            response = await LLMClient.chat(context, _modelConfig, streamCallback, { tools: toolSchemas });
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

          // Use native tool calls if available, otherwise fall back to text parsing
          const toolCalls = response.toolCalls?.length > 0
            ? response.toolCalls
            : ResponseParser.parseToolCalls(responseContent);

          if (response.toolCalls?.length > 0) {
            logger.info(`[Agent] Using ${response.toolCalls.length} native tool call(s)`);
          }

          context.push({ role: 'assistant', content: responseContent });
          _syncContext(context);

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
                const { result, error } = await _executeToolWithRetry(call, iteration);
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

              const { result, error } = await _executeToolWithRetry(call, iteration);
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
                    const { result: chainedResult, error: chainedError } = await _executeToolWithRetry(chainedCall, iteration);
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

You are an autonomous agent running in a browser-based virtual filesystem (VFS).

## Getting Started
Read /docs/REPLOID.md for full documentation on:
- Available tools and their usage
- VFS structure and file operations
- Creating new tools (RSI)
- DI container and dependencies
- Worker system for parallel execution
- Cognition system (memory, knowledge graph)

## Quick Reference

Tool call format:
TOOL_CALL: ToolName
ARGS: { "key": "value" }

Essential tools:
- ListTools: see all available tools
- ListFiles: explore VFS directories
- ReadFile/WriteFile: read and write files
- CreateTool: create new runtime tools

## Batching Tool Calls

You can emit up to ${getMaxToolCalls()} tool calls per response. This is faster and more efficient.

Read-only tools (ReadFile, ListFiles, Grep, Find, ListTools, ListMemories) run in PARALLEL.
Mutating tools (WriteFile, DeleteFile, CreateTool) run sequentially for safety.

Example of batching multiple reads:
\`\`\`
I need to read the main config and the agent loop.

TOOL_CALL: ReadFile
ARGS: { "path": "/core/config.js" }

TOOL_CALL: ReadFile
ARGS: { "path": "/core/agent-loop.js" }

TOOL_CALL: ListFiles
ARGS: { "path": "/docs" }
\`\`\`

Always batch independent operations to minimize iterations.

## Rules
- Act autonomously - do not ask for permission
- Use at least one tool per response (unless DONE)
- Batch independent tool calls when possible
- Read /docs/REPLOID.md on your first turn for detailed instructions
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
      getContext: () => [..._currentContext],
      // Human-in-the-loop
      injectHumanMessage,
      getMessageQueue: () => [..._humanMessageQueue]
    };
  }
};

export default AgentLoop;
