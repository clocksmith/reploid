# Blueprint 0x000081: Response Parser

**Objective:** Extract structured tool calls from LLM text output using robust regex parsing.

**Target Module:** ResponseParser (`core/response-parser.js`)

**Prerequisites:** Utils

**Affected Artifacts:** `/core/response-parser.js`

---

### 1. The Strategic Imperative

LLMs produce text output that may contain tool invocations in a specific format. The system needs a reliable parser that can extract these tool calls regardless of surrounding text, handle malformed JSON gracefully, and support various string literal formats (including backtick template literals). Without robust parsing, tool calls would fail silently or crash the agent loop.

### 2. The Architectural Solution

The ResponseParser module provides a single-responsibility service for extracting tool calls from LLM responses:

1. **Format Recognition:** Detects the standard `TOOL_CALL: name\nARGS: {...}` format
2. **Brace Counting:** Uses character-by-character parsing to correctly match nested JSON braces
3. **String Handling:** Supports both double-quote and backtick-delimited strings with proper escape handling
4. **Error Tolerance:** Returns partial results with error flags rather than throwing on malformed input

**Module Structure:**
```javascript
const ResponseParser = {
  metadata: {
    id: 'ResponseParser',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger, sanitizeLlmJsonRespPure } = deps.Utils;

    const parseToolCalls = (text) => {
      // Regex-based extraction with brace counting
      // Returns: [{ name, args, error? }]
    };

    return { parseToolCalls };
  }
};
```

### 3. Key Algorithms

**Brace-Counting Parser:**
- Tracks brace depth to find matching `{}`
- Tracks string context (inside `"..."` or `` `...` ``)
- Handles escape sequences (`\"`, `\\`)
- Returns extracted JSON substring for parsing

**Sanitization Pipeline:**
- Uses `sanitizeLlmJsonRespPure` from Utils
- Handles common LLM artifacts (trailing commas, unquoted keys)
- Falls back to empty args on parse failure

### 4. API Surface

| Method | Description |
|--------|-------------|
| `parseToolCalls(text)` | Extracts all tool calls from text, returns array of `{name, args, error?}` |

### 5. Genesis Level

**TABULA** - Core parsing required for basic agent operation.

---

### 6. Testing Considerations

- Multiple tool calls in single response
- Nested JSON objects in args
- Backtick strings with embedded quotes
- Malformed JSON recovery
- Empty/null input handling
