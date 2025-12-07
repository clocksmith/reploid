/**
 * @fileoverview Unit tests for ContextManager module
 * Tests token counting, compaction logic, and caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

const createMockLLMClient = (summaryResponse = 'This is a summary of the conversation.') => ({
  chat: vi.fn().mockResolvedValue({ content: summaryResponse })
});

const createMockEventBus = () => ({
  emit: vi.fn()
});

import ContextManagerModule from '../../core/context-manager.js';

describe('ContextManager', () => {
  let contextManager;
  let mockUtils;
  let mockLLMClient;
  let mockEventBus;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockLLMClient = createMockLLMClient();
    mockEventBus = createMockEventBus();
    contextManager = ContextManagerModule.factory({
      Utils: mockUtils,
      LLMClient: mockLLMClient,
      EventBus: mockEventBus
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens based on character count (~4 chars per token)', () => {
      const context = [
        { role: 'user', content: 'Hello world' } // 11 chars
      ];

      const tokens = contextManager.countTokens(context);

      // 11 chars * 0.25 = 2.75, ceil = 3
      expect(tokens).toBe(3);
    });

    it('should count tokens across multiple messages', () => {
      const context = [
        { role: 'system', content: 'You are a helpful assistant.' }, // 29 chars
        { role: 'user', content: 'Hello' }, // 5 chars
        { role: 'assistant', content: 'Hi there!' } // 9 chars
      ];
      // Total: 43 chars * 0.25 = 10.75, ceil = 11

      const tokens = contextManager.countTokens(context);

      expect(tokens).toBe(11);
    });

    it('should return 0 for empty context', () => {
      expect(contextManager.countTokens([])).toBe(0);
    });

    it('should handle messages with undefined content', () => {
      const context = [
        { role: 'user', content: undefined },
        { role: 'assistant', content: 'Hello' }
      ];

      const tokens = contextManager.countTokens(context);

      expect(tokens).toBe(2); // Only 'Hello' (5 chars) = ceil(1.25)
    });

    it('should handle messages with null content', () => {
      const context = [
        { role: 'user', content: null },
        { role: 'assistant', content: 'Test' }
      ];

      const tokens = contextManager.countTokens(context);

      expect(tokens).toBe(1); // 4 chars = 1 token
    });

    it('should use cache for repeated calls with same context', () => {
      const context = [
        { role: 'user', content: 'Hello world' }
      ];

      // First call - calculates
      const tokens1 = contextManager.countTokens(context);
      // Second call - should use cache
      const tokens2 = contextManager.countTokens(context);

      expect(tokens1).toBe(tokens2);
    });

    it('should invalidate cache when context changes', () => {
      const context = [
        { role: 'user', content: 'Hello' }
      ];

      const tokens1 = contextManager.countTokens(context);

      // Add a message
      context.push({ role: 'assistant', content: 'Hi there!' });

      const tokens2 = contextManager.countTokens(context);

      expect(tokens2).toBeGreaterThan(tokens1);
    });
  });

  describe('shouldCompact', () => {
    it('should return false for small context', () => {
      const context = [
        { role: 'user', content: 'Hello' }
      ];

      expect(contextManager.shouldCompact(context)).toBe(false);
    });

    it('should return true when tokens exceed 30000', () => {
      // Need ~120000 chars to get >30000 tokens (30000 * 4 = 120000)
      const longContent = 'x'.repeat(125000);
      const context = [
        { role: 'user', content: longContent }
      ];

      expect(contextManager.shouldCompact(context)).toBe(true);
    });

    it('should return false for context just under threshold', () => {
      // 115000 chars = ~28750 tokens (under 30000)
      const content = 'x'.repeat(115000);
      const context = [
        { role: 'user', content: content }
      ];

      expect(contextManager.shouldCompact(context)).toBe(false);
    });
  });

  describe('compact', () => {
    it('should return original context if under threshold', async () => {
      const context = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
      ];

      const result = await contextManager.compact(context, { model: 'test' });

      expect(result).toEqual(context);
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
    });

    it('should compact large context and preserve first 2 and last 8 messages', async () => {
      const longContent = 'x'.repeat(125000); // >30000 tokens threshold
      const context = [
        { role: 'system', content: 'System prompt' },          // Keep (first 2)
        { role: 'user', content: 'First user message' },       // Keep (first 2)
        { role: 'assistant', content: longContent },           // Summarize
        { role: 'user', content: 'Middle 1' },                 // Summarize
        { role: 'assistant', content: 'Middle 2' },            // Summarize
        { role: 'user', content: 'Last 8 - 1' },               // Keep (last 8)
        { role: 'assistant', content: 'Last 8 - 2' },          // Keep (last 8)
        { role: 'user', content: 'Last 8 - 3' },               // Keep (last 8)
        { role: 'assistant', content: 'Last 8 - 4' },          // Keep (last 8)
        { role: 'user', content: 'Last 8 - 5' },               // Keep (last 8)
        { role: 'assistant', content: 'Last 8 - 6' },          // Keep (last 8)
        { role: 'user', content: 'Last 8 - 7' },               // Keep (last 8)
        { role: 'assistant', content: 'Last 8 - 8' }           // Keep (last 8)
      ];

      const result = await contextManager.compact(context, { model: 'test' });

      // Should have: 2 (start) + 1 (summary) + 8 (end) = 11 messages
      expect(result.length).toBe(11);
      expect(result[0].content).toBe('System prompt');
      expect(result[1].content).toBe('First user message');
      expect(result[2].content).toContain('[CONTEXT COMPACTED');
      expect(result[result.length - 1].content).toBe('Last 8 - 8');
    });

    it('should emit context:compacted event after compaction', async () => {
      const longContent = 'x'.repeat(125000); // >30000 tokens threshold
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User' },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
        { role: 'assistant', content: 'D' },
        { role: 'user', content: 'E' },
        { role: 'assistant', content: 'F' },
        { role: 'user', content: 'G' },
        { role: 'assistant', content: 'H' }
      ];

      await contextManager.compact(context, { model: 'test' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'context:compacted',
        expect.objectContaining({
          previousTokens: expect.any(Number),
          newTokens: expect.any(Number)
        })
      );
    });

    it('should use structured extraction (no LLM) for compaction', async () => {
      // NOTE: ContextManager now uses structured extraction, not LLM summarization
      const longContent = 'x'.repeat(125000); // >30000 tokens threshold
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User' },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'Middle msg' },
        { role: 'assistant', content: 'A' },
        { role: 'user', content: 'B' },
        { role: 'assistant', content: 'C' },
        { role: 'user', content: 'D' },
        { role: 'assistant', content: 'E' },
        { role: 'user', content: 'F' },
        { role: 'assistant', content: 'G' },
        { role: 'user', content: 'H' }
      ];

      const result = await contextManager.compact(context, { model: 'test' });

      // Compaction uses structured extraction, not LLM
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
      // Result should have: 2 (start) + 1 (summary) + 8 (end) = 11 messages
      expect(result.length).toBe(11);
      expect(result[2].content).toContain('[CONTEXT COMPACTED');
    });

    it('should warn and return original if no model config provided', async () => {
      const longContent = 'x'.repeat(125000); // >30000 tokens threshold
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: longContent }
      ];

      const result = await contextManager.compact(context, null);

      expect(result).toEqual(context);
      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No model config')
      );
    });

    it('should not compact if middle section is empty', async () => {
      const longContent = 'x'.repeat(65000); // ~16250 tokens each, total >30000 threshold
      const context = [
        { role: 'system', content: longContent },     // First 2
        { role: 'user', content: longContent },       // First 2
        { role: 'assistant', content: 'A' },          // Last 8
        { role: 'user', content: 'B' },               // Last 8
        { role: 'assistant', content: 'C' },          // Last 8
        { role: 'user', content: 'D' },               // Last 8
        { role: 'assistant', content: 'E' },          // Last 8
        { role: 'user', content: 'F' },               // Last 8
        { role: 'assistant', content: 'G' },          // Last 8
        { role: 'user', content: 'H' }                // Last 8
      ];

      // With 10 messages: first 2 + last 8 = 10, middle is empty
      const result = await contextManager.compact(context, { model: 'test' });

      expect(result).toEqual(context);
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
    });
  });

  describe('emitTokens', () => {
    it('should emit token count with limit info via EventBus', () => {
      const context = [
        { role: 'user', content: 'Hello world' }
      ];

      const tokens = contextManager.emitTokens(context);

      // emitTokens now includes exceeded flag and limit
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:tokens', {
        tokens: 3,
        exceeded: false,
        limit: 120000  // MAX_CONTEXT_TOKENS
      });
      expect(tokens).toBe(3);
    });

    it('should handle missing EventBus gracefully', () => {
      const managerNoEventBus = ContextManagerModule.factory({
        Utils: mockUtils,
        LLMClient: mockLLMClient,
        EventBus: null
      });

      const context = [{ role: 'user', content: 'Hello' }];

      // Should not throw
      expect(() => managerNoEventBus.emitTokens(context)).not.toThrow();
    });
  });

  describe('invalidateTokenCache', () => {
    it('should invalidate the token cache', () => {
      const context = [
        { role: 'user', content: 'Hello world' }
      ];

      // First call - populates cache
      const tokens1 = contextManager.countTokens(context);

      // Manually modify content (simulating external change)
      context[0].content = 'Hello world extended content';

      // Without invalidation, cache would return old value
      // But since we changed content length, the cache check should detect it
      const tokens2 = contextManager.countTokens(context);

      expect(tokens2).toBeGreaterThan(tokens1);
    });

    it('should be exported from the module', () => {
      expect(typeof contextManager.invalidateTokenCache).toBe('function');
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ContextManagerModule.metadata.id).toBe('ContextManager');
      expect(ContextManagerModule.metadata.type).toBe('service');
      expect(ContextManagerModule.metadata.dependencies).toContain('Utils');
      expect(ContextManagerModule.metadata.dependencies).toContain('LLMClient');
      expect(ContextManagerModule.metadata.dependencies).toContain('EventBus');
    });
  });
});
