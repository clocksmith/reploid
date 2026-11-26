# Blueprint 0x000039: Streaming Response Handler

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/stream-parser.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/stream-parser.js`

**Former Blueprint Paths:** `self/blueprints/0x000039-streaming-response-handler.md`

**Module ID:** `StreamParser` (version 2.0.0, genesis level `reflection`, type `utility`, no dependencies)

**Source:** `self/infrastructure/stream-parser.js`

---

## Purpose

`StreamParser` turns a provider's Server-Sent Events (SSE) response into text chunks while the response arrives, so the caller can show partial output and stop a hung stream. It is a stateless utility: it does not wrap an API client and it does not touch the UI.

The only runtime consumer is `LLMClient` ([0x000007](0x000007-api-client-and-communication.md)), which declares it as the optional dependency `StreamParser?` (`self/core/llm-client.js:14`). Without it, `LLMClient` does not request streamed responses (`llm-client.js:457`, `:575`).

## Exports

The factory returns:

| Export | Signature | Behavior |
| --- | --- | --- |
| `parseSSEStream` | `(response, textExtractor, onUpdate, options?) => Promise<string>` | Reads `response.body`, splits on newlines, parses each `data: ` line except `data: [DONE]` as JSON, passes it to `textExtractor`, calls `onUpdate(text)` for each non-empty result and returns the accumulated text. Malformed JSON lines are skipped. |
| `parseForProvider` | `(response, provider, onUpdate, options?) => Promise<string>` | Looks up `extractors[provider]` and calls `parseSSEStream`. Throws `Unknown provider: <name>` for anything other than `gemini`, `openai`, `anthropic`. |
| `parseOpenAIStreamWithTools` | `(response, onUpdate, options?) => Promise<{ content, toolCalls }>` | Accumulates `choices[0].delta.content` and `delta.tool_calls` by `index`; arguments are concatenated and JSON-parsed at the end (invalid JSON becomes `{}`). |
| `parseAnthropicStreamWithTools` | same | Text from `content_block_delta`/`text_delta`; a tool call opens at `content_block_start` with `tool_use`, gathers `input_json_delta.partial_json` and closes at `content_block_stop`. |
| `parseGeminiStreamWithTools` | same | Text from `candidates[0].content.parts[0].text`; each `functionCall` becomes `{ id: 'gemini_<time>_<n>', name, args }`. |
| `extractors` | `{ gemini, openai, anthropic }` | Text extractors used by `parseForProvider`. |
| `withStreamTimeout` | `(reader, timeoutMs?, abortController?, { onBackpressure, onResume }?)` | Wraps a stream reader with an inter-chunk timeout and backpressure (below). |
| `createPartialTokenDecoder` | `() => { decode(chunk, stream?), flush(), hasPending() }` | UTF-8 decoder that holds an incomplete multi-byte sequence at a chunk boundary until the next chunk. |
| `DEFAULT_STREAM_TIMEOUT_MS` | `30000` | Default time allowed between chunks. |
| `MAX_BUFFER_SIZE` | `1048576` | Exported constant; no code path in this module reads it. |
| `BACKPRESSURE_HIGH_WATER_MARK` | `524288` | Buffer length that pauses reading. |
| `BACKPRESSURE_LOW_WATER_MARK` | `262144` | Buffer length that resumes reading. |

The three `...WithTools` parsers return `toolCalls: null` when no complete tool call was seen.

`options` accepts `abortController`, `timeoutMs` and, for `parseSSEStream` only, `onBackpressure` and `onResume`.

## Invariants

1. **Inter-chunk timeout.** Every `read()` resets a timer. If no chunk arrives within `timeoutMs`, the wrapper aborts the supplied `AbortController` with an error whose `code` is `STREAM_TIMEOUT` and cancels the reader. The timer is cleared on completion, error, `cancel()` and `releaseLock()`.
2. **No split characters.** Bytes of an incomplete UTF-8 sequence at the end of a chunk are held back and decoded with the next chunk; `flush()` decodes whatever remains at stream end.
3. **Final flush.** After the reader reports `done`, any text left in the line buffer is parsed, so a last event without a trailing newline is not lost.
4. **Backpressure.** `parseSSEStream` calls `checkBackpressure(buffer.length)` after each chunk. At or above the high-water mark the next `read()` waits; at or below the low-water mark it resumes. The callbacks receive `{ bytesReceived }`.
5. **Lock release.** Every parser releases the reader lock in a `finally` block.

## Boundaries

- The parser does not retry, reconnect, estimate progress or record streams for replay.
- `LLMClient` also uses `withStreamTimeout` directly for a non-SSE stream (`llm-client.js:511`).
- No dedicated unit test for this module exists in `tests/`; streaming is exercised through `LLMClient` paths.

## Related blueprints

- [0x000007 API Client and Communication](0x000007-api-client-and-communication.md): the consumer.
- [0x00003A Context Management](0x00003A-context-management.md): bounds what is sent before a stream starts.
