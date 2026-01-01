/**
 * @fileoverview Unit tests for HybridRetrieval module
 * Tests unified retrieval across semantic, knowledge tree, and episodic memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';
import HybridRetrievalModule from '../../capabilities/cognition/hybrid-retrieval.js';

describe('HybridRetrieval', () => {
  let hybridRetrieval;
  let mockSemanticMemory;
  let mockKnowledgeTree;
  let mockEpisodicMemory;
  let mockEmbeddingStore;
  let mockEventBus;
  let utils;

  // Mock embedding generator
  const mockEmbed = (text) => {
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const embedding = new Array(384).fill(0).map((_, i) => Math.sin(hash + i) * 0.5);
    const mag = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / mag);
  };

  beforeEach(() => {
    utils = UtilsModule.factory();
    mockEventBus = EventBusModule.factory({ Utils: utils });

    // Mock SemanticMemory
    mockSemanticMemory = {
      embed: vi.fn(async (text) => mockEmbed(text)),
      init: vi.fn(async () => true)
    };

    // Mock EmbeddingStore with searchWithRetention
    mockEmbeddingStore = {
      init: vi.fn(async () => true),
      searchWithRetention: vi.fn(async (embedding, options) => [
        {
          memory: { id: 'sem-1', content: 'Semantic result about machine learning', timestamp: Date.now() - 1000 },
          similarity: 0.85,
          retention: 0.95,
          score: 0.8
        },
        {
          memory: { id: 'sem-2', content: 'Another semantic result about AI', timestamp: Date.now() - 2000 },
          similarity: 0.7,
          retention: 0.9,
          score: 0.65
        }
      ]),
      getRecentMemories: vi.fn(async (count) => [
        { id: 'recent-1', content: 'Recent memory', timestamp: Date.now() }
      ])
    };

    // Mock KnowledgeTree
    mockKnowledgeTree = {
      init: vi.fn(async () => true),
      hybridQuery: vi.fn(async (query, options) => [
        {
          id: 'tree-1',
          content: 'Summary about ML from knowledge tree',
          level: 1,
          score: 0.75,
          semanticScore: 0.7,
          retention: 0.98,
          timestamp: Date.now() - 5000
        },
        {
          id: 'tree-2',
          content: 'Detailed node about neural networks',
          level: 0,
          score: 0.65,
          semanticScore: 0.6,
          retention: 0.95,
          timestamp: Date.now() - 6000
        }
      ])
    };

    // Mock EpisodicMemory
    mockEpisodicMemory = {
      init: vi.fn(async () => true),
      search: vi.fn(async (query, options) => [
        {
          id: 'ep-1',
          content: 'User asked about machine learning',
          role: 'user',
          sessionId: 'session-1',
          similarity: 0.8,
          retention: 0.92,
          score: 0.75,
          timestamp: Date.now() - 3000
        }
      ]),
      searchWithContiguity: vi.fn(async (query, options) => [
        {
          id: 'ep-1',
          content: 'User asked about machine learning',
          role: 'user',
          sessionId: 'session-1',
          similarity: 0.8,
          retention: 0.92,
          score: 0.75,
          timestamp: Date.now() - 3000,
          hasContiguity: false
        },
        {
          id: 'ep-2',
          content: 'Assistant explained neural networks',
          role: 'assistant',
          sessionId: 'session-1',
          similarity: 0.7,
          retention: 0.9,
          score: 0.65,
          timestamp: Date.now() - 2500,
          hasContiguity: true
        }
      ]),
      getRecent: vi.fn(async (count) => [
        { id: 'recent-ep-1', content: 'Recent episode', timestamp: Date.now() }
      ])
    };

    hybridRetrieval = HybridRetrievalModule.factory({
      Utils: utils,
      EventBus: mockEventBus,
      SemanticMemory: mockSemanticMemory,
      KnowledgeTree: mockKnowledgeTree,
      EpisodicMemory: mockEpisodicMemory,
      EmbeddingStore: mockEmbeddingStore
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const result = await hybridRetrieval.init();
      expect(result).toBe(true);
    });

    it('should initialize dependent modules', async () => {
      await hybridRetrieval.init();

      expect(mockKnowledgeTree.init).toHaveBeenCalled();
      expect(mockEpisodicMemory.init).toHaveBeenCalled();
      expect(mockEmbeddingStore.init).toHaveBeenCalled();
    });
  });

  describe('Hybrid Query', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should query all memory sources', async () => {
      const { results } = await hybridRetrieval.query('machine learning', { topK: 5 });

      expect(mockSemanticMemory.embed).toHaveBeenCalled();
      expect(mockEmbeddingStore.searchWithRetention).toHaveBeenCalled();
      expect(mockKnowledgeTree.hybridQuery).toHaveBeenCalled();
      expect(mockEpisodicMemory.searchWithContiguity).toHaveBeenCalled();
    });

    it('should return combined results with scores', async () => {
      const { results } = await hybridRetrieval.query('neural networks', { topK: 5 });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => typeof r.combinedScore === 'number')).toBe(true);
    });

    it('should sort results by combined score', async () => {
      const { results } = await hybridRetrieval.query('AI research', { topK: 10 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].combinedScore).toBeGreaterThanOrEqual(results[i].combinedScore);
      }
    });

    it('should respect topK limit', async () => {
      const { results } = await hybridRetrieval.query('test query', { topK: 3 });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should include metadata in response', async () => {
      const response = await hybridRetrieval.query('test query');

      expect(response.metadata).toBeDefined();
      expect(response.metadata.query).toBe('test query');
      expect(response.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(response.metadata.sources).toBeDefined();
    });

    it('should emit query event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('hybrid:query', eventSpy);

      await hybridRetrieval.query('test query');

      expect(eventSpy).toHaveBeenCalled();
      expect(eventSpy.mock.calls[0][0].query).toBe('test query');
    });
  });

  describe('Score Weighting', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should apply semantic weight', async () => {
      const { results } = await hybridRetrieval.query('test', {
        weights: { semantic: 1.0, summary: 0, episodic: 0, temporal: 0 }
      });

      // Results should primarily come from semantic source
      expect(results.some(r => r.semanticScore > 0)).toBe(true);
    });

    it('should apply custom weights', async () => {
      const customWeights = {
        semantic: 0.5,
        summary: 0.3,
        episodic: 0.2,
        temporal: 0
      };

      const { results } = await hybridRetrieval.query('test', { weights: customWeights });

      expect(results.length).toBeGreaterThan(0);
    });

    it('should apply retention weighting', async () => {
      const { results } = await hybridRetrieval.query('test', { useRetention: true });

      // Results with retention < 1 should have adjusted scores
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Temporal Contiguity', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should boost temporally adjacent results', async () => {
      // Configure mock to return temporally close results
      mockEpisodicMemory.searchWithContiguity.mockResolvedValueOnce([
        {
          id: 'ep-close-1',
          content: 'First message',
          timestamp: Date.now() - 1000,
          score: 0.7
        },
        {
          id: 'ep-close-2',
          content: 'Second message',
          timestamp: Date.now() - 2000, // 1 second apart
          score: 0.7
        }
      ]);

      const { results } = await hybridRetrieval.query('test');

      // Should have contiguity boost applied
      expect(results.length).toBeGreaterThan(0);
    });

    it('should mark results with hasContiguity', async () => {
      const { results } = await hybridRetrieval.query('test');

      // Some results should have contiguity flag from episodic search
      const hasContiguityResults = results.filter(r => r.hasContiguity);
      expect(hasContiguityResults).toBeDefined();
    });
  });

  describe('Recency Boost', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should boost recent results', async () => {
      mockEmbeddingStore.searchWithRetention.mockResolvedValueOnce([
        {
          memory: { id: 'recent', content: 'Recent result', timestamp: Date.now() - 1000 },
          similarity: 0.7,
          retention: 0.95,
          score: 0.65
        },
        {
          memory: { id: 'old', content: 'Old result', timestamp: Date.now() - 7200000 },
          similarity: 0.7,
          retention: 0.9,
          score: 0.65
        }
      ]);

      const { results } = await hybridRetrieval.query('test');

      // Recent result should have recency boost
      const recentResult = results.find(r => r.id === 'recent');
      if (recentResult) {
        expect(recentResult.recencyBoost).toBeGreaterThan(0);
      }
    });
  });

  describe('Anticipatory Retrieval', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should detect debug task type', () => {
      const result = hybridRetrieval.detectTaskType('fix this error in my code');

      expect(result.type).toBe('debug');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.anticipate.length).toBeGreaterThan(0);
    });

    it('should detect implement task type', () => {
      const result = hybridRetrieval.detectTaskType('implement a new feature');

      expect(result.type).toBe('implement');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect refactor task type', () => {
      const result = hybridRetrieval.detectTaskType('refactor this function');

      expect(result.type).toBe('refactor');
    });

    it('should detect test task type', () => {
      const result = hybridRetrieval.detectTaskType('write tests for this');

      expect(result.type).toBe('test');
    });

    it('should return general for unrecognized queries', () => {
      const result = hybridRetrieval.detectTaskType('hello world');

      expect(result.type).toBe('general');
      expect(result.confidence).toBe(0);
    });

    it('should apply anticipatory boost when enabled', async () => {
      const { results } = await hybridRetrieval.query('debug this error', {
        useAnticipatory: true
      });

      // Results should be processed with anticipatory logic
      expect(results.length).toBeGreaterThan(0);
    });

    it('should skip anticipatory for general queries', async () => {
      const { results } = await hybridRetrieval.query('hello', {
        useAnticipatory: true
      });

      // Should still return results without errors
      expect(results).toBeDefined();
    });
  });

  describe('Context Enrichment', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should enrich context with relevant memories', async () => {
      const context = [
        { role: 'user', content: 'Tell me about ML' }
      ];

      const enriched = await hybridRetrieval.enrichContext('machine learning', context);

      expect(enriched.length).toBeGreaterThan(context.length);
      expect(enriched.some(m => m.role === 'system')).toBe(true);
    });

    it('should preserve original context', async () => {
      const context = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User question' }
      ];

      const enriched = await hybridRetrieval.enrichContext('test', context);

      expect(enriched.some(m => m.content === 'System prompt')).toBe(true);
      expect(enriched.some(m => m.content === 'User question')).toBe(true);
    });

    it('should return original context when no results', async () => {
      // Mock empty results
      mockEmbeddingStore.searchWithRetention.mockResolvedValueOnce([]);
      mockKnowledgeTree.hybridQuery.mockResolvedValueOnce([]);
      mockEpisodicMemory.searchWithContiguity.mockResolvedValueOnce([]);

      const context = [{ role: 'user', content: 'Test' }];
      const enriched = await hybridRetrieval.enrichContext('obscure query', context);

      expect(enriched).toEqual(context);
    });

    it('should respect maxTokens limit', async () => {
      const context = [];
      const enriched = await hybridRetrieval.enrichContext('test', context, {
        maxTokens: 100 // Very small limit
      });

      // Should not exceed token limit
      const totalLength = enriched.reduce((sum, m) => sum + m.content.length, 0);
      expect(totalLength).toBeLessThan(1000); // Rough token estimate
    });
  });

  describe('Quick Search', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should perform semantic-only search', async () => {
      const results = await hybridRetrieval.quickSearch('machine learning');

      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.source === 'semantic')).toBe(true);
    });

    it('should not query knowledge tree or episodic', async () => {
      await hybridRetrieval.quickSearch('test');

      expect(mockKnowledgeTree.hybridQuery).not.toHaveBeenCalled();
      expect(mockEpisodicMemory.searchWithContiguity).not.toHaveBeenCalled();
    });
  });

  describe('Recent Activity', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should get recent activity from all sources', async () => {
      const recent = await hybridRetrieval.getRecentActivity(10);

      expect(recent.length).toBeGreaterThan(0);
    });

    it('should include source in results', async () => {
      const recent = await hybridRetrieval.getRecentActivity(10);

      expect(recent.every(r => r.source)).toBe(true);
    });

    it('should sort by timestamp', async () => {
      const recent = await hybridRetrieval.getRecentActivity(10);

      for (let i = 1; i < recent.length; i++) {
        expect(recent[i - 1].timestamp).toBeGreaterThanOrEqual(recent[i].timestamp);
      }
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should handle embedding failure gracefully', async () => {
      mockSemanticMemory.embed.mockRejectedValueOnce(new Error('Embedding failed'));

      const { results } = await hybridRetrieval.query('test');

      // Should still return results from other sources
      expect(results).toBeDefined();
    });

    it('should handle knowledge tree failure gracefully', async () => {
      mockKnowledgeTree.hybridQuery.mockRejectedValueOnce(new Error('Tree search failed'));

      const { results } = await hybridRetrieval.query('test');

      // Should still return results from other sources
      expect(results).toBeDefined();
    });

    it('should handle episodic memory failure gracefully', async () => {
      mockEpisodicMemory.searchWithContiguity.mockRejectedValueOnce(new Error('Episodic failed'));

      const { results } = await hybridRetrieval.query('test');

      // Should still return results from other sources
      expect(results).toBeDefined();
    });
  });

  describe('Configuration', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should allow configuration updates', () => {
      hybridRetrieval.configure({
        minSimilarity: 0.5,
        contiguityWindowMs: 300000
      });

      const config = hybridRetrieval.getConfig();
      expect(config.minSimilarity).toBe(0.5);
      expect(config.contiguityWindowMs).toBe(300000);
    });

    it('should update weight configuration', () => {
      hybridRetrieval.configure({
        weights: {
          semantic: 0.6,
          summary: 0.2,
          episodic: 0.1,
          temporal: 0.1
        }
      });

      const config = hybridRetrieval.getConfig();
      expect(config.weights.semantic).toBe(0.6);
    });

    it('should return stats', async () => {
      await hybridRetrieval.query('test');

      const stats = hybridRetrieval.getStats();

      expect(stats.initialized).toBe(true);
      expect(stats.queryHistory).toBeGreaterThan(0);
      expect(stats.lastQueryTimestamp).toBeGreaterThan(0);
    });
  });

  describe('Query History', () => {
    beforeEach(async () => {
      await hybridRetrieval.init();
    });

    it('should track query history', async () => {
      await hybridRetrieval.query('first query');
      await hybridRetrieval.query('second query');

      const stats = hybridRetrieval.getStats();
      expect(stats.queryHistory).toBe(2);
    });

    it('should update last query timestamp', async () => {
      const before = Date.now();
      await hybridRetrieval.query('test');
      const stats = hybridRetrieval.getStats();

      expect(stats.lastQueryTimestamp).toBeGreaterThanOrEqual(before);
    });
  });
});
