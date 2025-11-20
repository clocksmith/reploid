/**
 * @fileoverview Response Parser
 * Extracts tool calls from LLM text.
 */

const ResponseParser = {
  metadata: {
    id: 'ResponseParser',
    version: '2.0.1',
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger, sanitizeLlmJsonRespPure } = deps.Utils;

    const parseToolCalls = (text) => {
      if (!text) return [];
      const calls = [];

      // 1. Try Regex for standard format
      const regex = /TOOL_CALL:\s*([a-zA-Z0-9_]+)\s*\nARGS:\s*({[\s\S]*?})(?=\nTOOL_CALL:|$)/g;
      let match;
      let regexSuccess = false;

      while ((match = regex.exec(text)) !== null) {
        regexSuccess = true;
        addCall(calls, match[1], match[2]);
      }

      if (regexSuccess) return calls;

      // 2. Fallback: Manual Line Parsing
      const lines = text.split('\n');
      let currentTool = null;
      let argBuffer = '';
      let recordingArgs = false;

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('TOOL_CALL:')) {
          if (currentTool && recordingArgs) {
            addCall(calls, currentTool, argBuffer);
          }
          currentTool = trimmed.replace('TOOL_CALL:', '').trim();
          argBuffer = '';
          recordingArgs = false;
        } else if (trimmed.startsWith('ARGS:') && currentTool) {
          recordingArgs = true;
          argBuffer = line.replace('ARGS:', '').trim();
        } else if (recordingArgs) {
          argBuffer += line + '\n';
        }
      }

      // Final flush
      if (currentTool && recordingArgs) {
        addCall(calls, currentTool, argBuffer);
      }

      return calls;
    };

    const addCall = (list, name, rawArgs) => {
      const { json } = sanitizeLlmJsonRespPure(rawArgs);
      try {
        const args = JSON.parse(json);
        list.push({ name, args });
      } catch (e) {
        logger.warn(`[ResponseParser] Bad args for ${name}`, { raw: rawArgs });
        list.push({ name, args: {}, error: e.message });
      }
    };

    const isDone = (text) => text.includes('DONE:') || text.includes('GOAL_ACHIEVED:');

    return { parseToolCalls, isDone };
  }
};

export default ResponseParser;
