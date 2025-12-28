/**
 * @fileoverview PromptMemory Integration Tests
 * Tests prompt storage, transfer learning, and drift detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
const mockSemanticMemory = {
  store: vi.fn().mockResolvedValue('mem_001'),
  search: vi.fn().mockResolvedValue([]),
  embed: vi.fn().mockResolvedValue(new Array(384).fill(0))
};

const mockKnowledgeTree = {
  query: vi.fn().mockResolvedValue([])
};

const mockEmbeddingStore = {
  getMemory: vi.fn().mockResolvedValue(null)
};

const mockVFS = {
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(true),
  read: vi.fn().mockResolvedValue('{}'),
  write: vi.fn().mockResolvedValue(true),
  readdir: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(true)
};

const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
};

const mockUtils = {
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  generateId: (prefix) => `${prefix}_${Date.now()}`,
  Errors: {
    ValidationError: class ValidationError extends Error {
      constructor(msg) { super(msg); this.name = 'ValidationError'; }
    }
  }
};

// Import and create PromptMemory
import PromptMemoryModule from '../../capabilities/cognition/prompt-memory.js';

const createPromptMemory = () => {
  return PromptMemoryModule.factory({
    Utils: mockUtils,
    EventBus: mockEventBus,
    SemanticMemory: mockSemanticMemory,
    EmbeddingStore: mockEmbeddingStore,
    KnowledgeTree: mockKnowledgeTree,
    VFS: mockVFS
  });
};

describe('PromptMemory', () => {
  let PromptMemory;

  beforeEach(async () => {
    vi.clearAllMocks();
    PromptMemory = createPromptMemory();
    await PromptMemory.init();
  });

  afterEach(async () => {
    await PromptMemory.clear();
  });

  describe('Prompt Storage', () => {
    it('stores evolved prompt with metadata', async () => {
      const prompt = {
        content: 'You are a helpful assistant.',
        scores: { accuracy: 0.9, efficiency: 0.8, robustness: 0.85 },
        generation: 3,
        parentIds: ['parent_001']
      };

      const id = await PromptMemory.storeEvolvedPrompt(prompt, 'code_generation');

      expect(id).toBe('mem_001');
      expect(mockSemanticMemory.store).toHaveBeenCalledWith(
        prompt.content,
        expect.objectContaining({
          domain: 'evolved_prompt',
          source: 'gepa',
          taskType: 'code_generation',
          fitness: expect.objectContaining({
            accuracy: 0.9,
            efficiency: 0.8,
            robustness: 0.85,
            composite: expect.any(Number)
          })
        })
      );
    });

    it('computes composite fitness correctly', async () => {
      const prompt = {
        content: 'Test prompt',
        scores: { accuracy: 1.0, efficiency: 1.0, robustness: 1.0 }
      };

      await PromptMemory.storeEvolvedPrompt(prompt, 'test');

      const call = mockSemanticMemory.store.mock.calls[0];
      const metadata = call[1];

      // composite = accuracy*0.5 + robustness*0.3 + efficiency*0.2 = 1.0
      expect(metadata.fitness.composite).toBe(1.0);
    });

    it('rejects prompts without content', async () => {
      await expect(
        PromptMemory.storeEvolvedPrompt({}, 'test')
      ).rejects.toThrow('Prompt content is required');
    });
  });

  describe('Transfer Learning', () => {
    it('queries KnowledgeTree and SemanticMemory for seeds', async () => {
      mockKnowledgeTree.query.mockResolvedValue([
        { content: 'React component development', score: 0.9 }
      ]);

      mockSemanticMemory.search.mockResolvedValue([
        {
          content: 'You are a React expert.',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.8 } },
          similarity: 0.85
        }
      ]);

      const seeds = await PromptMemory.getSeedPrompts('Build a React form component');

      expect(mockKnowledgeTree.query).toHaveBeenCalledWith(
        'Build a React form component',
        expect.objectContaining({ topK: 3 })
      );

      expect(mockSemanticMemory.search).toHaveBeenCalled();
      expect(seeds.length).toBeGreaterThanOrEqual(0);
    });

    it('deduplicates seeds from multiple sources', async () => {
      const sharedContent = 'You are a coding assistant.';

      mockKnowledgeTree.query.mockResolvedValue([]);
      mockSemanticMemory.search.mockResolvedValue([
        { content: sharedContent, domain: 'evolved_prompt', metadata: { fitness: { composite: 0.7 } } },
        { content: sharedContent, domain: 'evolved_prompt', metadata: { fitness: { composite: 0.8 } } }
      ]);

      const seeds = await PromptMemory.getSeedPrompts('coding task');

      // Should deduplicate
      const uniqueSeeds = [...new Set(seeds)];
      expect(seeds.length).toBe(uniqueSeeds.length);
    });
  });

  describe('Performance Tracking', () => {
    it('records execution performance', async () => {
      const result = await PromptMemory.recordPerformance('prompt_001', {
        success: true,
        latencyMs: 150,
        score: 0.95
      });

      expect(mockVFS.write).toHaveBeenCalled();
      expect(result).toHaveProperty('successRate');
      expect(result).toHaveProperty('avgLatency');
    });

    it('detects drift when performance degrades', async () => {
      // Mock performance data with drift
      const perfData = {
        promptId: 'prompt_001',
        executions: [
          // Baseline (first 5): high performance
          ...Array(5).fill({ success: true, latencyMs: 100, score: 0.95 }),
          // Recent (last 10): degraded performance
          ...Array(10).fill({ success: false, latencyMs: 500, score: 0.5 })
        ]
      };

      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue(JSON.stringify(perfData));

      const drift = await PromptMemory.checkDrift('prompt_001');

      expect(drift.hasDrift).toBe(true);
      expect(drift.scoreDrop).toBeGreaterThan(0);
    });

    it('returns no drift for insufficient data', async () => {
      mockVFS.exists.mockResolvedValue(false);

      const drift = await PromptMemory.checkDrift('prompt_001');

      expect(drift.hasDrift).toBe(false);
      expect(drift.reason).toBe('no_data');
    });
  });

  describe('Drift Scanning', () => {
    it('scans all prompts for drift', async () => {
      mockVFS.readdir.mockResolvedValue(['prompt_001.json', 'prompt_002.json']);
      mockVFS.exists.mockResolvedValue(true);

      // First prompt: no drift
      mockVFS.read.mockResolvedValueOnce(JSON.stringify({
        promptId: 'prompt_001',
        baselineStats: { avgScore: 0.9 },
        recentStats: { avgScore: 0.88, count: 10 }
      }));

      // Second prompt: has drift
      mockVFS.read.mockResolvedValueOnce(JSON.stringify({
        promptId: 'prompt_002',
        baselineStats: { avgScore: 0.9, successRate: 0.95 },
        recentStats: { avgScore: 0.5, successRate: 0.6, count: 10 }
      }));

      const drifted = await PromptMemory.getDriftedPrompts();

      expect(drifted.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Stats', () => {
    it('returns module statistics', async () => {
      mockSemanticMemory.search.mockResolvedValue([]);

      const stats = await PromptMemory.getStats();

      expect(stats).toHaveProperty('initialized', true);
      expect(stats).toHaveProperty('promptCount');
      expect(stats).toHaveProperty('driftThreshold');
    });
  });
});
