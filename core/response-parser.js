/**
 * @fileoverview Response Parser
 * Extracts tool calls from LLM text using Robust Regex.
 */

const ResponseParser = {
  metadata: {
    id: 'ResponseParser',
    version: '2.1.0', // Simplified
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger, sanitizeLlmJsonRespPure } = deps.Utils;

    const parseToolCalls = (text) => {
      if (!text) return [];
      const calls = [];

      // Standard Format:
      // TOOL_CALL: name
      // ARGS: { ... }
      // Find each TOOL_CALL and extract JSON with brace counting
      const toolCallRegex = /TOOL_CALL:\s*([a-zA-Z0-9_]+)\s*\nARGS:\s*/g;

      let match;
      while ((match = toolCallRegex.exec(text)) !== null) {
        const name = match[1].trim();
        let startIdx = match.index + match[0].length;

        while (startIdx < text.length && /\s/.test(text[startIdx])) startIdx++;
        if (text[startIdx] !== '{') {
          logger.warn(`[ResponseParser] Expected JSON object for ${name}`);
          calls.push({ name, args: {}, error: 'Invalid JSON block' });
          continue;
        }

        let braceCount = 0;
        let inString = false;
        let escape = false;
        let endIdx = startIdx;

        for (let i = startIdx; i < text.length; i++) {
          const char = text[i];

          if (escape) {
            escape = false;
            continue;
          }

          if (char === '\\' && inString) {
            escape = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                endIdx = i + 1;
                break;
              }
            }
          }
        }

        const rawArgs = text.slice(startIdx, endIdx);

        const { json } = sanitizeLlmJsonRespPure(rawArgs);
        try {
          const args = JSON.parse(json);
          calls.push({ name, args });
        } catch (e) {
          logger.warn(`[ResponseParser] Bad args for ${name}`, { raw: rawArgs.slice(0, 100) });
          calls.push({ name, args: {}, error: `JSON Parse Error: ${e.message}` });
        }
      }

      return calls;
    };

    // Check if the model explicitly stated it is done
    const isDone = (text) => {
        if (!text) return false;
        return text.includes('GOAL_ACHIEVED') || text.includes('GOAL_COMPLETE');
    };

    return { parseToolCalls, isDone };
  }
};

export default ResponseParser;
