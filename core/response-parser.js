/**
 * @fileoverview Response Parser
 * Extracts tool calls from LLM text using Robust Regex.
 */

const ResponseParser = {
  metadata: {
    id: 'ResponseParser',
    version: '1.0.0', // Backtick template literal support
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
      // find each TOOL_CALL and extract JSON with brace counting
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
        let stringDelimiter = null; // Track which delimiter started the string: " or `
        let escape = false;
        let endIdx = startIdx;

        for (let i = startIdx; i < text.length; i++) {
          const char = text[i];

          if (escape) {
            escape = false;
            continue;
          }

          if (char === '\\' && stringDelimiter) {
            escape = true;
            continue;
          }

          // Handle both double quotes and backticks as string delimiters
          if (char === '"' || char === '`') {
            if (!stringDelimiter) {
              stringDelimiter = char; // Start string
            } else if (stringDelimiter === char) {
              stringDelimiter = null; // End string (matching delimiter)
            }
            // If in a string with different delimiter, ignore this char
            continue;
          }

          if (!stringDelimiter) {
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
          logger.warn(`[ResponseParser] Bad args for ${name}`, {
            error: e.message,
            rawLength: rawArgs.length,
            rawPreview: rawArgs.slice(0, 200),
            rawEnd: rawArgs.length > 200 ? rawArgs.slice(-50) : ''
          });
          // Provide actionable error message
          const hint = rawArgs.includes('\n') && !rawArgs.includes('\\n')
            ? ' Hint: Content has literal newlines - use \\n escapes instead.'
            : '';
          calls.push({ name, args: {}, error: `JSON Parse Error: ${e.message}.${hint}` });
        }
      }

      return calls;
    };

    // RSI MODE: Agent should NEVER stop on its own
    // Only the circuit breaker (iteration limit) or user intervention stops it
    // This enforces continuous improvement behavior
    const isDone = (text) => {
        // In RSI mode, we don't accept self-declared completion
        // The agent should always look for improvements
        // To restore non-RSI mode, uncomment below:
        // if (!text) return false;
        // return text.includes('GOAL_ACHIEVED') || text.includes('GOAL_COMPLETE');
        return false;
    };

    return { parseToolCalls, isDone };
  }
};

export default ResponseParser;
