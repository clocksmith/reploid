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

    const TOP_LEVEL_DIRECTIVE_REGEX = /^(?:REPLOID\/\d+|PLAN:|TOOL:\s*[a-zA-Z0-9_]+|TOOL_CALL:\s*[a-zA-Z0-9_]+|MILESTONE:|DONE:|IDLE:|PARK:)/;
    const REPLTOOL_HEADER_REGEX = /^REPLOID\/\d+\s*$/;
    const PLAN_DIRECTIVE_REGEX = /^PLAN:\s*(.*)$/;
    const TOOL_DIRECTIVE_REGEX = /^TOOL:\s*([a-zA-Z0-9_]+)(?:\s+(.*))?$/;
    const INLINE_ARG_REGEX = /^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/;
    const BLOCK_ARG_REGEX = /^([a-zA-Z0-9_.-]+)\s*(?::\s*)?<<\s*([A-Za-z0-9_-]+)\s*$/;
    const PIPE_BLOCK_ARG_REGEX = /^([a-zA-Z0-9_.-]+)\s*:\s*\|[+-]?\s*$/;
    const LEGACY_TOOL_CALL_REGEX = /TOOL_CALL:\s*([a-zA-Z0-9_]+)\s*\nARGS:\s*/g;
    const TOOL_BATCH_SEPARATOR_REGEX = /^-{3,}$/;
    const CONTINUATION_ARG_KEYS = new Set(['code', 'content']);
    const PATH_ARG_KEYS = new Set([
      'path',
      'candidatePath',
      'targetPath',
      'evidencePath',
      'source',
      'sourcePath',
      'target',
      'destination',
      'evidence',
      'proofPath'
    ]);

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

    const parseScalarArgValue = (key, rawValue) => {
      if (CONTINUATION_ARG_KEYS.has(key) && /^\s*\|[+-]?\s*$/.test(String(rawValue ?? ''))) {
        return '';
      }
      const parsed = parseScalarValue(rawValue);
      if (!PATH_ARG_KEYS.has(key) || typeof parsed !== 'string') return parsed;
      const [firstToken] = parsed.trim().split(/\s+/);
      return firstToken || parsed;
    };

    const parseObjectArgsLine = (rawLine) => {
      const value = String(rawLine || '').trim();
      if (!value.startsWith('{')) return { matched: false, value: null, error: null };
      if (!value.endsWith('}')) {
        return { matched: true, value: null, error: 'Invalid JSON argument object' };
      }
      try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { matched: true, value: null, error: 'Argument JSON must be an object' };
        }
        return { matched: true, value: parsed, error: null };
      } catch (error) {
        return { matched: true, value: null, error: `Invalid JSON argument object: ${error.message}` };
      }
    };

    const parseInlineArgPairs = (rawLine) => {
      const value = String(rawLine || '').trim();
      if (!value) return { matched: false, value: null, error: null };

      const pairs = [];
      const keyRegex = /(?:^|\s)([a-zA-Z0-9_.-]+)\s*:\s+/g;
      let match;
      while ((match = keyRegex.exec(value)) !== null) {
        pairs.push({
          key: match[1],
          valueStart: match.index + match[0].length,
          matchStart: match.index
        });
      }

      if (pairs.length === 0) {
        return { matched: false, value: null, error: null };
      }

      const parsed = {};
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const valueEnd = i + 1 < pairs.length ? pairs[i + 1].matchStart : value.length;
        const rawValue = value.slice(pair.valueStart, valueEnd).trim();

        try {
          parsed[pair.key] = parseScalarArgValue(pair.key, rawValue);
        } catch (error) {
          return { matched: true, value: null, error: error.message };
        }
      }

      return { matched: true, value: parsed, error: null };
    };

    const normalizePlanDeps = (value) => {
      if (value === undefined || value === null || value === '') return [];
      if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
      }
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };

    const getContinuationArgKey = (args) => {
      for (const key of CONTINUATION_ARG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(args, key) && typeof args[key] === 'string') {
          return key;
        }
      }
      return null;
    };

    const appendContinuationArg = (args, key, linesToAppend) => {
      const current = String(args[key] || '');
      const continuation = linesToAppend.join('\n');
      args[key] = current
        ? `${current}\n${continuation}`
        : continuation;
    };

    const isToolBatchSeparator = (line) => TOOL_BATCH_SEPARATOR_REGEX.test(String(line || '').trim());

    const stripProtocolInlineComment = (rawLine) => {
      const line = String(rawLine || '');
      let quote = null;
      let escaped = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\' && quote) {
          escaped = true;
          continue;
        }

        if (char === '"' || char === '\'' || char === '`') {
          if (!quote) {
            quote = char;
          } else if (quote === char) {
            quote = null;
          }
          continue;
        }

        if (
          char === '#'
          && !quote
          && (i === 0 || /\s/.test(line[i - 1]))
          && (i + 1 >= line.length || /\s/.test(line[i + 1]))
        ) {
          return line.slice(0, i).trimEnd();
        }
      }

      return line;
    };

    const isDirectiveBoundary = (line) => {
      const normalized = stripProtocolInlineComment(String(line || '').trimStart());
      return TOP_LEVEL_DIRECTIVE_REGEX.test(normalized) || isToolBatchSeparator(normalized);
    };

    const normalizeInlineReploidProtocol = (text) => String(text || '')
      .split(/\r?\n/)
      .map((line) => String(line || '')
        .replace(/\b(REPLOID\/\d+)\s+(?=(?:PLAN:|TOOL:|DONE:|IDLE:|PARK:))/g, '$1\n')
        .replace(/\s+---\s+(?=(?:REPLOID\/\d+|PLAN:|TOOL:|DONE:|IDLE:|PARK:))/g, '\n---\n'))
      .join('\n');

    const readPlanJson = (lines, startIndex, initialText = '') => {
      let index = startIndex;
      let rawJson = String(initialText || '').trim();
      let lastError = null;

      while (!rawJson && index < lines.length && !lines[index].trim()) {
        index++;
      }

      while (index <= lines.length) {
        if (rawJson) {
          try {
            return {
              value: JSON.parse(rawJson),
              nextIndex: index
            };
          } catch (error) {
            lastError = error;
          }
        }

        if (index >= lines.length) break;

        const nextLine = lines[index].trimStart();
        if (rawJson && TOP_LEVEL_DIRECTIVE_REGEX.test(nextLine)) {
          break;
        }

        rawJson = rawJson ? `${rawJson}\n${lines[index]}` : lines[index];
        index++;
      }

      throw new Error(`Invalid PLAN JSON: ${lastError?.message || 'missing JSON value'}`);
    };

    const parsePlanCalls = (planValue) => {
      const steps = Array.isArray(planValue)
        ? planValue
        : Array.isArray(planValue?.steps)
          ? planValue.steps
          : null;

      if (!steps) {
        return [{
          name: 'Plan',
          args: {},
          error: 'PLAN must be a JSON array or an object with a steps array'
        }];
      }

      return steps.map((step, stepIndex) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          return {
            name: 'Plan',
            args: { step: stepIndex + 1 },
            error: `PLAN step ${stepIndex + 1} must be an object`
          };
        }

        const name = String(step.tool || step.name || '').trim();
        const args = step.args && typeof step.args === 'object' && !Array.isArray(step.args)
          ? step.args
          : {};
        const call = {
          name: name || 'Plan',
          args
        };
        const id = String(step.id || '').trim();
        const after = normalizePlanDeps(step.after ?? step.dependsOn ?? step.needs);

        if (id) call.id = id;
        if (after.length > 0) call.after = after;
        if (!name) {
          call.error = `PLAN step ${stepIndex + 1} is missing tool`;
        } else if (
          step.args !== undefined &&
          (!step.args || typeof step.args !== 'object' || Array.isArray(step.args))
        ) {
          call.error = `PLAN step ${stepIndex + 1} args must be an object`;
        }

        return call;
      });
    };

    const parseReploidToolCalls = (text) => {
      if (!text || typeof text !== 'string') return [];

      const lines = normalizeInlineReploidProtocol(text).split(/\r?\n/);
      const calls = [];
      let index = 0;

      while (index < lines.length) {
        const rawLine = lines[index];
        const line = stripProtocolInlineComment(rawLine.trimStart());

        const planMatch = line.match(PLAN_DIRECTIVE_REGEX);
        if (planMatch) {
          index++;
          try {
            const parsed = readPlanJson(lines, index, planMatch[1]);
            calls.push(...parsePlanCalls(parsed.value));
            index = parsed.nextIndex;
          } catch (error) {
            calls.push({
              name: 'Plan',
              args: {},
              error: error.message
            });
          }
          continue;
        }

        if (!line || isToolBatchSeparator(line) || REPLTOOL_HEADER_REGEX.test(line) || !TOOL_DIRECTIVE_REGEX.test(line)) {
          index++;
          continue;
        }

        const toolMatch = line.match(TOOL_DIRECTIVE_REGEX);
        const name = toolMatch[1];
        const args = {};
        let error = null;
        const inlineArgsText = toolMatch[2] || '';
        const inlineObjectArgs = parseObjectArgsLine(inlineArgsText);
        if (inlineObjectArgs.matched) {
          if (inlineObjectArgs.error) {
            error = inlineObjectArgs.error;
          } else {
            Object.assign(args, inlineObjectArgs.value);
          }
        } else {
          const inlinePairs = parseInlineArgPairs(inlineArgsText);
          if (inlinePairs.matched) {
            if (inlinePairs.error) {
              error = inlinePairs.error;
            } else {
              Object.assign(args, inlinePairs.value);
            }
          } else if (inlineArgsText.trim()) {
            error = `Invalid inline tool args: ${inlineArgsText.trim()}`;
          }
        }
        index++;

        while (index < lines.length) {
          const nextRawLine = lines[index];
          const nextLine = stripProtocolInlineComment(nextRawLine.trimStart());

          if (!nextLine) {
            index++;
            continue;
          }

          if (isToolBatchSeparator(nextLine)) {
            index++;
            break;
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

          const pipeBlockMatch = nextLine.match(PIPE_BLOCK_ARG_REGEX);
          if (pipeBlockMatch) {
            const [, key] = pipeBlockMatch;
            const blockLines = [];
            index++;

            while (index < lines.length && !isDirectiveBoundary(lines[index])) {
              blockLines.push(lines[index]);
              index++;
            }

            while (blockLines.length > 0 && !blockLines[0].trim()) {
              blockLines.shift();
            }

            args[key] = blockLines.join('\n');
            continue;
          }

          const argMatch = nextLine.match(INLINE_ARG_REGEX);
          if (!argMatch) {
            const continuationKey = getContinuationArgKey(args);
            if (continuationKey) {
              const continuationLines = [];
              while (index < lines.length && !isDirectiveBoundary(lines[index])) {
                continuationLines.push(lines[index]);
                index++;
              }
              appendContinuationArg(args, continuationKey, continuationLines);
              continue;
            }

            const objectArgs = parseObjectArgsLine(nextLine);
            if (objectArgs.matched) {
              if (objectArgs.error) {
                error = objectArgs.error;
                while (index < lines.length && !isDirectiveBoundary(lines[index])) {
                  index++;
                }
                break;
              }
              Object.assign(args, objectArgs.value);
              index++;
              continue;
            }

            if (Object.keys(args).length > 0) {
              while (index < lines.length && !isDirectiveBoundary(lines[index])) {
                index++;
              }
              break;
            }

            error = `Invalid argument line: ${nextLine.trim()}`;
            while (index < lines.length && !isDirectiveBoundary(lines[index])) {
              index++;
            }
            break;
          }

          const [, key, rawValue] = argMatch;

          try {
            args[key] = parseScalarArgValue(key, rawValue);
          } catch (parseError) {
            error = parseError.message;
            while (index < lines.length && !isDirectiveBoundary(lines[index])) {
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

    const isDone = (text) => {
      if (!text || typeof text !== 'string') return false;
      const trimmed = text.trim();
      if (!trimmed) return false;

      const lines = trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.some((line) => /^(DONE|IDLE|PARK):(?:\s|$)/i.test(line))) {
        return true;
      }

      return /(?:^|\s)(DONE|GOAL_ACHIEVED|GOAL_COMPLETE)(?:[.!?]|\s|$)/.test(trimmed);
    };

    return { parseToolCalls, isDone };
  }
};

export default ResponseParser;
