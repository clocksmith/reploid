/**
 * @fileoverview Unit tests for ResponseParser module
 * Tests tool call parsing, literal block handling, and completion detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backtick to JSON string converter (mirrors utils.js implementation)
const convertBacktickStrings = (text) => {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
          result += text[i] + text[i + 1];
          i += 2;
        } else if (text[i] === '"') {
          result += '"';
          i++;
          break;
        } else {
          result += text[i];
          i++;
        }
      }
    } else if (text[i] === '`') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '`') {
        const char = text[i];
        if (char === '\\' && i + 1 < text.length) {
          result += text[i] + text[i + 1];
          i += 2;
        } else if (char === '"') {
          result += '\\"';
          i++;
        } else if (char === '\n') {
          result += '\\n';
          i++;
        } else if (char === '\r') {
          result += '\\r';
          i++;
        } else if (char === '\t') {
          result += '\\t';
          i++;
        } else {
          result += char;
          i++;
        }
      }
      result += '"';
      if (i < text.length) i++;
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
};

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

    // Try converting backtick strings to JSON strings
    if (text.includes('`')) {
      try {
        const converted = convertBacktickStrings(text);
        JSON.parse(converted);
        return { json: converted, method: "backtick" };
      } catch (e) { /* continue */ }
    }

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

      // Try backtick conversion on the candidate
      if (candidate.includes('`')) {
        try {
          const converted = convertBacktickStrings(candidate);
          JSON.parse(converted);
          return { json: converted, method: "heuristic+backtick" };
        } catch (e) { /* continue */ }
      }
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
      it('should parse a REPLOID/0 tool call with simple key/value args', () => {
        const text = `REPLOID/0

TOOL: ReadFile
path: /test.txt`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].args).toEqual({ path: '/test.txt' });
        expect(calls[0].error).toBeUndefined();
      });

      it('should parse REPLOID/0 batched tool calls', () => {
        const text = `REPLOID/0

TOOL: ReadFile
path: /first.txt

TOOL: WriteFile
path: /output.txt
content <<EOF
Hello
EOF`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].args.path).toBe('/first.txt');
        expect(calls[1].name).toBe('WriteFile');
        expect(calls[1].args.path).toBe('/output.txt');
        expect(calls[1].args.content).toBe('Hello');
      });

      it('should ignore claimed EVIDENCE blocks instead of merging them into tool arguments', () => {
        const text = `REPLOID/0

TOOL: CreateTool
{
  "name": "KatamariEngine",
  "description": "DOM-based physics overlay for element collection.",
  "inputSchema": { "type": "object" },
  "call": "async () => ({ status: 'overlay_injected' })"
}

EVIDENCE:
{"status":"success","tool":"KatamariEngine"}

REPLOID/0

TOOL: KatamariEngine
{}

EVIDENCE:
{"status":"active","overlay_id":"katamari-overlay"}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toEqual([
          {
            name: 'CreateTool',
            args: {
              name: 'KatamariEngine',
              description: 'DOM-based physics overlay for element collection.',
              inputSchema: { type: 'object' },
              call: "async () => ({ status: 'overlay_injected' })"
            }
          },
          { name: 'KatamariEngine', args: {} }
        ]);
      });

      it('should parse pipe literal blocks without writing the pipe marker into content', () => {
        const text = `REPLOID/0

TOOL: CreateTool
name: KatamariEngine
code: |
  /**
   * @fileoverview Katamari Engine
   */
  export const tool = {
    name: 'KatamariEngine'
  };

TOOL: WriteFile
path: /artifacts/KatamariEngine-evidence.json
content: |
  {
    "candidatePath": "/shadow/tools/KatamariEngine.js",
    "targetPath": "/self/tools/KatamariEngine.js",
    "replayPassed": true
  }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe('CreateTool');
        expect(calls[0].args.code).toContain('@fileoverview Katamari Engine');
        expect(calls[0].args.code).toContain('export const tool');
        expect(calls[0].args.code.trimStart().startsWith('|')).toBe(false);
        expect(calls[1].name).toBe('WriteFile');
        expect(calls[1].args.content).toContain('"replayPassed": true');
        expect(calls[1].args.content.trimStart().startsWith('|')).toBe(false);
      });

      it('should recover inline pipe literal markers for continuation args', () => {
        const text = `REPLOID/0

TOOL: CreateTool name: KatamariEngine code: |
export default async function KatamariEngine() {
  return { ok: true };
}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('CreateTool');
        expect(calls[0].args.name).toBe('KatamariEngine');
        expect(calls[0].args.code).toContain('export default async function');
        expect(calls[0].args.code.trimStart().startsWith('|')).toBe(false);
      });

      it('should parse REPLOID/0 batched tool calls separated by markdown rules', () => {
        const text = `REPLOID/0

TOOL: ListTools
{}
---
TOOL: ReadFile
path: /blueprint-index.json
---
TOOL: ListFiles
path: /ui/boot-home/`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(3);
        expect(calls[0]).toEqual({ name: 'ListTools', args: {} });
        expect(calls[1]).toEqual({ name: 'ReadFile', args: { path: '/blueprint-index.json' } });
        expect(calls[2]).toEqual({ name: 'ListFiles', args: { path: '/ui/boot-home/' } });
      });

      it('should parse one-line REPLOID/0 tool calls with inline args', () => {
        const text = 'REPLOID/0 TOOL: ReadFile path: /blueprint-index.json binary: true length: 5000 offset: 0';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          name: 'ReadFile',
          args: {
            path: '/blueprint-index.json',
            binary: true,
            length: 5000,
            offset: 0
          }
        });
      });

      it('should parse one-line REPLOID/0 batched tool calls separated by markdown rules', () => {
        const text = 'REPLOID/0 TOOL: ListTools {} --- TOOL: ReadFile path: /blueprint-index.json --- TOOL: ListFiles path: /ui/boot-home/';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(3);
        expect(calls[0]).toEqual({ name: 'ListTools', args: {} });
        expect(calls[1]).toEqual({ name: 'ReadFile', args: { path: '/blueprint-index.json' } });
        expect(calls[2]).toEqual({ name: 'ListFiles', args: { path: '/ui/boot-home/' } });
      });

      it('should ignore hash comments between REPLOID/0 tool calls', () => {
        const text = `REPLOID/0

TOOL: Promote
path: /shadow/tools/KatamariEngine.js
target: /self/tools/KatamariEngine.js
# Correcting the Promote syntax. Promoting the staged engine.

TOOL: ListTools
{}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({
          name: 'Promote',
          args: {
            path: '/shadow/tools/KatamariEngine.js',
            target: '/self/tools/KatamariEngine.js'
          }
        });
        expect(calls[1]).toEqual({ name: 'ListTools', args: {} });
      });

      it('should strip trailing hash comments from inline REPLOID/0 args', () => {
        const text = 'REPLOID/0 TOOL: Promote path: /shadow/tools/KatamariEngine.js target: /self/tools/KatamariEngine.js # correcting syntax';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          name: 'Promote',
          args: {
            path: '/shadow/tools/KatamariEngine.js',
            target: '/self/tools/KatamariEngine.js'
          }
        });
      });

      it('should preserve hash values that are not standalone comments', () => {
        const text = 'REPLOID/0 TOOL: Paint color: #fff path: /shadow/style.css';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          name: 'Paint',
          args: {
            color: '#fff',
            path: '/shadow/style.css'
          }
        });
      });

      it('should keep colons inside one-line REPLOID/0 arg values', () => {
        const text = 'REPLOID/0 TOOL: Fetch url: https://example.com/a:b mode: read';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          name: 'Fetch',
          args: {
            url: 'https://example.com/a:b',
            mode: 'read'
          }
        });
      });

      it('should parse REPLOID/0 literal blocks without JSON escaping', () => {
        const text = `REPLOID/0

TOOL: WriteFile
path: /code.js
content <<EOF
function hello() {
  console.log("Hello");
}
EOF`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.path).toBe('/code.js');
        expect(calls[0].args.content).toContain('function hello()');
        expect(calls[0].args.content).toContain('console.log("Hello")');
      });

      it('should parse inline booleans, numbers, and JSON objects in REPLOID/0', () => {
        const text = `REPLOID/0

TOOL: Example
enabled: true
retries: 3
config: {"mode":"safe","paths":["/a","/b"]}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.enabled).toBe(true);
        expect(calls[0].args.retries).toBe(3);
        expect(calls[0].args.config).toEqual({ mode: 'safe', paths: ['/a', '/b'] });
      });

      it('should parse REPLOID/0 no-arg tools with empty JSON args', () => {
        const text = `REPLOID/0

TOOL: ListTools
{}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ListTools');
        expect(calls[0].args).toEqual({});
        expect(calls[0].error).toBeUndefined();
      });

      it('should parse REPLOID/0 same-line JSON object args', () => {
        const text = `REPLOID/0

TOOL: ReadFile {"path":"/self/runtime.js"}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].args).toEqual({ path: '/self/runtime.js' });
        expect(calls[0].error).toBeUndefined();
      });

      it('should parse REPLOID/0 PLAN steps with ids and dependencies', () => {
        const text = `REPLOID/0

PLAN:
[
  {
    "id": "a",
    "tool": "ReadFile",
    "args": { "path": "/self/a.js" }
  },
  {
    "id": "b",
    "tool": "ReadFile",
    "args": { "path": "/self/b.js" }
  },
  {
    "id": "c",
    "after": ["a", "b"],
    "tool": "WriteFile",
    "args": { "path": "/artifacts/out.txt", "content": "ok" }
  }
]`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(3);
        expect(calls[0]).toMatchObject({
          id: 'a',
          name: 'ReadFile',
          args: { path: '/self/a.js' }
        });
        expect(calls[1]).toMatchObject({
          id: 'b',
          name: 'ReadFile',
          args: { path: '/self/b.js' }
        });
        expect(calls[2]).toMatchObject({
          id: 'c',
          after: ['a', 'b'],
          name: 'WriteFile',
          args: { path: '/artifacts/out.txt', content: 'ok' }
        });
      });

      it('should parse a single tool call with simple args', () => {
        const text = `I'll read the file now.

TOOL_CALL: ReadFile
ARGS: { "path": "/test.txt" }

Let me check the contents.`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].args).toEqual({ path: '/test.txt' });
        expect(calls[0].error).toBeUndefined();
      });

      it('should parse multiple tool calls in sequence', () => {
        const text = `Let me do multiple things.

TOOL_CALL: ReadFile
ARGS: { "path": "/first.txt" }

Now another:

TOOL_CALL: WriteFile
ARGS: { "path": "/output.txt", "content": "Hello" }

Done.`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(2);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].args.path).toBe('/first.txt');
        expect(calls[1].name).toBe('WriteFile');
        expect(calls[1].args.path).toBe('/output.txt');
        expect(calls[1].args.content).toBe('Hello');
      });

      it('should parse tool call with nested JSON args', () => {
        const text = `TOOL_CALL: CreateTool
ARGS: { "name": "MyTool", "config": { "nested": { "deep": true }, "array": [1, 2, 3] } }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('CreateTool');
        expect(calls[0].args.name).toBe('MyTool');
        expect(calls[0].args.config.nested.deep).toBe(true);
        expect(calls[0].args.config.array).toEqual([1, 2, 3]);
      });

      it('should parse tool call with multiline string content', () => {
        const text = `TOOL_CALL: WriteFile
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
        const text = `TOOL_CALL: ListFiles
ARGS: {}`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ListFiles');
        expect(calls[0].args).toEqual({});
      });

      it('should handle args with special characters in strings', () => {
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/test.txt", "content": "Special chars: \\"quotes\\", \\\\backslash, \\n newline" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('quotes');
      });

      it('should handle whitespace variations in format', () => {
        const text = `TOOL_CALL:   ReadFile
ARGS:   { "path" : "/test.txt" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
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
        const text = `TOOL_CALL: ReadFile
Some other text here`;

        const calls = responseParser.parseToolCalls(text);
        // Should not match since ARGS: is required
        expect(calls).toHaveLength(0);
      });

      it('should handle malformed JSON in args with error', () => {
        const text = `TOOL_CALL: ReadFile
ARGS: { invalid json here }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
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
        const text = `TOOL_CALL: ReadFile
ARGS: not json`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].error).toBe('Invalid JSON block');
      });

      it('should report unterminated REPLOID/0 literal blocks', () => {
        const text = `REPLOID/0

TOOL: WriteFile
path: /broken.js
content <<EOF
export const broken = true;`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('WriteFile');
        expect(calls[0].error).toContain('Unterminated block');
      });

      it('should report invalid REPLOID/0 argument lines', () => {
        const text = `REPLOID/0

TOOL: ReadFile
path /missing-colon`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('ReadFile');
        expect(calls[0].error).toContain('Invalid argument line');
      });

      it('should ignore prose after a valid REPLOID/0 tool argument block', () => {
        const text = `REPLOID/0

TOOL: LoadModule
path: /self/tools/KatamariEngine.js
The module has been loaded. I will verify it next.`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toEqual([{
          name: 'LoadModule',
          args: { path: '/self/tools/KatamariEngine.js' }
        }]);
      });

      it('should trim prose accidentally appended to inline path arguments', () => {
        const text = 'REPLOID/0 TOOL: LoadModule path: /self/tools/KatamariEngine.js The module has been loaded. DONE';

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toEqual([{
          name: 'LoadModule',
          args: { path: '/self/tools/KatamariEngine.js' }
        }]);
      });

      it('should recover multiline CreateTool code after inline code prefix', () => {
        const text = `REPLOID/0

TOOL: CreateTool
name: RangeRead
code: /**
 * @fileoverview Tool to read smaller file ranges.
 */
export const tool = {
  name: 'RangeRead',
  description: 'Read a range.',
  inputSchema: { type: 'object', properties: {} },
  call: async () => ({ ok: true })
};`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('CreateTool');
        expect(calls[0].error).toBeUndefined();
        expect(calls[0].args.name).toBe('RangeRead');
        expect(calls[0].args.code).toContain('@fileoverview');
        expect(calls[0].args.code).toContain('export const tool');
      });

      it('should handle incomplete JSON (unclosed brace)', () => {
        const text = `TOOL_CALL: ReadFile
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
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/big.txt", "content": "${longContent}" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content.length).toBe(10000);
      });

      it('should handle JSON with unicode characters', () => {
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/unicode.txt", "content": "Hello 世界 🌍 émojis" }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('世界');
        expect(calls[0].args.content).toContain('🌍');
      });

      it('should handle mixed valid and invalid tool calls', () => {
        const text = `TOOL_CALL: ReadFile
ARGS: { "path": "/valid.txt" }

TOOL_CALL: bad_tool
ARGS: { broken }

TOOL_CALL: WriteFile
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

      it('should handle backtick template literals with braces inside', () => {
        // This is the case where LLM uses backticks for code content containing { }
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/tools/test.js", "content": \`export default async (args) => {
  return { result: args.value };
}\` }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('WriteFile');
        expect(calls[0].args.path).toBe('/tools/test.js');
        expect(calls[0].args.content).toContain('export default');
        expect(calls[0].args.content).toContain('return { result:');
      });

      it('should handle backtick strings with embedded double quotes', () => {
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/test.js", "content": \`const msg = "hello world";\` }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        expect(calls[0].args.content).toContain('"hello world"');
      });

      it('should handle backtick strings with literal newlines', () => {
        const text = `TOOL_CALL: WriteFile
ARGS: { "path": "/test.txt", "content": \`line1
line2
line3\` }`;

        const calls = responseParser.parseToolCalls(text);

        expect(calls).toHaveLength(1);
        // The backtick converter should convert literal newlines to \n
        expect(calls[0].args.content).toContain('line1');
        expect(calls[0].args.content).toContain('line2');
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

    it('should return true for directive completion markers', () => {
      expect(responseParser.isDone('DONE: Read the file and recorded evidence.')).toBe(true);
      expect(responseParser.isDone('IDLE: waiting for user input')).toBe(true);
      expect(responseParser.isDone('PARK: model unavailable')).toBe(true);
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

    it('should return false for lowercase done', () => {
      expect(responseParser.isDone('done')).toBe(false);
    });

    it('should return true with DONE in text', () => {
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
