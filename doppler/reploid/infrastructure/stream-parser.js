/**
 * @fileoverview Stream Parser - SSE stream parsing utility
 * Extracts text content from Server-Sent Events streams.
 * Used by LLM providers (Gemini, OpenAI, Anthropic) for streaming responses.
 *
 * Features:
 * - Buffer flushing at stream end
 * - Partial token handling for incomplete UTF-8 sequences
 * - Backpressure support to prevent memory exhaustion
 * - 30s timeout between chunks to prevent hung connections
 */

const StreamParser = {
  metadata: {
    id: 'StreamParser',
    version: '2.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: [],
    async: false,
    type: 'utility'
  },

  factory: () => {
    /** Default timeout between stream chunks (30 seconds) */
    const DEFAULT_STREAM_TIMEOUT_MS = 30000;

    /** Maximum buffer size before applying backpressure (1MB) */
    const MAX_BUFFER_SIZE = 1024 * 1024;

    /** High water mark for backpressure (512KB) */
    const BACKPRESSURE_HIGH_WATER_MARK = 512 * 1024;

    /** Low water mark to resume after backpressure (256KB) */
    const BACKPRESSURE_LOW_WATER_MARK = 256 * 1024;

    /**
     * Wrap a reader with timeout handling and backpressure support
     * Aborts if no data received within timeoutMs
     * @param {ReadableStreamDefaultReader} reader - The stream reader
     * @param {number} timeoutMs - Timeout in milliseconds
     * @param {AbortController} [abortController] - Optional controller to abort fetch
     * @param {Object} [options] - Additional options
     * @param {Function} [options.onBackpressure] - Called when backpressure is applied
     * @param {Function} [options.onResume] - Called when backpressure is released
     * @returns {Object} Wrapped reader with timeout and backpressure
     */
    const withStreamTimeout = (reader, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS, abortController = null, options = {}) => {
      let timeoutId = null;
      let totalBytesReceived = 0;
      let backpressureActive = false;
      let backpressurePromise = null;
      let backpressureResolve = null;
      const { onBackpressure, onResume } = options;

      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          const error = new Error('Stream timeout - no data received within ' + timeoutMs + 'ms');
          error.code = 'STREAM_TIMEOUT';
          if (abortController) {
            abortController.abort(error);
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

      /**
       * Apply backpressure - pause reading until buffer drains
       */
      const applyBackpressure = () => {
        if (!backpressureActive) {
          backpressureActive = true;
          backpressurePromise = new Promise(resolve => {
            backpressureResolve = resolve;
          });
          onBackpressure?.({ bytesReceived: totalBytesReceived });
        }
      };

      /**
       * Release backpressure - resume reading
       */
      const releaseBackpressure = () => {
        if (backpressureActive) {
          backpressureActive = false;
          backpressureResolve?.();
          backpressurePromise = null;
          backpressureResolve = null;
          onResume?.({ bytesReceived: totalBytesReceived });
        }
      };

      /**
       * Check if backpressure should be applied based on buffer size
       * @param {number} bufferSize - Current buffer size in bytes
       */
      const checkBackpressure = (bufferSize) => {
        if (bufferSize >= BACKPRESSURE_HIGH_WATER_MARK && !backpressureActive) {
          applyBackpressure();
        } else if (bufferSize <= BACKPRESSURE_LOW_WATER_MARK && backpressureActive) {
          releaseBackpressure();
        }
      };

      return {
        async read() {
          // Wait for backpressure to release if active
          if (backpressurePromise) {
            await backpressurePromise;
          }

          resetTimeout();
          try {
            const result = await reader.read();
            if (result.done) {
              clearStreamTimeout();
              releaseBackpressure();
            } else if (result.value) {
              totalBytesReceived += result.value.length;
            }
            return result;
          } catch (err) {
            clearStreamTimeout();
            releaseBackpressure();
            throw err;
          }
        },
        cancel(reason) {
          clearStreamTimeout();
          releaseBackpressure();
          return reader.cancel(reason);
        },
        releaseLock() {
          clearStreamTimeout();
          releaseBackpressure();
          return reader.releaseLock();
        },
        // Expose backpressure control for external management
        checkBackpressure,
        releaseBackpressure,
        isBackpressureActive: () => backpressureActive,
        getBytesReceived: () => totalBytesReceived
      };
    };

    /**
     * Create a streaming text decoder that handles partial UTF-8 sequences
     * @returns {Object} Decoder with flush capability
     */
    const createPartialTokenDecoder = () => {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let pendingBytes = new Uint8Array(0);

      return {
        /**
         * Decode a chunk, handling partial UTF-8 sequences at boundaries
         * @param {Uint8Array} chunk - Incoming bytes
         * @param {boolean} stream - Whether more data is expected
         * @returns {string} Decoded text (may be incomplete if stream=true)
         */
        decode(chunk, stream = true) {
          // Combine pending bytes with new chunk
          if (pendingBytes.length > 0) {
            const combined = new Uint8Array(pendingBytes.length + chunk.length);
            combined.set(pendingBytes);
            combined.set(chunk, pendingBytes.length);
            chunk = combined;
            pendingBytes = new Uint8Array(0);
          }

          if (!stream) {
            // Final decode - flush everything
            return decoder.decode(chunk, { stream: false });
          }

          // Check for partial UTF-8 sequence at the end
          // UTF-8 continuation bytes start with 10xxxxxx (0x80-0xBF)
          // UTF-8 lead bytes: 110xxxxx (2-byte), 1110xxxx (3-byte), 11110xxx (4-byte)
          let partialStart = chunk.length;
          for (let i = Math.max(0, chunk.length - 4); i < chunk.length; i++) {
            const byte = chunk[i];
            if ((byte & 0xC0) === 0xC0) {
              // This is a lead byte - check if sequence is complete
              let expectedLength = 1;
              if ((byte & 0xE0) === 0xC0) expectedLength = 2;
              else if ((byte & 0xF0) === 0xE0) expectedLength = 3;
              else if ((byte & 0xF8) === 0xF0) expectedLength = 4;

              if (i + expectedLength > chunk.length) {
                // Incomplete sequence at end
                partialStart = i;
                break;
              }
            }
          }

          if (partialStart < chunk.length) {
            // Save partial sequence for next decode
            pendingBytes = chunk.slice(partialStart);
            chunk = chunk.slice(0, partialStart);
          }

          return decoder.decode(chunk, { stream: true });
        },

        /**
         * Flush any remaining bytes
         * @returns {string} Any remaining decoded text
         */
        flush() {
          if (pendingBytes.length === 0) {
            return decoder.decode(new Uint8Array(0), { stream: false });
          }
          const result = decoder.decode(pendingBytes, { stream: false });
          pendingBytes = new Uint8Array(0);
          return result;
        },

        /**
         * Check if there are pending bytes
         * @returns {boolean}
         */
        hasPending() {
          return pendingBytes.length > 0;
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
     * @param {Function} [options.onBackpressure] - Called when backpressure is applied
     * @param {Function} [options.onResume] - Called when backpressure is released
     * @returns {Promise<string>} Full accumulated content
     */
    const parseSSEStream = async (response, textExtractor, onUpdate, options = {}) => {
      if (!response.body) {
        throw new Error('Response body is not readable');
      }

      const { abortController, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS, onBackpressure, onResume } = options;
      const rawReader = response.body.getReader();
      const reader = withStreamTimeout(rawReader, timeoutMs, abortController, { onBackpressure, onResume });
      const tokenDecoder = createPartialTokenDecoder();
      let buffer = '';
      let fullContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Use partial token decoder for proper UTF-8 handling
          buffer += tokenDecoder.decode(value, true);

          // Check backpressure based on buffer size
          reader.checkBackpressure(buffer.length);

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

          // Release backpressure after processing
          if (buffer.length < BACKPRESSURE_LOW_WATER_MARK) {
            reader.releaseBackpressure();
          }
        }

        // Flush any remaining partial UTF-8 sequences
        const flushed = tokenDecoder.flush();
        if (flushed) {
          buffer += flushed;
        }

        // Process any remaining buffer content (final flush)
        if (buffer.trim()) {
          const remainingLines = buffer.split('\n');
          for (const line of remainingLines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6));
                const text = textExtractor(data);
                if (text) {
                  fullContent += text;
                  onUpdate?.(text);
                }
              } catch {
                // Skip malformed JSON
              }
            }
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
      createPartialTokenDecoder,
      DEFAULT_STREAM_TIMEOUT_MS,
      MAX_BUFFER_SIZE,
      BACKPRESSURE_HIGH_WATER_MARK,
      BACKPRESSURE_LOW_WATER_MARK
    };
  }
};

export default StreamParser;
