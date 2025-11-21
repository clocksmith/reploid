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
    let _isRunning = false;
    let _abortController = null;
    let _modelConfig = null;
    const MAX_ACTIVITY_LOG = 200;
    const _activityLog = [];

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

          if (toolCalls.length > 0) {
            let executedTools = 0;
            for (const call of toolCalls) {
              if (executedTools >= MAX_TOOL_CALLS_PER_ITERATION) {
                const limitMsg = `Tool call limit (${MAX_TOOL_CALLS_PER_ITERATION}) reached for this iteration. Finish current thoughts or continue next turn.`;
                logger.warn('[Agent] ' + limitMsg);
                context.push({ role: 'system', content: limitMsg });
                break;
              }

              if (_abortController.signal.aborted) break;

              logger.info(`[Agent] Tool Call: ${call.name}`);
              EventBus.emit('agent:status', { state: 'ACTING', activity: `Executing tool: ${call.name}` });

              let result;
              try {
                const rawResult = await ToolRunner.execute(call.name, call.args);
                result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
              } catch (err) {
                logger.error(`[Agent] Tool Error: ${call.name}`, err);
                result = `Error: ${err.message}`;
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
            let continuationMsg = 'Continue with your task. Use a tool or declare completion with "DONE".';
            if (iteration > 5) {
              continuationMsg = 'You are chattering without acting. Please use a tool or declare completion with "DONE".';
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

## Core Tools
- code_intel: Analyze file structure (imports, exports, functions). *USE THIS FIRST* to save tokens before reading large files. Args: { "path": "/path/to/file" }
- read_file: Read file content. Args: { "path": "/path/to/file" }
- write_file: Create/Overwrite file. Args: { "path": "/path/to/file", "content": "..." }
- delete_file: Remove a file. Args: { "path": "/path/to/file" }
- list_files: List directory. Args: { "path": "/" }
- create_tool: Create new tool (RSI L1). Args: { "name": "x", "code": "..." }
- improve_core_module: Rewrite core module (RSI L2). Args: { "module": "x", "code": "..." }
${ToolRunner.has('load_module') ? '- load_module: Hot-reload module (RSI L3). Args: { "path": "/path/to/module.js" }' : ''}

## Protocol
1. **THINK**: Plan your next step.
2. **ACT**: Use tools via format:
TOOL_CALL: tool_name
ARGS: { ... }
3. Always inspect the VFS with list_files before reading. Only read paths that actually exist (e.g., /core/..., /tools/...). If a file is missing, create it instead of repeatedly requesting it.

## Goal
${goal}
`;

      return [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: `Start. Goal: ${goal}` }
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
