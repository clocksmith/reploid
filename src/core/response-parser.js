/**
 * @fileoverview Response Parser
 * Extracts tool calls from LLM text using the REPLOID/0 line protocol,
 * with legacy TOOL_CALL/ARGS support retained during migration.
 */

const ResponseParser = {
  metadata: {
    id: 'ResponseParser',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger, sanitizeLlmJsonRespPure } = deps.Utils;

    const TOP_LEVEL_DIRECTIVE_REGEX = /^(?:REPLOID\/\d+|TOOL:\s*[a-zA-Z0-9_]+|TOOL_CALL:\s*[a-zA-Z0-9_]+|MILESTONE:|DONE:|IDLE:|PARK:)/;
    const REPLTOOL_HEADER_REGEX = /^REPLOID\/\d+\s*$/;
    const TOOL_DIRECTIVE_REGEX = /^TOOL:\s*([a-zA-Z0-9_]+)\s*$/;
    const INLINE_ARG_REGEX = /^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/;
    const BLOCK_ARG_REGEX = /^([a-zA-Z0-9_.-]+)\s*(?::\s*)?<<\s*([A-Za-z0-9_-]+)\s*$/;
    const LEGACY_TOOL_CALL_REGEX = /TOOL_CALL:\s*([a-zA-Z0-9_]+)\s*\nARGS:\s*/g;

    const parseScalarValue = (rawValue) => {
      const value = String(rawValue ?? '').trim();

      if (value === '') return '';
      if (value === 'true') return true;
      if (value === 'false') return false;
      if (value === 'null') return null;
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
        return Number(value);
      }

      if (
        (value.startsWith('{') && value.endsWith('}')) ||
        (value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        try {
          return JSON.parse(value);
        } catch (error) {
          throw new Error(`Invalid inline JSON: ${error.message}`);
        }
      }

      if (value.startsWith('`') && value.endsWith('`') && value.length >= 2) {
        return value.slice(1, -1);
      }

      if (value.startsWith('\'') && value.endsWith('\'') && value.length >= 2) {
        return value.slice(1, -1);
      }

      return value;
    };

    const parseReploidToolCalls = (text) => {
      if (!text || typeof text !== 'string') return [];

      const lines = text.split(/\r?\n/);
      const calls = [];
      let index = 0;

      while (index < lines.length) {
        const rawLine = lines[index];
        const line = rawLine.trimStart();

        if (!line || REPLTOOL_HEADER_REGEX.test(line) || !TOOL_DIRECTIVE_REGEX.test(line)) {
          index++;
          continue;
        }

        const toolMatch = line.match(TOOL_DIRECTIVE_REGEX);
        const name = toolMatch[1];
        const args = {};
        let error = null;
        index++;

        while (index < lines.length) {
          const nextRawLine = lines[index];
          const nextLine = nextRawLine.trimStart();

          if (!nextLine) {
            index++;
            continue;
          }

          if (TOP_LEVEL_DIRECTIVE_REGEX.test(nextLine)) {
            break;
          }

          const blockMatch = nextLine.match(BLOCK_ARG_REGEX);
          if (blockMatch) {
            const [, key, marker] = blockMatch;
            const blockLines = [];
            index++;

            while (index < lines.length && lines[index].trim() !== marker) {
              blockLines.push(lines[index]);
              index++;
            }

            if (index >= lines.length) {
              error = `Unterminated block for ${key}`;
              break;
            }

            args[key] = blockLines.join('\n');
            index++; // consume marker
            continue;
          }

          const argMatch = nextLine.match(INLINE_ARG_REGEX);
          if (!argMatch) {
            error = `Invalid argument line: ${nextLine.trim()}`;
            while (index < lines.length && !TOP_LEVEL_DIRECTIVE_REGEX.test(lines[index].trimStart())) {
              index++;
            }
            break;
          }

          const [, key, rawValue] = argMatch;

          try {
            args[key] = parseScalarValue(rawValue);
          } catch (parseError) {
            error = parseError.message;
            while (index < lines.length && !TOP_LEVEL_DIRECTIVE_REGEX.test(lines[index].trimStart())) {
              index++;
            }
            break;
          }

          index++;
        }

        calls.push(error ? { name, args, error } : { name, args });
      }

      return calls;
    };

    const parseLegacyToolCalls = (text) => {
      if (!text) return [];
      const calls = [];
      let match;

      while ((match = LEGACY_TOOL_CALL_REGEX.exec(text)) !== null) {
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

    const parseToolCalls = (text) => {
      if (!text) return [];

      const reploidCalls = parseReploidToolCalls(text);
      if (reploidCalls.length > 0) {
        return reploidCalls;
      }

      return parseLegacyToolCalls(text);
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
