/**
 * @fileoverview Stream Parser - SSE stream parsing utility
 * Extracts text content from Server-Sent Events streams.
 * Used by LLM providers (Gemini, OpenAI, Anthropic) for streaming responses.
 */

const StreamParser = {
  metadata: {
    id: 'StreamParser',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: [],
    async: false,
    type: 'utility'
  },

  factory: () => {
    /** Default timeout between stream chunks (30 seconds) */
    const DEFAULT_STREAM_TIMEOUT_MS = 30000;

    /**
     * Wrap a reader with timeout handling
     * Aborts if no data received within timeoutMs
     * @param {ReadableStreamDefaultReader} reader - The stream reader
     * @param {number} timeoutMs - Timeout in milliseconds
     * @param {AbortController} [abortController] - Optional controller to abort fetch
     * @returns {Object} Wrapped reader with timeout
     */
    const withStreamTimeout = (reader, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS, abortController = null) => {
      let timeoutId = null;

      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (abortController) {
            abortController.abort();
          }
          reader.cancel('Stream timeout - no data received');
        }, timeoutMs);
      };

      const clearStreamTimeout = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      return {
        async read() {
          resetTimeout();
          try {
            const result = await reader.read();
            if (result.done) clearStreamTimeout();
            return result;
          } catch (err) {
            clearStreamTimeout();
            throw err;
          }
        },
        cancel(reason) {
          clearStreamTimeout();
          return reader.cancel(reason);
        },
        releaseLock() {
          clearStreamTimeout();
          return reader.releaseLock();
        }
      };
    };
    /**
     * Parse SSE stream and extract text using provider-specific extractor
     * @param {Response} response - Fetch response with readable body
     * @param {Function} textExtractor - (data: object) => string - extracts text from parsed JSON
     * @param {Function} onUpdate - Called with each text chunk
     * @param {Object} [options] - Optional settings
     * @param {AbortController} [options.abortController] - Controller to abort on timeout
     * @param {number} [options.timeoutMs] - Timeout between chunks (default: 30s)
     * @returns {Promise<string>} Full accumulated content
     */
    const parseSSEStream = async (response, textExtractor, onUpdate, options = {}) => {
      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const { abortController, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS } = options;
      const rawReader = response.body.getReader();
      const reader = withStreamTimeout(rawReader, timeoutMs, abortController);
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const text = textExtractor(data);
                if (text) {
                  fullContent += text;
                  onUpdate?.(text);
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }
        }

        // Process any remaining buffer content
        if (buffer.startsWith('data: ') && buffer !== 'data: [DONE]') {
          try {
            const data = JSON.parse(buffer.slice(6));
            const text = textExtractor(data);
            if (text) {
              fullContent += text;
              onUpdate?.(text);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      } finally {
        reader.releaseLock();
      }

      return fullContent;
    };

    /**
     * Pre-built text extractors for common LLM providers
     */
    const extractors = {
      gemini: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      openai: (data) => data.choices?.[0]?.delta?.content || '',
      anthropic: (data) => {
        if (data.type === 'content_block_delta') {
          return data.delta?.text || '';
        }
        return '';
      }
    };

    /**
     * Convenience method to parse stream for a specific provider
     * @param {Response} response - Fetch response
     * @param {string} provider - 'gemini' | 'openai' | 'anthropic'
     * @param {Function} onUpdate - Called with each text chunk
     * @param {Object} [options] - Optional settings (abortController, timeoutMs)
     * @returns {Promise<string>} Full content
     */
    const parseForProvider = async (response, provider, onUpdate, options = {}) => {
      const extractor = extractors[provider];
      if (!extractor) {
        throw new Error(`Unknown provider: ${provider}`);
      }
      return parseSSEStream(response, extractor, onUpdate, options);
    };

    /**
     * Parse OpenAI stream with tool call support
     * OpenAI streams tool_calls in chunks with index-based accumulation
     * @param {Response} response - Fetch response
     * @param {Function} onUpdate - Called with each text chunk
     * @param {Object} [options] - Optional settings
     * @returns {Promise<{content: string, toolCalls: Array|null}>} Content and tool calls
     */
    const parseOpenAIStreamWithTools = async (response, onUpdate, options = {}) => {
      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const { abortController, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS } = options;
      const rawReader = response.body.getReader();
      const reader = withStreamTimeout(rawReader, timeoutMs, abortController);
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      // Accumulate tool calls by index
      const toolCallsMap = new Map(); // index -> { id, name, arguments }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const delta = data.choices?.[0]?.delta;

                // Handle text content
                if (delta?.content) {
                  fullContent += delta.content;
                  onUpdate?.(delta.content);
                }

                // Handle tool calls (accumulate by index)
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsMap.has(idx)) {
                      toolCallsMap.set(idx, { id: '', name: '', arguments: '' });
                    }
                    const entry = toolCallsMap.get(idx);
                    if (tc.id) entry.id = tc.id;
                    if (tc.function?.name) entry.name = tc.function.name;
                    if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                  }
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Convert tool calls map to array
      let toolCalls = null;
      if (toolCallsMap.size > 0) {
        toolCalls = [];
        for (const [, entry] of toolCallsMap) {
          if (entry.name) {
            let args = {};
            try {
              args = JSON.parse(entry.arguments || '{}');
            } catch {
              // Invalid JSON in arguments
            }
            toolCalls.push({
              id: entry.id,
              name: entry.name,
              args
            });
          }
        }
      }

      return { content: fullContent, toolCalls };
    };

    /**
     * Parse Anthropic stream with tool call support
     * Anthropic uses content_block events with type='tool_use'
     * @param {Response} response - Fetch response
     * @param {Function} onUpdate - Called with each text chunk
     * @param {Object} [options] - Optional settings
     * @returns {Promise<{content: string, toolCalls: Array|null}>}
     */
    const parseAnthropicStreamWithTools = async (response, onUpdate, options = {}) => {
      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const { abortController, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS } = options;
      const rawReader = response.body.getReader();
      const reader = withStreamTimeout(rawReader, timeoutMs, abortController);
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      const toolCalls = [];
      let currentToolUse = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                // Handle text content
                if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                  const text = data.delta.text || '';
                  if (text) {
                    fullContent += text;
                    onUpdate?.(text);
                  }
                }

                // Handle tool use start
                if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
                  currentToolUse = {
                    id: data.content_block.id,
                    name: data.content_block.name,
                    arguments: ''
                  };
                }

                // Handle tool use input delta
                if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
                  if (currentToolUse) {
                    currentToolUse.arguments += data.delta.partial_json || '';
                  }
                }

                // Handle tool use end
                if (data.type === 'content_block_stop' && currentToolUse) {
                  let args = {};
                  try {
                    args = JSON.parse(currentToolUse.arguments || '{}');
                  } catch { /* Invalid JSON */ }
                  toolCalls.push({
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    args
                  });
                  currentToolUse = null;
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return { content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : null };
    };

    /**
     * Parse Gemini stream with tool call support
     * Gemini uses functionCall in candidates
     * @param {Response} response - Fetch response
     * @param {Function} onUpdate - Called with each text chunk
     * @param {Object} [options] - Optional settings
     * @returns {Promise<{content: string, toolCalls: Array|null}>}
     */
    const parseGeminiStreamWithTools = async (response, onUpdate, options = {}) => {
      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const { abortController, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS } = options;
      const rawReader = response.body.getReader();
      const reader = withStreamTimeout(rawReader, timeoutMs, abortController);
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      const toolCalls = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const candidate = data.candidates?.[0];

                // Handle text content
                const text = candidate?.content?.parts?.[0]?.text || '';
                if (text) {
                  fullContent += text;
                  onUpdate?.(text);
                }

                // Handle function calls
                const functionCall = candidate?.content?.parts?.[0]?.functionCall;
                if (functionCall) {
                  toolCalls.push({
                    id: `gemini_${Date.now()}_${toolCalls.length}`,
                    name: functionCall.name,
                    args: functionCall.args || {}
                  });
                }
              } catch {
                // Skip malformed JSON chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return { content: fullContent, toolCalls: toolCalls.length > 0 ? toolCalls : null };
    };

    return {
      parseSSEStream,
      parseForProvider,
      parseOpenAIStreamWithTools,
      parseAnthropicStreamWithTools,
      parseGeminiStreamWithTools,
      extractors,
      withStreamTimeout,
      DEFAULT_STREAM_TIMEOUT_MS
    };
  }
};

export default StreamParser;
