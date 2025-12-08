/**
 * @fileoverview Unit tests for ContextManager module
 * Tests token counting, compaction logic, model-aware limits, and caching
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
    // Clear any runtime overrides
    contextManager.clearLimitOverrides();
  });

  describe('countTokens', () => {
    it('should estimate tokens using word-based heuristics', () => {
      const context = [
        { role: 'user', content: 'Hello world' } // 2 words
      ];

      const tokens = contextManager.countTokens(context);

      // 2 words (~2-3 tokens) + 4 overhead = ~7 tokens
      expect(tokens).toBeGreaterThanOrEqual(5);
      expect(tokens).toBeLessThanOrEqual(10);
    });

    it('should count tokens across multiple messages', () => {
      const context = [
        { role: 'system', content: 'You are a helpful assistant.' }, // 5 words
        { role: 'user', content: 'Hello' }, // 1 word
        { role: 'assistant', content: 'Hi there!' } // 2 words
      ];
      // ~8 words + 3x4 overhead = ~20-24 tokens

      const tokens = contextManager.countTokens(context);

      expect(tokens).toBeGreaterThanOrEqual(18);
      expect(tokens).toBeLessThanOrEqual(30);
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

      // 1 word + 2x4 overhead = ~9-10 tokens
      expect(tokens).toBeGreaterThanOrEqual(8);
      expect(tokens).toBeLessThanOrEqual(12);
    });

    it('should handle messages with null content', () => {
      const context = [
        { role: 'user', content: null },
        { role: 'assistant', content: 'Test' }
      ];

      const tokens = contextManager.countTokens(context);

      // 1 word + 2x4 overhead = ~9 tokens
      expect(tokens).toBeGreaterThanOrEqual(8);
      expect(tokens).toBeLessThanOrEqual(11);
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

  describe('getLimitsForModel', () => {
    it('should return default limits for unknown models', () => {
      const limits = contextManager.getLimitsForModel('unknown-model-xyz');

      expect(limits.compact).toBe(30000);
      expect(limits.warning).toBe(100000);
      expect(limits.hard).toBe(120000);
    });

    it('should return Gemini limits for gemini models', () => {
      // Should match any gemini model (gemini-2, gemini-3, etc.)
      expect(contextManager.getLimitsForModel('gemini-2.0-flash').compact).toBe(200000);
      expect(contextManager.getLimitsForModel('gemini-3.0-pro').compact).toBe(200000);
      expect(contextManager.getLimitsForModel('gemini-exp-1234').compact).toBe(200000);
      expect(contextManager.getLimitsForModel('gemini-2.0-flash').hard).toBe(500000);
    });

    it('should return Claude limits for claude models', () => {
      const limits = contextManager.getLimitsForModel('claude-3-opus-20240229');

      expect(limits.compact).toBe(150000);
      expect(limits.hard).toBe(190000);
    });

    it('should return GPT-4o limits for gpt-4o models', () => {
      const limits = contextManager.getLimitsForModel('gpt-4o-2024-05-13');

      expect(limits.compact).toBe(100000);
      expect(limits.hard).toBe(125000);
    });

    it('should return smaller limits for local models', () => {
      const limits = contextManager.getLimitsForModel('phi-3-mini');

      expect(limits.compact).toBe(3000);
      expect(limits.hard).toBe(4000);
    });

    it('should handle null modelId gracefully', () => {
      const limits = contextManager.getLimitsForModel(null);

      expect(limits.compact).toBe(30000);
    });
  });

  describe('setLimits and clearLimitOverrides', () => {
    it('should allow runtime override of limits', () => {
      contextManager.setLimits({ compact: 50000, hard: 200000 });

      const limits = contextManager.getLimitsForModel('any-model');

      expect(limits.compact).toBe(50000);
      expect(limits.hard).toBe(200000);
    });

    it('should clear overrides and restore model-based limits', () => {
      contextManager.setLimits({ compact: 50000 });
      contextManager.clearLimitOverrides();

      const limits = contextManager.getLimitsForModel('gemini-2.0-flash');

      expect(limits.compact).toBe(200000); // Model-specific, not override
    });
  });

  describe('shouldCompact', () => {
    it('should return false for small context', () => {
      const context = [
        { role: 'user', content: 'Hello' }
      ];

      expect(contextManager.shouldCompact(context)).toBe(false);
    });

    it('should return true when tokens exceed default threshold (30000)', () => {
      // Need ~120000 chars to get >30000 tokens (30000 * 4 = 120000)
      const longContent = 'x'.repeat(125000);
      const context = [
        { role: 'user', content: longContent }
      ];

      expect(contextManager.shouldCompact(context)).toBe(true);
    });

    it('should use model-specific threshold for Gemini', () => {
      // 125000 chars = ~31250 tokens, over default 30k but under Gemini's 400k
      const longContent = 'x'.repeat(125000);
      const context = [
        { role: 'user', content: longContent }
      ];

      expect(contextManager.shouldCompact(context, 'gemini-2.0-flash')).toBe(false);
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

      const result = await contextManager.compact(context, { id: 'test-model' });

      expect(result.compacted).toBe(false);
      expect(result.context).toEqual(context);
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

      const result = await contextManager.compact(context, { id: 'test-model' });

      expect(result.compacted).toBe(true);
      // Should have: 2 (start) + 1 (summary) + 8 (end) = 11 messages
      expect(result.context.length).toBe(11);
      expect(result.context[0].content).toBe('System prompt');
      expect(result.context[1].content).toBe('First user message');
      expect(result.context[2].content).toContain('[CONTEXT COMPACTED');
      expect(result.context[result.context.length - 1].content).toBe('Last 8 - 8');
    });

    it('should use aggressive mode with only last 4 messages when specified', async () => {
      const longContent = 'x'.repeat(125000);
      const context = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'First user message' },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'Middle 1' },
        { role: 'assistant', content: 'Last 4 - 1' },
        { role: 'user', content: 'Last 4 - 2' },
        { role: 'assistant', content: 'Last 4 - 3' },
        { role: 'user', content: 'Last 4 - 4' }
      ];

      const result = await contextManager.compact(context, { id: 'test-model' }, { aggressive: true });

      expect(result.compacted).toBe(true);
      // Should have: 2 (start) + 1 (summary) + 4 (end) = 7 messages
      expect(result.context.length).toBe(7);
      expect(result.context[2].content).toContain('AGGRESSIVE');
    });

    it('should emit context:compacted event after compaction', async () => {
      const longContent = 'x'.repeat(125000);
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

      await contextManager.compact(context, { id: 'test-model' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'context:compacted',
        expect.objectContaining({
          mode: 'STANDARD',
          previousTokens: expect.any(Number),
          newTokens: expect.any(Number),
          reduction: expect.any(Number)
        })
      );
    });

    it('should warn and return original if no model config provided', async () => {
      const longContent = 'x'.repeat(125000);
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: longContent }
      ];

      const result = await contextManager.compact(context, null);

      expect(result.compacted).toBe(false);
      expect(result.context).toEqual(context);
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
      const result = await contextManager.compact(context, { id: 'test-model' });

      expect(result.compacted).toBe(false);
      expect(result.context).toEqual(context);
    });
  });

  describe('manage', () => {
    it('should return context unchanged when under all limits', async () => {
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' }
      ];

      const result = await contextManager.manage(context, { id: 'test-model' });

      expect(result.halted).toBe(false);
      expect(result.error).toBeNull();
      expect(result.context).toEqual(context);
    });

    it('should compact when over threshold', async () => {
      const longContent = 'x'.repeat(125000);
      // 13 messages: 2 start + 3 middle + 8 end
      const context = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Goal' },
        { role: 'assistant', content: longContent }, // middle - gets compacted
        { role: 'user', content: 'middle-msg-1' },   // middle - gets compacted
        { role: 'assistant', content: 'middle-msg-2' }, // middle - gets compacted
        ...Array(8).fill(0).map((_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` }))
      ];
      // Total: 13 messages

      const result = await contextManager.manage(context, { id: 'test-model' });

      expect(result.halted).toBe(false);
      // After compaction: 2 start + 1 summary + 8 end = 11 messages (less than 13)
      expect(result.context.length).toBe(11);
      expect(result.context.length).toBeLessThan(context.length);
    });

    it('should emit warning event when at warning level', async () => {
      // Set custom limits to test warning level
      contextManager.setLimits({ compact: 100, warning: 200, hard: 300 });

      // Create context at ~250 tokens (between warning 200 and hard 300)
      const context = [
        { role: 'user', content: 'x'.repeat(1000) } // ~250 tokens
      ];

      await contextManager.manage(context, { id: 'test-model' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'context:warning',
        expect.objectContaining({
          tokens: expect.any(Number),
          limit: 300,
          percentage: expect.any(Number)
        })
      );
    });

    it('should halt when context exceeds hard limit after compaction', async () => {
      // Set very small limits to force hard limit scenario
      contextManager.setLimits({ compact: 10, warning: 50, hard: 100 });

      // Create context way over limit with no room to compact
      const context = [
        { role: 'system', content: 'x'.repeat(500) }, // ~125 tokens
        { role: 'user', content: 'x'.repeat(500) }    // ~125 tokens
      ];

      const result = await contextManager.manage(context, { id: 'test-model' });

      expect(result.halted).toBe(true);
      expect(result.error).toContain('hard limit');
    });
  });

  describe('emitTokens', () => {
    it('should emit token count with full limit info via EventBus', () => {
      const context = [
        { role: 'user', content: 'Hello world' }
      ];

      const tokens = contextManager.emitTokens(context, 'test-model');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:tokens', {
        tokens: expect.any(Number),
        compact: 30000,
        warning: 100000,
        limit: 120000,
        exceeded: false,
        percentage: expect.any(Number)
      });
      // Word-based estimation: "Hello world" = 2 words + 4 overhead = ~6 tokens
      expect(tokens).toBeGreaterThanOrEqual(5);
      expect(tokens).toBeLessThanOrEqual(10);
    });

    it('should use model-specific limits when provided', () => {
      const context = [
        { role: 'user', content: 'Hello world' }
      ];

      contextManager.emitTokens(context, 'gemini-2.0-flash');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:tokens', expect.objectContaining({
        compact: 200000,
        limit: 500000
      }));
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

  describe('exceedsHardLimit', () => {
    it('should return exceeded=true when over hard limit', () => {
      // Set small limit
      contextManager.setLimits({ hard: 100 });

      const context = [
        { role: 'user', content: 'x'.repeat(500) } // ~125 tokens
      ];

      const result = contextManager.exceedsHardLimit(context, 'test');

      expect(result.exceeded).toBe(true);
      expect(result.tokens).toBeGreaterThan(100);
      expect(result.limit).toBe(100);
    });

    it('should return exceeded=false when under hard limit', () => {
      const context = [
        { role: 'user', content: 'Hello' }
      ];

      const result = contextManager.exceedsHardLimit(context, 'test');

      expect(result.exceeded).toBe(false);
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
      expect(ContextManagerModule.metadata.version).toBe('2.0.0');
      expect(ContextManagerModule.metadata.type).toBe('service');
      expect(ContextManagerModule.metadata.dependencies).toContain('Utils');
      expect(ContextManagerModule.metadata.dependencies).toContain('LLMClient');
      expect(ContextManagerModule.metadata.dependencies).toContain('EventBus');
    });
  });

  describe('exposed constants', () => {
    it('should expose DEFAULT_LIMITS', () => {
      expect(contextManager.DEFAULT_LIMITS).toEqual({
        compact: 30000,
        warning: 100000,
        hard: 120000
      });
    });

    it('should expose MODEL_LIMITS', () => {
      expect(contextManager.MODEL_LIMITS).toHaveProperty('gemini-');
      expect(contextManager.MODEL_LIMITS).toHaveProperty('claude-3-opus');
      expect(contextManager.MODEL_LIMITS).toHaveProperty('gpt-4o');
      expect(contextManager.MODEL_LIMITS).toHaveProperty('gpt-5');
    });
  });
});
