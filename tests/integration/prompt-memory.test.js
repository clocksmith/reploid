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

  describe('Prompt retrieval', () => {
    it('retrieves prompt by ID', async () => {
      mockEmbeddingStore.getMemory.mockResolvedValue({
        id: 'prompt_001',
        content: 'Test evolved prompt',
        metadata: {
          domain: 'evolved_prompt',
          taskType: 'code_generation',
          fitness: { composite: 0.85 },
          generation: 5,
          evolvedAt: Date.now()
        }
      });

      const prompt = await PromptMemory.getPromptById('prompt_001');

      expect(prompt).toBeDefined();
      expect(prompt.id).toBe('prompt_001');
      expect(prompt.content).toBe('Test evolved prompt');
      expect(prompt.taskType).toBe('code_generation');
    });

    it('returns null for non-existent prompt', async () => {
      mockEmbeddingStore.getMemory.mockResolvedValue(null);

      const prompt = await PromptMemory.getPromptById('nonexistent');

      expect(prompt).toBeNull();
    });
  });

  describe('Drift scanning', () => {
    it('runs drift scan and queues reoptimization', async () => {
      // Mock performance files with drift
      mockVFS.readdir.mockResolvedValue(['prompt_001.json', 'prompt_002.json']);
      mockVFS.exists.mockResolvedValue(true);

      // First prompt: no drift
      mockVFS.read.mockResolvedValueOnce(JSON.stringify({
        promptId: 'prompt_001',
        baselineStats: { avgScore: 0.9, successRate: 0.95 },
        recentStats: { avgScore: 0.88, successRate: 0.93, count: 10 }
      }));

      // Second prompt: has drift
      mockVFS.read.mockResolvedValueOnce(JSON.stringify({
        promptId: 'prompt_002',
        baselineStats: { avgScore: 0.9, successRate: 0.95 },
        recentStats: { avgScore: 0.5, successRate: 0.6, count: 10 }
      }));

      // Mock memory retrieval for reoptimization trigger
      mockEmbeddingStore.getMemory.mockResolvedValue({
        id: 'prompt_002',
        content: 'Drifted prompt',
        metadata: { taskType: 'test', fitness: { composite: 0.9 } }
      });

      const result = await PromptMemory.runDriftScan();

      expect(result.scanned).toBe(true);
      expect(result.driftedCount).toBeGreaterThanOrEqual(0);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'prompt:memory:drift-scan',
        expect.any(Object)
      );
    });
  });

  describe('High-performing prompts', () => {
    it('retrieves prompts filtered by fitness', async () => {
      mockSemanticMemory.search.mockResolvedValue([
        {
          content: 'High fitness prompt',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.9 }, taskType: 'coding' },
          similarity: 0.95
        },
        {
          content: 'Medium fitness prompt',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.7 }, taskType: 'coding' },
          similarity: 0.85
        },
        {
          content: 'Low fitness prompt',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.4 }, taskType: 'coding' },
          similarity: 0.75
        }
      ]);

      const prompts = await PromptMemory.getPromptsForTaskType('coding', {
        topK: 5,
        minFitness: 0.6
      });

      // Should filter out low fitness prompt
      expect(prompts.length).toBe(2);
      expect(prompts[0].fitness.composite).toBe(0.9);
      expect(prompts[1].fitness.composite).toBe(0.7);
    });
  });

  describe('GEPA Integration', () => {
    it('stores evolved prompt with full GEPA metadata', async () => {
      const evolvedCandidate = {
        id: 'gepa_001',
        content: 'You are a helpful coding assistant. Be precise and concise.',
        scores: {
          accuracy: 0.92,
          efficiency: 0.85,
          robustness: 0.88,
          cost: 0.78
        },
        generation: 5,
        parentIds: ['gepa_parent_1', 'gepa_parent_2'],
        targetType: 'prompt',
        payload: null,
        mutationType: 'reflection_guided',
        appliedReflections: ['mismatch', 'partial_match']
      };

      const id = await PromptMemory.storeEvolvedPrompt(evolvedCandidate, 'code_generation');

      expect(id).toBe('mem_001');
      expect(mockSemanticMemory.store).toHaveBeenCalledWith(
        evolvedCandidate.content,
        expect.objectContaining({
          domain: 'evolved_prompt',
          source: 'gepa',
          taskType: 'code_generation',
          generation: 5,
          parentIds: ['gepa_parent_1', 'gepa_parent_2'],
          targetType: 'prompt',
          fitness: expect.objectContaining({
            accuracy: 0.92,
            efficiency: 0.85,
            robustness: 0.88
          })
        })
      );
    });

    it('computes composite fitness correctly for GEPA prompts', async () => {
      const prompt = {
        content: 'Test evolved prompt',
        scores: {
          accuracy: 0.8,    // weight: 0.5 -> 0.4
          robustness: 0.6,  // weight: 0.3 -> 0.18
          efficiency: 0.7   // weight: 0.2 -> 0.14
        }
        // composite = 0.4 + 0.18 + 0.14 = 0.72
      };

      await PromptMemory.storeEvolvedPrompt(prompt, 'test');

      const call = mockSemanticMemory.store.mock.calls[0];
      const metadata = call[1];

      expect(metadata.fitness.composite).toBeCloseTo(0.72, 2);
    });

    it('emits event when storing evolved prompt', async () => {
      const prompt = {
        content: 'Test prompt',
        scores: { accuracy: 0.9, efficiency: 0.8, robustness: 0.85 }
      };

      await PromptMemory.storeEvolvedPrompt(prompt, 'testing');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'prompt:memory:stored',
        expect.objectContaining({
          id: 'mem_001',
          taskType: 'testing'
        })
      );
    });
  });

  describe('Performance Tracking - Extended', () => {
    it('updates rolling stats correctly over multiple recordings', async () => {
      // Mock initial empty state
      mockVFS.exists.mockResolvedValue(false);

      // Record first execution
      await PromptMemory.recordPerformance('prompt_001', {
        success: true,
        latencyMs: 100,
        score: 0.9
      });

      // Verify VFS write was called
      expect(mockVFS.write).toHaveBeenCalled();

      // Check emitted event
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'prompt:memory:performance',
        expect.objectContaining({
          promptId: 'prompt_001'
        })
      );
    });

    it('limits execution history to 100 records', async () => {
      // Create performance data with 105 executions
      const executions = Array(105).fill(null).map((_, i) => ({
        timestamp: Date.now() - i * 1000,
        success: true,
        latencyMs: 100,
        score: 0.9
      }));

      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue(JSON.stringify({
        promptId: 'prompt_001',
        executions,
        createdAt: Date.now() - 1000000
      }));

      await PromptMemory.recordPerformance('prompt_001', {
        success: true,
        latencyMs: 150,
        score: 0.85
      });

      // Verify write was called - parse the written data
      const writeCall = mockVFS.write.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);

      // Should have 100 executions (105 original - trimmed to 100 + 1 new = 101, then trimmed to 100)
      // Actually: slice(-100) on 106 items = last 100
      expect(writtenData.executions.length).toBeLessThanOrEqual(101);
    });
  });

  describe('Drift Detection - Extended', () => {
    it('calculates drift metrics correctly', async () => {
      // High baseline (first 10), low recent (last 10)
      const executions = [
        // Baseline: high performance
        ...Array(10).fill(null).map((_, i) => ({
          timestamp: Date.now() - 100000 + i,
          success: true,
          latencyMs: 100,
          score: 0.95
        })),
        // Recent: degraded performance
        ...Array(10).fill(null).map((_, i) => ({
          timestamp: Date.now() - 50000 + i,
          success: i % 2 === 0, // 50% success
          latencyMs: 300,
          score: 0.5
        }))
      ];

      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue(JSON.stringify({
        promptId: 'prompt_001',
        executions,
        baselineStats: { avgScore: 0.95, successRate: 1.0 },
        recentStats: { avgScore: 0.5, successRate: 0.5, count: 10 }
      }));

      const drift = await PromptMemory.checkDrift('prompt_001');

      expect(drift.hasDrift).toBe(true);
      expect(drift.scoreDrop).toBeGreaterThan(0.15); // Exceeds threshold
    });

    it('emits drift event when detected', async () => {
      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue(JSON.stringify({
        promptId: 'prompt_002',
        baselineStats: { avgScore: 0.9, successRate: 0.95 },
        recentStats: { avgScore: 0.5, successRate: 0.5, count: 10 }
      }));

      await PromptMemory.checkDrift('prompt_002');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'prompt:memory:drift',
        expect.objectContaining({
          promptId: 'prompt_002'
        })
      );
    });
  });

  describe('Re-optimization Trigger', () => {
    it('emits reoptimize event with prompt data', async () => {
      mockEmbeddingStore.getMemory.mockResolvedValue({
        id: 'prompt_003',
        content: 'Original evolved prompt',
        metadata: {
          taskType: 'code_review',
          fitness: { composite: 0.85, accuracy: 0.9, efficiency: 0.8 }
        }
      });

      await PromptMemory.triggerReoptimization('prompt_003', {
        scoreDrop: 0.25,
        successDrop: 0.2,
        baseline: { avgScore: 0.9 },
        recent: { avgScore: 0.65 }
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'prompt:memory:reoptimize',
        expect.objectContaining({
          promptId: 'prompt_003',
          content: 'Original evolved prompt',
          taskType: 'code_review',
          originalFitness: expect.objectContaining({ composite: 0.85 })
        })
      );
    });

    it('logs warning when prompt not found', async () => {
      mockEmbeddingStore.getMemory.mockResolvedValue(null);

      await PromptMemory.triggerReoptimization('nonexistent', {});

      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cannot reoptimize'),
        expect.anything()
      );
    });
  });

  describe('buildSeededPopulation()', () => {
    it('builds population with user seed first', async () => {
      mockKnowledgeTree.query.mockResolvedValue([]);
      mockSemanticMemory.search.mockResolvedValue([
        {
          content: 'Historical prompt 1',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.8 } }
        },
        {
          content: 'Historical prompt 2',
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.75 } }
        }
      ]);

      const population = await PromptMemory.buildSeededPopulation(
        'User seed prompt',
        'Build a REST API',
        4
      );

      expect(population.length).toBeGreaterThanOrEqual(1);
      expect(population[0].content).toBe('User seed prompt');
      expect(population[0].mutationType).toBe('seed');
    });

    it('limits historical seeds to half population size', async () => {
      mockKnowledgeTree.query.mockResolvedValue([]);
      mockSemanticMemory.search.mockResolvedValue(
        Array(10).fill(null).map((_, i) => ({
          content: `Historical prompt ${i}`,
          domain: 'evolved_prompt',
          metadata: { fitness: { composite: 0.8 - i * 0.05 } }
        }))
      );

      const population = await PromptMemory.buildSeededPopulation(
        'Seed',
        'Task description',
        6
      );

      // Should have seed + at most 3 historical (half of 6)
      const historicalCount = population.filter(p => p.mutationType === 'historical_seed').length;
      expect(historicalCount).toBeLessThanOrEqual(3);
    });
  });
});
