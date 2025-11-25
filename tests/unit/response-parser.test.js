/**
 * @fileoverview Unit tests for ResponseParser module
 * Tests tool call parsing, JSON extraction, and completion detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Utils dependency
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  sanitizeLlmJsonRespPure: (text) => {
    if (!text || typeof text !== 'string') return { json: "{}", method: "empty" };
    try {
      JSON.parse(text);
      return { json: text, method: "direct" };
    } catch (e) { /* continue */ }

    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) {
      try {
        JSON.parse(codeBlock[1]);
        return { json: codeBlock[1], method: "block" };
      } catch (e) { /* continue */ }
    }

    const firstOpen = text.indexOf('{');
    const lastClose = text.lastIndexOf('}');
    if (firstOpen > -1 && lastClose > firstOpen) {
      const candidate = text.substring(firstOpen, lastClose + 1);
      try {
        JSON.parse(candidate);
        return { json: candidate, method: "heuristic" };
      } catch (e) { /* continue */ }
    }

    return { json: "{}", method: "failed" };
  }
});

// Import and create ResponseParser
import ResponseParserModule from '../../core/response-parser.js';

describe('ResponseParser', () => {
  let responseParser;
  let mockUtils;

  beforeEach(() => {
    mockUtils = createMockUtils();
    responseParser = ResponseParserModule.factory({ Utils: mockUtils });
  });

  describe('parseToolCalls', () => {
    describe('valid tool calls', () => {
      it('should parse a single tool call with simple args', () => {
        const text = `I'll read the file now.

TOOL_CALL: read_file
ARGS: { "path": "/test.txt" }

Let me check the contents.`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].args).toEqual({ path: '/test.txt' });
        expect(calls[0].error).toBeUndefined();
      });

      it('should parse multiple tool calls in sequence', () => {
        const text = `Let me do multiple things.

TOOL_CALL: read_file
ARGS: { "path": "/first.txt" }

Now another:

TOOL_CALL: write_file
ARGS: { "path": "/output.txt", "content": "Hello" }

Done.`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe('read_file');
        expect(calls[0].args.path).toBe('/first.txt');
        expect(calls[1].name).toBe('write_file');
        expect(calls[1].args.path).toBe('/output.txt');
        expect(calls[1].args.content).toBe('Hello');
      });

      it('should parse tool call with nested JSON args', () => {
        const text = `TOOL_CALL: create_tool
ARGS: { "name": "my_tool", "config": { "nested": { "deep": true }, "array": [1, 2, 3] } }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('create_tool');
        expect(calls[0].args.name).toBe('my_tool');
        expect(calls[0].args.config.nested.deep).toBe(true);
        expect(calls[0].args.config.array).toEqual([1, 2, 3]);
      });

      it('should parse tool call with multiline string content', () => {
        const text = `TOOL_CALL: write_file
ARGS: { "path": "/code.js", "content": "function hello() {\\n  console.log(\\"Hello\\");\\n}" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('function hello()');
      });

      it('should handle tool names with underscores and numbers', () => {
        const text = `TOOL_CALL: my_tool_v2
ARGS: { "key": "value" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('my_tool_v2');
      });

      it('should handle empty args object', () => {
        const text = `TOOL_CALL: list_files
ARGS: {}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('list_files');
        expect(calls[0].args).toEqual({});
      });

      it('should handle args with special characters in strings', () => {
        const text = `TOOL_CALL: write_file
ARGS: { "path": "/test.txt", "content": "Special chars: \\"quotes\\", \\\\backslash, \\n newline" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('quotes');
      });

      it('should handle whitespace variations in format', () => {
        const text = `TOOL_CALL:   read_file
ARGS:   { "path" : "/test.txt" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
      });
    });

    describe('invalid/malformed tool calls', () => {
      it('should return empty array for null input', () => {
        expect(responseParser.parseToolCalls(null)).toEqual([]);
      });

      it('should return empty array for undefined input', () => {
        expect(responseParser.parseToolCalls(undefined)).toEqual([]);
      });

      it('should return empty array for empty string', () => {
        expect(responseParser.parseToolCalls('')).toEqual([]);
      });

      it('should return empty array for text without tool calls', () => {
        const text = 'This is just regular text without any tool calls.';
        expect(responseParser.parseToolCalls(text)).toEqual([]);
      });

      it('should handle tool call without ARGS section', () => {
        const text = `TOOL_CALL: read_file
Some other text here`;

        const calls = responseParser.parseToolCalls(text);
        // Should not match since ARGS: is required
        expect(calls).toHaveLength(0);
      });

      it('should handle malformed JSON in args with error', () => {
        const text = `TOOL_CALL: read_file
ARGS: { invalid json here }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read_file');
        // Depending on sanitizeLlmJsonRespPure behavior, either error is set or args is empty
        if (calls[0].error) {
          expect(calls[0].error).toContain('JSON Parse Error');
          expect(calls[0].args).toEqual({});
        } else {
          // If no error, args should at least be empty (sanitizer may have recovered)
          expect(typeof calls[0].args).toBe('object');
        }
      });

      it('should handle ARGS without opening brace', () => {
        const text = `TOOL_CALL: read_file
ARGS: not json`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].error).toBe('Invalid JSON block');
      });

      it('should handle incomplete JSON (unclosed brace)', () => {
        const text = `TOOL_CALL: read_file
ARGS: { "path": "/test.txt"`;

        const calls = responseParser.parseToolCalls(text);

        // The brace counting won't find a closing brace, so it will slice
        // from startIdx to endIdx (which never advances past startIdx).
        // This results in an empty or incomplete JSON that fails to parse.
        // The parser may return empty args or an error depending on implementation.
        expect(calls).toHaveLength(1);
        // Either error is set, or args is empty due to failed parsing
        expect(calls[0].error !== undefined || Object.keys(calls[0].args).length === 0).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle very long content in args', () => {
        const longContent = 'x'.repeat(10000);
        const text = `TOOL_CALL: write_file
ARGS: { "path": "/big.txt", "content": "${longContent}" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content.length).toBe(10000);
      });

      it('should handle JSON with unicode characters', () => {
        const text = `TOOL_CALL: write_file
ARGS: { "path": "/unicode.txt", "content": "Hello 世界 🌍 émojis" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('世界');
        expect(calls[0].args.content).toContain('🌍');
      });

      it('should handle mixed valid and invalid tool calls', () => {
        const text = `TOOL_CALL: read_file
ARGS: { "path": "/valid.txt" }

TOOL_CALL: bad_tool
ARGS: { broken }

TOOL_CALL: write_file
ARGS: { "path": "/also-valid.txt", "content": "ok" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(3);
        expect(calls[0].error).toBeUndefined();
        // The "{ broken }" may parse differently depending on sanitizeLlmJsonRespPure
        // It could either set error or empty args
        expect(calls[1].error !== undefined || Object.keys(calls[1].args).length === 0).toBe(true);
        expect(calls[2].error).toBeUndefined();
      });

      it('should handle JSON with null values', () => {
        const text = `TOOL_CALL: some_tool
ARGS: { "required": "value", "optional": null }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.optional).toBeNull();
      });

      it('should handle JSON with boolean values', () => {
        const text = `TOOL_CALL: some_tool
ARGS: { "enabled": true, "disabled": false }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.enabled).toBe(true);
        expect(calls[0].args.disabled).toBe(false);
      });

      it('should handle JSON with numeric values', () => {
        const text = `TOOL_CALL: some_tool
ARGS: { "int": 42, "float": 3.14, "negative": -10 }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.int).toBe(42);
        expect(calls[0].args.float).toBe(3.14);
        expect(calls[0].args.negative).toBe(-10);
      });
    });
  });

  describe('isDone', () => {
    it('should return true for GOAL_ACHIEVED', () => {
      expect(responseParser.isDone('Task complete. GOAL_ACHIEVED')).toBe(true);
    });

    it('should return true for GOAL_COMPLETE', () => {
      expect(responseParser.isDone('All tasks done. GOAL_COMPLETE')).toBe(true);
    });

    it('should return true for DONE', () => {
      expect(responseParser.isDone('Everything is finished. DONE')).toBe(true);
    });

    it('should return false for text without completion markers', () => {
      expect(responseParser.isDone('Still working on it...')).toBe(false);
    });

    it('should return false for null input', () => {
      expect(responseParser.isDone(null)).toBe(false);
    });

    it('should return false for undefined input', () => {
      expect(responseParser.isDone(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(responseParser.isDone('')).toBe(false);
    });

    it('should be case-sensitive (lowercase done should not match)', () => {
      expect(responseParser.isDone('done')).toBe(false);
    });

    it('should match DONE anywhere in text', () => {
      expect(responseParser.isDone('prefix DONE suffix')).toBe(true);
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ResponseParserModule.metadata.id).toBe('ResponseParser');
      expect(ResponseParserModule.metadata.type).toBe('service');
      expect(ResponseParserModule.metadata.dependencies).toContain('Utils');
    });
  });
});
