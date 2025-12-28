# Blueprint 0x000081-RSPR: Response Parser

**Module:** `ResponseParser`
**File:** `core/response-parser.js`
**Purpose:** Extract tool calls from LLM text using robust regex parsing with brace counting

**Genesis Level:** tabula

---

## Purpose

The Response Parser extracts structured tool calls from free-form LLM text responses. It uses a robust regex-based approach with brace counting to handle nested JSON objects, template literals, and escaped content correctly.

---

## API / Interface

```javascript
// Parse tool calls from LLM response text
const calls = ResponseParser.parseToolCalls(text);
// Returns: [{ name: 'ReadFile', args: { path: '/core/vfs.js' } }, ...]

// Check if agent is done (RSI mode awareness)
const done = ResponseParser.isDone(text);
// Always returns false in RSI mode - agent continues indefinitely

// Validate a tool call structure
const isValid = ResponseParser.validateToolCall(call, schema);
// Returns: boolean
```

### parseToolCalls(text)

Extracts tool call blocks from LLM output text using the `TOOL_CALL:` / `ARGS:` format.

**Input Format Supported:**
```
TOOL_CALL: ReadFile
ARGS: {
  "path": "/core/agent-loop.js"
}

TOOL_CALL: WriteFile
ARGS: {
  "path": "/tools/NewTool.js",
  "content": "const x = { nested: { obj: true } };"
}
```

**Returns:** Array of `{ name: string, args: object }`

### isDone(text)

Checks if the response indicates task completion. In RSI (Recursive Self-Improvement) mode, this always returns `false` to keep the agent loop running indefinitely.

**Returns:** `boolean` (always `false` in RSI mode)

---

## Implementation Details

### Brace-Counted JSON Extraction

The parser uses character-by-character scanning with brace counting to correctly extract nested JSON:

```javascript
const extractJSON = (text, startIdx) => {
  let depth = 0;
  let inString = false;
  let stringChar = null;
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    // Track string state (handles ", ', `)
    if ((char === '"' || char === "'" || char === '`') && !inString) {
      inString = true;
      stringChar = char;
    } else if (char === stringChar && inString) {
      inString = false;
      stringChar = null;
    }

    if (!inString) {
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null; // Unbalanced braces
};
```

### Key Features

1. **Brace-Counted JSON Extraction** - Handles nested objects correctly without false matches
2. **String-Aware Parsing** - Tracks quote delimiters (", ', `) to avoid matching braces inside strings
3. **Escape Handling** - Properly handles backslash escapes in strings
4. **Template Literal Support** - Handles backtick strings in JSON content
5. **Multi-Call Extraction** - Finds all TOOL_CALL blocks in a single response

### Regex Pattern

```javascript
const TOOL_CALL_PATTERN = /TOOL_CALL:\s*(\w+)\s*\nARGS:\s*(\{)/g;
```

---

## Dependencies

| Blueprint | Module | Purpose |
|-----------|--------|---------|
| 0x000003 | Utils | Logging, error handling utilities |

---

## Genesis Level

**tabula** - Core infrastructure module, part of the immutable genesis kernel. Cannot be modified without HITL approval.

---

**Status:** Implemented
