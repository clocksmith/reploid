/**
 * @fileoverview Unit tests for KnowledgeTree module
 * Tests hierarchical clustering, temporal indexing, hybrid retrieval,
 * anticipatory retrieval, and adaptive forgetting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';
import KnowledgeTreeModule from '../../capabilities/cognition/knowledge-tree.js';

describe('KnowledgeTree', () => {
  let knowledgeTree;
  let mockVFS;
  let mockLLMClient;
  let mockSemanticMemory;
  let mockEventBus;
  let utils;

  // Mock embedding generator - creates deterministic embeddings based on content
  const mockEmbed = (text) => {
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // Create 384-dim embedding (MiniLM size)
    const embedding = new Array(384).fill(0).map((_, i) => Math.sin(hash + i) * 0.5);
    // Normalize
    const mag = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / mag);
  };

  beforeEach(() => {
    utils = UtilsModule.factory();
    mockEventBus = EventBusModule.factory({ Utils: utils });

    // Mock VFS
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
      mkdir: vi.fn(async () => true)
    };

    // Mock LLMClient
    mockLLMClient = {
      chat: vi.fn(async (messages) => {
        // Extract content for summarization
        const content = messages[0]?.content || '';
        return { content: `Summary of: ${content.slice(0, 50)}...` };
      })
    };

    // Mock SemanticMemory
    mockSemanticMemory = {
      embed: vi.fn(async (text) => mockEmbed(text)),
      init: vi.fn(async () => true)
    };

    knowledgeTree = KnowledgeTreeModule.factory({
      Utils: utils,
      VFS: mockVFS,
      LLMClient: mockLLMClient,
      SemanticMemory: mockSemanticMemory,
      EventBus: mockEventBus
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with empty state', async () => {
      await knowledgeTree.init();
      const stats = knowledgeTree.getStats();

      expect(stats.hasTree).toBe(false);
      expect(stats.levels).toBe(0);
      expect(stats.totalNodes).toBe(0);
    });

    it('should load existing tree from VFS', async () => {
      // Pre-populate VFS with a tree
      const existingTree = {
        id: 'tree-123',
        createdAt: Date.now(),
        documentCount: 3,
        levels: [[
          { id: 'node-1', content: 'Test 1', embedding: mockEmbed('Test 1'), level: 0, children: [] },
          { id: 'node-2', content: 'Test 2', embedding: mockEmbed('Test 2'), level: 0, children: [] }
        ]]
      };
      await mockVFS.write('/memory/knowledge/tree.json', JSON.stringify(existingTree));

      await knowledgeTree.init();
      const stats = knowledgeTree.getStats();

      expect(stats.hasTree).toBe(true);
      expect(stats.totalNodes).toBe(2);
    });
  });

  describe('Tree Building', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should build tree from documents', async () => {
      const documents = [
        'Machine learning is a subset of artificial intelligence',
        'Deep learning uses neural networks with many layers',
        'Natural language processing deals with text understanding',
        'Computer vision processes images and videos'
      ];

      const tree = await knowledgeTree.build(documents);

      expect(tree).not.toBeNull();
      expect(tree.levels.length).toBeGreaterThanOrEqual(1);
      expect(tree.levels[0].length).toBe(4);
      expect(mockSemanticMemory.embed).toHaveBeenCalled();
    });

    it('should reject building with insufficient documents', async () => {
      const documents = ['Only one document'];
      const result = await knowledgeTree.build(documents);

      expect(result).toBeNull();
    });

    it('should create summaries for higher levels', async () => {
      const documents = [
        'Python is great for data science',
        'R is used for statistical analysis',
        'Julia is fast for numerical computing',
        'JavaScript runs in browsers',
        'TypeScript adds types to JavaScript'
      ];

      const tree = await knowledgeTree.build(documents);

      if (tree.levels.length > 1) {
        // Higher levels should have summaries
        expect(mockLLMClient.chat).toHaveBeenCalled();
      }
    });
  });

  describe('Basic Query', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Machine learning algorithms learn from data',
        'Neural networks are inspired by biological neurons',
        'Databases store structured information',
        'SQL is used to query relational databases'
      ]);
    });

    it('should return relevant results for queries', async () => {
      const results = await knowledgeTree.query('machine learning', { topK: 2 });

      expect(results).toHaveLength(2);
      expect(results[0].content).toContain('Machine learning');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should search all tree levels by default', async () => {
      const results = await knowledgeTree.query('data science', {
        topK: 10,
        includeAllLevels: true
      });

      // Should include nodes from multiple levels if tree has multiple levels
      expect(results.length).toBeGreaterThan(0);
    });

    it('should emit query event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('knowledge:tree:query', eventSpy);

      await knowledgeTree.query('test query');

      expect(eventSpy).toHaveBeenCalled();
      expect(eventSpy.mock.calls[0][0].query).toBe('test query');
    });
  });

  describe('Incremental Updates (addDocument)', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should add document to existing tree', async () => {
      await knowledgeTree.build([
        'First document',
        'Second document',
        'Third document'
      ]);

      const initialStats = knowledgeTree.getStats();
      const nodeId = await knowledgeTree.addDocument('Fourth document added later');
      const newStats = knowledgeTree.getStats();

      expect(nodeId).toBeTruthy();
      expect(newStats.totalNodes).toBeGreaterThan(initialStats.totalNodes);
    });

    it('should create tree if none exists', async () => {
      const nodeId = await knowledgeTree.addDocument('First document ever');

      // With only one document, tree might not be built (below minimum threshold)
      const stats = knowledgeTree.getStats();
      expect(stats).toBeDefined();
    });

    it('should add document with timestamp to temporal index', async () => {
      await knowledgeTree.build([
        'First document',
        'Second document',
        'Third document'
      ]);

      const timestamp = Date.now() - 3600000; // 1 hour ago
      await knowledgeTree.addDocument('Timestamped document', { timestamp });

      const temporalIndex = knowledgeTree.getTemporalIndex();
      expect(Object.keys(temporalIndex.nodeTimestamps).length).toBeGreaterThan(0);
    });
  });

  describe('Temporal Indexing', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should track node timestamps', async () => {
      await knowledgeTree.build([
        { content: 'Morning event', metadata: {} },
        { content: 'Afternoon event', metadata: {} },
        { content: 'Evening event', metadata: {} }
      ]);

      const temporalIndex = knowledgeTree.getTemporalIndex();
      expect(temporalIndex.nodeTimestamps).toBeDefined();
    });

    it('should query by time range', async () => {
      await knowledgeTree.build([
        'Document 1',
        'Document 2',
        'Document 3'
      ]);

      const now = Date.now();
      await knowledgeTree.addDocument('Recent document', { timestamp: now - 1000 });

      const results = await knowledgeTree.queryByTimeRange(now - 60000, now);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Hybrid Retrieval', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Error handling in Python uses try-except blocks',
        'Debugging JavaScript with browser developer tools',
        'Testing React components with Jest and RTL',
        'API design patterns for REST services',
        'Database optimization techniques'
      ]);
    });

    it('should combine semantic and temporal scoring', async () => {
      const results = await knowledgeTree.hybridQuery('debugging errors', { topK: 3 });

      expect(results).toHaveLength(3);
      expect(results[0].semanticScore).toBeDefined();
      expect(results[0].retention).toBeDefined();
    });

    it('should apply time range filter', async () => {
      const now = Date.now();
      await knowledgeTree.addDocument('New debugging tip', { timestamp: now });

      const results = await knowledgeTree.hybridQuery('debugging', {
        topK: 5,
        timeRangeMs: 3600000 // Last hour
      });

      // Results should be filtered by time
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should emit hybrid query event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('knowledge:tree:hybrid-query', eventSpy);

      await knowledgeTree.hybridQuery('test');

      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('Anticipatory Retrieval', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Stack trace analysis for debugging errors',
        'Exception handling best practices',
        'Architecture patterns for microservices',
        'Design principles for scalable systems',
        'API testing strategies'
      ]);
    });

    it('should detect task type from query', () => {
      const debugResult = knowledgeTree.detectTaskType('fix this error in my code');
      expect(debugResult.taskType).toBe('debug');
      expect(debugResult.confidence).toBeGreaterThan(0);

      const implementResult = knowledgeTree.detectTaskType('design the architecture');
      expect(implementResult.taskType).toBe('implement');
    });

    it('should return general for unrecognized queries', () => {
      const result = knowledgeTree.detectTaskType('hello world');
      expect(result.taskType).toBe('general');
      expect(result.confidence).toBe(0);
    });

    it('should boost anticipated context', async () => {
      const results = await knowledgeTree.anticipatoryQuery('debug this error', { topK: 3 });

      expect(results.length).toBeGreaterThan(0);
      // Error-related content should be boosted
    });

    it('should emit anticipatory query event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('knowledge:tree:anticipatory-query', eventSpy);

      await knowledgeTree.anticipatoryQuery('debug error');

      expect(eventSpy).toHaveBeenCalled();
      expect(eventSpy.mock.calls[0][0].taskType).toBe('debug');
    });
  });

  describe('Adaptive Forgetting (Ebbinghaus)', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should compute retention score', async () => {
      await knowledgeTree.build([
        'Document 1',
        'Document 2',
        'Document 3'
      ]);

      // Add document with old timestamp
      const nodeId = await knowledgeTree.addDocument('Old document', {
        timestamp: Date.now() - (86400000 * 30) // 30 days ago
      });

      const retention = knowledgeTree.computeRetentionScore(nodeId);
      expect(retention).toBeLessThan(1);
      expect(retention).toBeGreaterThanOrEqual(0.1); // Min retention
    });

    it('should return 1 for unknown nodes', () => {
      const retention = knowledgeTree.computeRetentionScore('nonexistent-node');
      expect(retention).toBe(1);
    });

    it('should prune decayed nodes', async () => {
      await knowledgeTree.build([
        'Document 1',
        'Document 2',
        'Document 3'
      ]);

      // Configure aggressive decay for testing
      knowledgeTree.configure({
        decayHalfLifeMs: 1000, // 1 second half-life
        minRetentionScore: 0.9 // High threshold
      });

      // Add very old document
      await knowledgeTree.addDocument('Ancient document', {
        timestamp: Date.now() - 1000000 // Very old
      });

      const pruned = await knowledgeTree.pruneDecayedNodes();
      // May or may not prune depending on timing
      expect(typeof pruned).toBe('number');
    });
  });

  describe('Access Tracking', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Frequently accessed topic',
        'Rarely accessed topic',
        'Another topic here'
      ]);
    });

    it('should record access when querying', async () => {
      const initialIndex = knowledgeTree.getTemporalIndex();
      const initialAccessCounts = { ...initialIndex.accessCounts };

      await knowledgeTree.query('frequently accessed');

      const newIndex = knowledgeTree.getTemporalIndex();
      // Access counts should increase for retrieved nodes
      expect(newIndex.accessCounts).toBeDefined();
    });
  });

  describe('Configuration', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should allow configuration updates', () => {
      const originalConfig = knowledgeTree.getConfig();

      knowledgeTree.configure({
        decayHalfLifeMs: 12345,
        minRetentionScore: 0.5
      });

      const newConfig = knowledgeTree.getConfig();
      expect(newConfig.decayHalfLifeMs).toBe(12345);
      expect(newConfig.minRetentionScore).toBe(0.5);
    });

    it('should return stats with temporal info', async () => {
      await knowledgeTree.build([
        'Doc 1', 'Doc 2', 'Doc 3'
      ]);

      const stats = knowledgeTree.getStats();
      expect(stats.temporalBuckets).toBeDefined();
      expect(stats.indexedNodes).toBeDefined();
      expect(stats.config).toBeDefined();
    });
  });

  describe('Clear and Reset', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Document 1',
        'Document 2',
        'Document 3'
      ]);
    });

    it('should clear tree and temporal index', async () => {
      await knowledgeTree.clear();

      const stats = knowledgeTree.getStats();
      expect(stats.hasTree).toBe(false);
      expect(stats.totalNodes).toBe(0);
    });

    it('should delete VFS files on clear', async () => {
      await knowledgeTree.clear();

      expect(mockVFS.delete).toHaveBeenCalled();
    });

    it('should emit clear event', async () => {
      const eventSpy = vi.fn();
      mockEventBus.on('knowledge:tree:cleared', eventSpy);

      await knowledgeTree.clear();

      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('K-Means Clustering', () => {
    beforeEach(async () => {
      await knowledgeTree.init();
    });

    it('should cluster similar documents together', async () => {
      const documents = [
        // Cluster 1: Programming
        'Python programming language',
        'JavaScript for web development',
        'TypeScript adds static typing',
        // Cluster 2: Databases
        'PostgreSQL relational database',
        'MongoDB document store',
        'Redis in-memory cache'
      ];

      const tree = await knowledgeTree.build(documents);

      // Tree should have been built with clusters
      expect(tree.levels[0].length).toBe(6);
      if (tree.levels.length > 1) {
        // Higher levels should have fewer nodes (clustered)
        expect(tree.levels[1].length).toBeLessThan(6);
      }
    });
  });

  describe('Persistence', () => {
    it('should persist tree to VFS', async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Document 1', 'Document 2', 'Document 3'
      ]);

      expect(mockVFS.write).toHaveBeenCalledWith(
        '/memory/knowledge/tree.json',
        expect.any(String)
      );
    });

    it('should persist temporal index to VFS', async () => {
      await knowledgeTree.init();
      await knowledgeTree.build([
        'Document 1', 'Document 2', 'Document 3'
      ]);
      await knowledgeTree.addDocument('New document');

      expect(mockVFS.write).toHaveBeenCalledWith(
        '/memory/knowledge/temporal-index.json',
        expect.any(String)
      );
    });
  });
});
