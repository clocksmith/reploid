/**
 * @fileoverview Integration tests for LLMClient
 * Tests chat routing, streaming, rate limiting, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LLMClientModule from '../../core/llm-client.js';

describe('LLMClient - Integration Tests', () => {
  let llmClient;
  let mockUtils;
  let mockRateLimiter;
  let mockTransformersClient;

  let mockStreamParser;

  const createMocks = () => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockReturnValue('req_test123'),
      Errors: {
        ConfigError: class ConfigError extends Error {
          constructor(msg) { super(msg); this.name = 'ConfigError'; }
        },
        ApiError: class ApiError extends Error {
          constructor(msg, status) { super(msg); this.name = 'ApiError'; this.status = status; }
        }
      }
    };

    mockRateLimiter = {
      createLimiter: vi.fn().mockReturnValue({
        waitForToken: vi.fn().mockResolvedValue(true)
      })
    };

    mockTransformersClient = {
      chat: vi.fn(),
      isTransformersModel: vi.fn().mockReturnValue(false),
      getStatus: vi.fn().mockReturnValue({ available: true }),
      cleanup: vi.fn().mockResolvedValue(true)
    };

    // StreamParser mock - enables streaming mode in LLMClient
    mockStreamParser = {
      DEFAULT_STREAM_TIMEOUT_MS: 60000,
      withStreamTimeout: vi.fn((reader) => reader), // Pass through reader
      parseForProvider: vi.fn().mockResolvedValue('Streamed content')
    };
  };

  beforeEach(() => {
    createMocks();

    // Mock fetch globally
    global.fetch = vi.fn();

    llmClient = LLMClientModule.factory({
      Utils: mockUtils,
      RateLimiter: mockRateLimiter,
      TransformersClient: mockTransformersClient,
      StreamParser: mockStreamParser
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete global.fetch;
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(LLMClientModule.metadata.id).toBe('LLMClient');
      expect(LLMClientModule.metadata.type).toBe('service');
      expect(LLMClientModule.metadata.dependencies).toContain('Utils');
      // Optional deps are marked with ? suffix
      expect(LLMClientModule.metadata.dependencies).toContain('RateLimiter?');
    });
  });

  describe('rate limiting', () => {
    it('should wait for rate limiter token before request', async () => {
      const mockLimiter = mockRateLimiter.createLimiter();

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: 'Response' })
      });

      await llmClient.chat(
        [{ role: 'user', content: 'Hello' }],
        { id: 'test-model', provider: 'proxy' }
      );

      expect(mockLimiter.waitForToken).toHaveBeenCalled();
    });
  });

  describe('proxy mode', () => {
    it('should send request to proxy endpoint', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: 'Hello from LLM'
        })
      });

      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' }
      ];

      const result = await llmClient.chat(messages, {
        id: 'gpt-4',
        provider: 'openai',
        endpoint: '/api/chat'
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }));

      expect(result.content).toBe('Hello from LLM');
      expect(result.model).toBe('gpt-4');
    });

    it('should handle streaming responses', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n')
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":" World"}}]}\n')
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn()
      };

      global.fetch.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => mockReader
        }
      });

      const onUpdate = vi.fn();
      const result = await llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'gpt-4', provider: 'openai' },
        onUpdate
      );

      expect(onUpdate).toHaveBeenCalledWith('Hello');
      expect(onUpdate).toHaveBeenCalledWith(' World');
      expect(result.content).toBe('Hello World');
    });

    it('should throw ApiError on non-OK response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500
      });

      await expect(llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'test', provider: 'test' }
      )).rejects.toThrow('API Error 500');
    });

    it('should handle Ollama-specific request options', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: 'Response' })
      });

      await llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'llama2', provider: 'ollama' }
      );

      const fetchCall = global.fetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.options).toEqual({ temperature: 0.7 });
    });
  });

  describe('thought stripping', () => {
    it('should strip <think> tags from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: '<think>Internal reasoning here</think>The actual answer'
        })
      });

      const result = await llmClient.chat(
        [{ role: 'user', content: 'Test' }],
        { id: 'test', provider: 'test' }
      );

      expect(result.content).toBe('The actual answer');
      expect(result.content).not.toContain('<think>');
    });

    it('should strip <thinking> tags from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: '<thinking>Let me think...</thinking>Here is the answer'
        })
      });

      const result = await llmClient.chat(
        [{ role: 'user', content: 'Test' }],
        { id: 'test', provider: 'test' }
      );

      expect(result.content).toBe('Here is the answer');
    });

    it('should preserve raw content', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: '<think>Reasoning</think>Answer'
        })
      });

      const result = await llmClient.chat(
        [{ role: 'user', content: 'Test' }],
        { id: 'test', provider: 'test' }
      );

      expect(result.raw).toBe('<think>Reasoning</think>Answer');
      expect(result.content).toBe('Answer');
    });
  });

  describe('transformers.js mode', () => {
    it('should route to TransformersClient when provider is transformers', async () => {
      mockTransformersClient.chat.mockResolvedValue({
        content: 'Transformers response',
        model: 'phi-2'
      });

      const result = await llmClient.chat(
        [{ role: 'user', content: 'Hello' }],
        { id: 'phi-2', provider: 'transformers' }
      );

      expect(mockTransformersClient.chat).toHaveBeenCalled();
      expect(result.content).toBe('Transformers response');
    });

    it('should route to TransformersClient for recognized models', async () => {
      mockTransformersClient.isTransformersModel.mockReturnValue(true);
      mockTransformersClient.chat.mockResolvedValue({
        content: 'Response',
        model: 'custom-model'
      });

      const result = await llmClient.chat(
        [{ role: 'user', content: 'Test' }],
        { id: 'custom-model', provider: 'local' }
      );

      expect(mockTransformersClient.chat).toHaveBeenCalled();
    });
  });

  describe('direct cloud API mode', () => {
    describe('OpenAI', () => {
      it('should make direct API call to OpenAI', async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'OpenAI response' } }]
          })
        });

        const result = await llmClient.chat(
          [{ role: 'user', content: 'Hello' }],
          {
            id: 'gpt-4',
            provider: 'openai',
            hostType: 'browser-cloud',
            apiKey: 'sk-test123'
          }
        );

        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.openai.com/v1/chat/completions',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Authorization': 'Bearer sk-test123'
            })
          })
        );

        expect(result.provider).toBe('openai');
      });

      it('should throw if no API key provided', async () => {
        await expect(llmClient.chat(
          [{ role: 'user', content: 'Test' }],
          { id: 'gpt-4', provider: 'openai', hostType: 'browser-cloud' }
        )).rejects.toThrow('API key required');
      });
    });

    describe('Anthropic', () => {
      it('should make direct API call to Anthropic', async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: 'Claude response' }]
          })
        });

        const result = await llmClient.chat(
          [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' }
          ],
          {
            id: 'claude-3-sonnet-20240229',
            provider: 'anthropic',
            hostType: 'browser-cloud',
            apiKey: 'sk-ant-test'
          }
        );

        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.anthropic.com/v1/messages',
          expect.objectContaining({
            headers: expect.objectContaining({
              'x-api-key': 'sk-ant-test',
              'anthropic-version': '2023-06-01'
            })
          })
        );

        expect(result.content).toBe('Claude response');
      });

      it('should extract system message for Anthropic', async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            content: [{ text: 'Response' }]
          })
        });

        await llmClient.chat(
          [
            { role: 'system', content: 'Be concise' },
            { role: 'user', content: 'Hi' }
          ],
          {
            id: 'claude-3',
            provider: 'anthropic',
            hostType: 'browser-cloud',
            apiKey: 'key'
          }
        );

        const fetchCall = global.fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.system).toBe('Be concise');
        expect(body.messages.some(m => m.role === 'system')).toBe(false);
      });
    });

    describe('Gemini', () => {
      it('should make direct API call to Gemini', async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }]
          })
        });

        const result = await llmClient.chat(
          [{ role: 'user', content: 'Hello' }],
          {
            id: 'gemini-pro',
            provider: 'gemini',
            hostType: 'browser-cloud',
            apiKey: 'gemini-key'
          }
        );

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('generativelanguage.googleapis.com'),
          expect.any(Object)
        );

        expect(result.content).toBe('Gemini response');
      });

      it('should convert message roles for Gemini', async () => {
        global.fetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'Response' }] } }]
          })
        });

        await llmClient.chat(
          [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'User message' },
            { role: 'assistant', content: 'Assistant message' }
          ],
          {
            id: 'gemini-pro',
            provider: 'gemini',
            hostType: 'browser-cloud',
            apiKey: 'key'
          }
        );

        const fetchCall = global.fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        // Gemini uses 'model' instead of 'assistant'
        const hasModelRole = body.contents.some(m => m.role === 'model');
        expect(hasModelRole).toBe(true);
      });
    });
  });

  describe('abort request', () => {
    it('should abort in-flight request', async () => {
      const abortFn = vi.fn();
      global.AbortController = vi.fn().mockImplementation(() => ({
        signal: { aborted: false },
        abort: abortFn
      }));

      // Make request start but not complete
      global.fetch.mockImplementation(() => new Promise(() => {}));

      const chatPromise = llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'test', provider: 'test' }
      );

      // Give request time to start
      await new Promise(r => setTimeout(r, 10));

      const aborted = llmClient.abortRequest('req_test123');
      expect(aborted).toBe(true);
    });

    it('should return false for unknown request ID', () => {
      const result = llmClient.abortRequest('unknown_id');
      expect(result).toBe(false);
    });
  });

  describe('status methods', () => {
    it('should return WebLLM status', () => {
      const status = llmClient.getWebLLMStatus();
      expect(status).toHaveProperty('loaded');
      expect(status).toHaveProperty('model');
    });

    it('should return Transformers status', () => {
      const status = llmClient.getTransformersStatus();
      expect(status).toHaveProperty('available');
    });
  });

  describe('GPU memory management', () => {
    it('should release GPU memory', async () => {
      await llmClient.releaseGPUMemory();

      // Should call TransformersClient cleanup
      expect(mockTransformersClient.cleanup).toHaveBeenCalled();
      expect(mockUtils.logger.info).toHaveBeenCalledWith('[LLM] All GPU memory released');
    });
  });

  describe('stream parsing', () => {
    it('should handle incomplete chunks', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel')
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('lo"}}]}\ndata: {"choices":[{"delta":{"content":" World"}}]}\n')
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn()
      };

      global.fetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader }
      });

      const onUpdate = vi.fn();
      await llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'test', provider: 'test' },
        onUpdate
      );

      // Should have received both chunks
      expect(onUpdate).toHaveBeenCalledWith('Hello');
      expect(onUpdate).toHaveBeenCalledWith(' World');
    });

    it('should skip [DONE] markers', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\ndata: [DONE]\n')
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn()
      };

      global.fetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader }
      });

      const onUpdate = vi.fn();
      await llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'test', provider: 'test' },
        onUpdate
      );

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith('Hi');
    });

    it('should handle malformed JSON chunks gracefully', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('data: not-valid-json\ndata: {"choices":[{"delta":{"content":"Valid"}}]}\n')
          })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn()
      };

      global.fetch.mockResolvedValue({
        ok: true,
        body: { getReader: () => mockReader }
      });

      const onUpdate = vi.fn();
      await llmClient.chat(
        [{ role: 'user', content: 'Hi' }],
        { id: 'test', provider: 'test' },
        onUpdate
      );

      // Should only get the valid chunk
      expect(onUpdate).toHaveBeenCalledWith('Valid');
    });
  });
});
