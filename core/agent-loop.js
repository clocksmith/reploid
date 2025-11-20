/**
 * @fileoverview Agent Loop
 * The main cognitive cycle: Think -> Act -> Observe.
 */

const AgentLoop = {
  metadata: {
    id: 'AgentLoop',
    version: '2.0.0',
    dependencies: [
      'Utils', 'LLMClient', 'ToolRunner', 'ContextManager',
      'ResponseParser', 'StateManager', 'PersonaManager'
    ],
    type: 'core'
  },

  factory: (deps) => {
    const {
      Utils, LLMClient, ToolRunner, ContextManager,
      ResponseParser, StateManager, PersonaManager
    } = deps;

    const { logger, Errors } = Utils;

    // --- Configuration ---
    const MAX_ITERATIONS = 50; // Safety break
    let _isRunning = false;
    let _abortController = null;
    let _modelConfig = null;

    // --- Core Logic ---

    const run = async (goal) => {
      if (_isRunning) throw new Errors.StateError('Agent already running');
      if (!_modelConfig) throw new Errors.ConfigError('No model configured');

      _isRunning = true;
      _abortController = new AbortController();

      logger.info(`[Agent] Starting cycle. Goal: "${goal}"`);

      // 1. Initialize State & Context
      await StateManager.setGoal(goal);
      let context = await _buildInitialContext(goal);
      let iteration = 0;

      try {
        while (_isRunning && iteration < MAX_ITERATIONS) {
          if (_abortController.signal.aborted) break;

          iteration++;
          await StateManager.incrementCycle();
          logger.info(`[Agent] Iteration ${iteration}`);

          // 2. Context Management (Compression)
          context = await ContextManager.compact(context, _modelConfig);

          // 3. Think (LLM Call)
          // We stream the response for better UX, but accumulate for logic
          let llmResponseText = '';
          const streamCallback = (text) => {
            // In a real app, emit this to UI via EventBus
            // EventBus.emit('agent:stream', text);
            llmResponseText += text;
          };

          const response = await LLMClient.chat(context, _modelConfig, streamCallback);

          // 4. Observe & Parse
          const toolCalls = ResponseParser.parseToolCalls(response.content);

          // Add Assistant response to history
          context.push({ role: 'assistant', content: response.content });

          // 5. Act (Tool Execution)
          if (toolCalls.length > 0) {
            for (const call of toolCalls) {
              if (_abortController.signal.aborted) break;

              logger.info(`[Agent] Tool Call: ${call.name}`);

              let result;
              try {
                // Execute via ToolRunner
                const rawResult = await ToolRunner.execute(call.name, call.args);
                result = JSON.stringify(rawResult, null, 2); // Standardize output format
              } catch (err) {
                logger.error(`[Agent] Tool Error: ${call.name}`, err);
                result = `Error: ${err.message}`;
              }

              // Feed result back to context
              context.push({
                role: 'user',
                content: `TOOL_RESULT (${call.name}):\n${result}`
              });
            }
          } else {
            // No tools called. Check if done or just chatting.
            if (ResponseParser.isDone(response.content)) {
              logger.info('[Agent] Goal achieved (reported by agent).');
              break;
            }
            // If not done and no tools, maybe force a continuation prompt?
            // For now, we just let the loop continue or wait for user input in a chat app.
            // In this autonomous loop, we might stop if it's just chatting.
            // Simplification: If no tools, we stop to prevent infinite chatter loops in autonomous mode.
            // logger.info('[Agent] No tools called. Pausing.');
            // break;
          }

          // Safety break
          if (iteration >= MAX_ITERATIONS) {
            logger.warn('[Agent] Max iterations reached.');
          }
        }
      } catch (err) {
        if (err instanceof Errors.AbortError) {
          logger.info('[Agent] Cycle aborted by user.');
        } else {
          logger.error('[Agent] Critical Error', err);
          throw err;
        }
      } finally {
        _isRunning = false;
        _abortController = null;
      }
    };

    const _buildInitialContext = async (goal) => {
      const personaPrompt = await PersonaManager.getSystemPrompt();

      // Base System Prompt
      const systemPrompt = `
${personaPrompt}

## Capabilities
You have access to a Virtual File System (VFS) and tools to manipulate it.
You can create and modify your own tools.

## Protocol
1. **THINK**: Plan your action.
2. **ACT**: Use a tool using the format:
TOOL_CALL: tool_name
ARGS: { "arg": "value" }
3. **OBSERVE**: Wait for the result.

## Goal
${goal}
`;

      return [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: `Start. Goal: ${goal}` }
      ];
    };

    // --- Public Control API ---

    const stop = () => {
      if (_abortController) _abortController.abort();
      _isRunning = false;
    };

    const setModel = (config) => {
      _modelConfig = config;
    };

    return {
      run,
      stop,
      setModel,
      isRunning: () => _isRunning
    };
  }
};

export default AgentLoop;
