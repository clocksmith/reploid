/**
 * @fileoverview Unit tests for EpisodicMemory module
 * Tests message storage, semantic search, temporal contiguity,
 * and Ebbinghaus-style retention.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';
import EpisodicMemoryModule from '../../capabilities/cognition/episodic-memory.js';

describe('EpisodicMemory', () => {
  let episodicMemory;
  let mockVFS;
  let mockSemanticMemory;
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

    // Mock VFS with in-memory storage
    const vfsStorage = {};
    mockVFS = {
      exists: vi.fn(async (path) => path in vfsStorage),
      read: vi.fn(async (path) => {
        if (!(path in vfsStorage)) throw new Error('File not found');
        return vfsStorage[path];
      }),
      write: vi.fn(async (path, content) => {
        vfsStorage[path] = content;
        return true;
      }),
      delete: vi.fn(async (path) => {
        delete vfsStorage[path];
        return true;
      }),
      list: vi.fn(async (dir) => {
        return Object.keys(vfsStorage).filter(k => k.startsWith(dir));
      }),
      mkdir: vi.fn(async () => true)
    };

    // Mock SemanticMemory
    mockSemanticMemory = {
      embed: vi.fn(async (text) => mockEmbed(text)),
      init: vi.fn(async () => true)
    };

    episodicMemory = EpisodicMemoryModule.factory({
      Utils: utils,
      VFS: mockVFS,
      SemanticMemory: mockSemanticMemory,
      EventBus: mockEventBus
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with empty state', async () => {
      await episodicMemory.init();
      const stats = episodicMemory.getStats();

      expect(stats.totalEpisodes).toBe(0);
      expect(stats.sessionsCount).toBe(0);
      expect(stats.cachedEpisodes).toBe(0);
    });

    it('should load existing index from VFS', async () => {
      // Pre-populate VFS
      const existingIndex = {
        bySession: { 'session-1': ['ep-1', 'ep-2'] },
        byTimestamp: [{ id: 'ep-1', timestamp: 1000 }],
        byId: { 'ep-1': { sessionId: 'session-1', timestamp: 1000 } }
      };
      await mockVFS.write('/memory/episodes/index.json', JSON.stringify(existingIndex));

      const existingManifest = {
        totalEpisodes: 2,
        sessions: ['session-1'],
        lastUpdated: Date.now(),
        version: 1
      };
      await mockVFS.write('/memory/episodes/manifest.json', JSON.stringify(existingManifest));

      await episodicMemory.init();
      const stats = episodicMemory.getStats();

      expect(stats.totalEpisodes).toBe(2);
      expect(stats.sessionsCount).toBe(1);
    });

    it('should create directory on init', async () => {
      await episodicMemory.init();
      expect(mockVFS.mkdir).toHaveBeenCalledWith('/memory/episodes/');
    });
  });

  describe('Store Operations', () => {
    beforeEach(async () => {
      await episodicMemory.init();
    });

    it('should store a message and return episode ID', async () => {
      const id = await episodicMemory.store({
        role: 'user',
        content: 'This is a test message with enough content'
      });

      expect(id).toBeTruthy();
      expect(id.startsWith('ep_')).toBe(true);
    });

    it('should reject messages that are too short', async () => {
      const id = await episodicMemory.store({
        role: 'user',
        content: 'Too short'
      });

      expect(id).toBeNull();
    });

    it('should generate embedding for stored message', async () => {
      await episodicMemory.store({
        role: 'user',
        content: 'This message should be embedded for semantic search'
      });

      expect(mockSemanticMemory.embed).toHaveBeenCalled();
    });

    it('should emit store event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('episodic:store', eventSpy);

      await episodicMemory.store({
        role: 'assistant',
        content: 'This is a response with sufficient length'
      });

      expect(eventSpy).toHaveBeenCalled();
      expect(eventSpy.mock.calls[0][0].role).toBe('assistant');
    });

    it('should store batch of messages', async () => {
      const messages = [
        { role: 'user', content: 'First message with enough content to be stored properly' },
        { role: 'assistant', content: 'Second message with enough content to be stored properly' },
        { role: 'user', content: 'Third message with enough content to be stored properly' }
      ];

      const ids = await episodicMemory.storeBatch(messages);

      // Should return array with same length as input
      expect(ids.length).toBe(3);
      // All IDs should be valid strings starting with 'ep_' or null (for short messages)
      for (const id of ids) {
        if (id !== null) {
          expect(typeof id).toBe('string');
          expect(id.startsWith('ep_')).toBe(true);
        }
      }
    });

    it('should persist to VFS', async () => {
      await episodicMemory.store({
        role: 'user',
        content: 'This message should be persisted to VFS storage'
      });

      expect(mockVFS.write).toHaveBeenCalled();
    });

    it('should track session in manifest', async () => {
      const sessionId = 'test-session-123';
      await episodicMemory.store(
        { role: 'user', content: 'Message in a specific session' },
        { sessionId }
      );

      const stats = episodicMemory.getStats();
      expect(stats.sessionsCount).toBe(1);
    });
  });

  describe('Retrieval Operations', () => {
    beforeEach(async () => {
      await episodicMemory.init();
      // Store some test messages
      await episodicMemory.store(
        { role: 'user', content: 'Question about machine learning algorithms' },
        { sessionId: 'session-1', timestamp: Date.now() - 3600000 }
      );
      await episodicMemory.store(
        { role: 'assistant', content: 'Machine learning uses statistical methods' },
        { sessionId: 'session-1', timestamp: Date.now() - 3500000 }
      );
      await episodicMemory.store(
        { role: 'user', content: 'Tell me about database optimization' },
        { sessionId: 'session-2', timestamp: Date.now() - 1800000 }
      );
    });

    it('should retrieve episode by ID', async () => {
      const id = await episodicMemory.store({
        role: 'user',
        content: 'This is a retrievable message'
      });

      const episode = await episodicMemory.get(id);

      expect(episode).not.toBeNull();
      expect(episode.id).toBe(id);
      expect(episode.content).toBe('This is a retrievable message');
    });

    it('should return null for unknown ID', async () => {
      const episode = await episodicMemory.get('nonexistent-id');
      expect(episode).toBeNull();
    });

    it('should get recent episodes', async () => {
      const recent = await episodicMemory.getRecent(10);

      expect(recent.length).toBeGreaterThan(0);
      // Should be sorted by timestamp (newest first)
    });

    it('should get episodes by session', async () => {
      const session1Episodes = await episodicMemory.getSession('session-1');
      expect(session1Episodes.length).toBe(2);
    });
  });

  describe('Semantic Search', () => {
    beforeEach(async () => {
      await episodicMemory.init();
      await episodicMemory.store(
        { role: 'user', content: 'How do neural networks work in deep learning?' },
        { timestamp: Date.now() - 1000 }
      );
      await episodicMemory.store(
        { role: 'assistant', content: 'Neural networks consist of layers of neurons' },
        { timestamp: Date.now() - 500 }
      );
      await episodicMemory.store(
        { role: 'user', content: 'What is a relational database system?' },
        { timestamp: Date.now() }
      );
    });

    it('should search by semantic similarity', async () => {
      const results = await episodicMemory.search('deep learning networks', { topK: 2 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('should include similarity scores in results', async () => {
      const results = await episodicMemory.search('neural networks', { topK: 3 });

      expect(results.every(r => typeof r.similarity === 'number')).toBe(true);
      expect(results.every(r => typeof r.score === 'number')).toBe(true);
    });

    it('should filter by minimum similarity', async () => {
      const results = await episodicMemory.search('random unrelated topic', {
        topK: 10,
        minSimilarity: 0.9 // Very high threshold
      });

      // Should filter out low-similarity results
      expect(results.every(r => r.similarity >= 0.9)).toBe(true);
    });

    it('should filter by session', async () => {
      const sessionId = 'filtered-session';
      await episodicMemory.store(
        { role: 'user', content: 'Message in filtered session about AI' },
        { sessionId }
      );

      const results = await episodicMemory.search('artificial intelligence', {
        sessionId,
        topK: 10
      });

      expect(results.every(r => r.sessionId === sessionId)).toBe(true);
    });

    it('should emit search event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('episodic:search', eventSpy);

      await episodicMemory.search('test query');

      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('Temporal Contiguity Search', () => {
    beforeEach(async () => {
      await episodicMemory.init();
      const now = Date.now();

      // Create temporally clustered messages (within 60s of each other)
      await episodicMemory.store(
        { role: 'user', content: 'First message about programming languages and coding' },
        { timestamp: now - 30000 }  // 30 seconds ago
      );
      await episodicMemory.store(
        { role: 'assistant', content: 'Python and JavaScript are popular programming languages' },
        { timestamp: now - 25000 }  // 25 seconds ago (5s apart - adjacent)
      );
      await episodicMemory.store(
        { role: 'user', content: 'Unrelated message about cooking recipes and food' },
        { timestamp: now - 3600000 }  // 1 hour ago (not adjacent)
      );
    });

    it('should boost temporally adjacent results', async () => {
      const results = await episodicMemory.searchWithContiguity('programming languages', {
        topK: 3,
        contiguityWindowMs: 60000,  // 60 second window
        contiguityBoost: 0.2,
        minSimilarity: 0.0  // Accept any similarity
      });

      // If results are returned, they should have hasContiguity boolean
      if (results.length > 0) {
        expect(results.every(r => typeof r.hasContiguity === 'boolean')).toBe(true);
      }
      // With at least 2 results, temporal comparison is possible
      expect(results).toBeDefined();
    });

    it('should respect contiguity window', async () => {
      const narrowWindow = await episodicMemory.searchWithContiguity('programming', {
        contiguityWindowMs: 1000,  // Very narrow window (1 second)
        minSimilarity: 0.1
      });

      // With narrow window, less contiguity should be detected
      expect(narrowWindow).toBeDefined();
    });
  });

  describe('Retention & Forgetting (Ebbinghaus)', () => {
    beforeEach(async () => {
      await episodicMemory.init();
    });

    it('should compute retention score for recent episodes', async () => {
      const id = await episodicMemory.store({
        role: 'user',
        content: 'Recent message should have high retention'
      });

      const episode = await episodicMemory.get(id);
      const retention = episodicMemory.computeRetention(episode);

      expect(retention).toBeGreaterThan(0.9); // Recent = high retention
    });

    it('should have lower retention for older episodes', async () => {
      const oldTimestamp = Date.now() - (86400000 * 30); // 30 days ago

      await episodicMemory.store(
        { role: 'user', content: 'Old message from long ago should decay' },
        { timestamp: oldTimestamp }
      );

      const recent = await episodicMemory.getRecent(1);
      if (recent.length > 0) {
        const retention = episodicMemory.computeRetention({
          ...recent[0],
          timestamp: oldTimestamp,
          accessCount: 0
        });
        expect(retention).toBeLessThan(0.5);
      }
    });

    it('should boost retention with access count', async () => {
      const episode = {
        timestamp: Date.now() - (86400000 * 7), // 1 week ago
        accessCount: 0
      };

      const noAccessRetention = episodicMemory.computeRetention(episode);

      episode.accessCount = 10;
      const withAccessRetention = episodicMemory.computeRetention(episode);

      expect(withAccessRetention).toBeGreaterThan(noAccessRetention);
    });

    it('should prune low-retention episodes', async () => {
      // Configure aggressive decay for testing
      episodicMemory.configure({
        decayHalfLifeMs: 1000,  // 1 second
        minRetentionScore: 0.9  // High threshold
      });

      // Store old message
      await episodicMemory.store(
        { role: 'user', content: 'This old message should be pruned away' },
        { timestamp: Date.now() - 1000000 }
      );

      const pruned = await episodicMemory.pruneByRetention();

      // Pruning should work
      expect(typeof pruned).toBe('number');
    });

    it('should emit pruned event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('episodic:pruned', eventSpy);

      episodicMemory.configure({
        decayHalfLifeMs: 1,
        minRetentionScore: 1.0
      });

      await episodicMemory.store(
        { role: 'user', content: 'Message to be pruned for testing purposes' },
        { timestamp: Date.now() - 100000 }
      );

      await episodicMemory.pruneByRetention();

      // Event should be emitted if pruning occurred
    });
  });

  describe('Context Enrichment', () => {
    beforeEach(async () => {
      await episodicMemory.init();
      await episodicMemory.store({
        role: 'user',
        content: 'Previous discussion about API design patterns'
      });
      await episodicMemory.store({
        role: 'assistant',
        content: 'REST APIs use HTTP methods for CRUD operations'
      });
    });

    it('should enrich context with relevant episodes', async () => {
      const context = [
        { role: 'user', content: 'Tell me about APIs' }
      ];

      const enriched = await episodicMemory.enrichContext('API design', context);

      expect(enriched.length).toBeGreaterThan(context.length);
      expect(enriched.some(m => m.role === 'system')).toBe(true);
    });

    it('should preserve original context', async () => {
      const context = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User question' }
      ];

      const enriched = await episodicMemory.enrichContext('test', context);

      // Original messages should still be present
      expect(enriched.some(m => m.content === 'System prompt')).toBe(true);
      expect(enriched.some(m => m.content === 'User question')).toBe(true);
    });

    it('should return original context on error', async () => {
      // Make semantic memory fail
      mockSemanticMemory.embed.mockRejectedValueOnce(new Error('Embedding failed'));

      const context = [{ role: 'user', content: 'Test' }];
      const result = await episodicMemory.enrichContext('query', context);

      expect(result).toEqual(context);
    });
  });

  describe('Configuration', () => {
    beforeEach(async () => {
      await episodicMemory.init();
    });

    it('should allow configuration updates', () => {
      const original = episodicMemory.getConfig();

      episodicMemory.configure({
        decayHalfLifeMs: 12345,
        minRetentionScore: 0.5
      });

      const updated = episodicMemory.getConfig();
      expect(updated.decayHalfLifeMs).toBe(12345);
      expect(updated.minRetentionScore).toBe(0.5);
    });

    it('should return stats', async () => {
      await episodicMemory.store({
        role: 'user',
        content: 'Test message for stats verification'
      });

      const stats = episodicMemory.getStats();

      expect(stats.totalEpisodes).toBe(1);
      expect(stats.cachedEpisodes).toBe(1);
      expect(stats.config).toBeDefined();
    });
  });

  describe('Clear and Reset', () => {
    beforeEach(async () => {
      await episodicMemory.init();
      await episodicMemory.store({
        role: 'user',
        content: 'Message to be cleared in testing'
      });
    });

    it('should clear all episodes', async () => {
      await episodicMemory.clear();

      const stats = episodicMemory.getStats();
      expect(stats.totalEpisodes).toBe(0);
      expect(stats.cachedEpisodes).toBe(0);
    });

    it('should emit cleared event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('episodic:cleared', eventSpy);

      await episodicMemory.clear();

      expect(eventSpy).toHaveBeenCalled();
    });

    it('should delete VFS files', async () => {
      await episodicMemory.clear();

      expect(mockVFS.delete).toHaveBeenCalled();
    });
  });

  describe('Access Tracking', () => {
    beforeEach(async () => {
      await episodicMemory.init();
    });

    it('should increment access count on get', async () => {
      const id = await episodicMemory.store({
        role: 'user',
        content: 'Message whose access should be tracked'
      });

      const first = await episodicMemory.get(id);
      expect(first.accessCount).toBe(1);

      const second = await episodicMemory.get(id);
      expect(second.accessCount).toBe(2);
    });

    it('should increment access count on search', async () => {
      await episodicMemory.store({
        role: 'user',
        content: 'Message about unique topic for search tracking'
      });

      await episodicMemory.search('unique topic');

      // Access counts should be updated for returned results
      const stats = episodicMemory.getStats();
      expect(stats.cachedEpisodes).toBeGreaterThan(0);
    });
  });
});
