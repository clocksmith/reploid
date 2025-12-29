/**
 * @fileoverview Integration tests for GEPA Optimizer
 * Tests genetic evolution, reflection, pareto selection, and checkpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GEPAOptimizerModule from '../../capabilities/cognition/gepa-optimizer.js';

describe('GEPA Optimizer - Integration Tests', () => {
  let gepaOptimizer;
  let mockLLMClient;
  let mockEventBus;
  let mockUtils;
  let mockVFS;
  let fileStorage;
  let idCounter;
  let emittedEvents;

  const createMocks = () => {
    fileStorage = new Map();
    idCounter = 0;
    emittedEvents = [];

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix) => `${prefix}_${++idCounter}`),
      sanitizeLlmJsonRespPure: vi.fn().mockImplementation((content) => ({
        json: content,
        raw: content
      })),
      Errors: {
        ConfigError: class extends Error { constructor(m) { super(m); this.name = 'ConfigError'; } },
        ValidationError: class extends Error { constructor(m) { super(m); this.name = 'ValidationError'; } }
      }
    };

    mockVFS = {
      exists: vi.fn().mockImplementation((path) => Promise.resolve(fileStorage.has(path) || [...fileStorage.keys()].some(k => k.startsWith(path)))),
      read: vi.fn().mockImplementation((path) => {
        if (fileStorage.has(path)) return Promise.resolve(fileStorage.get(path));
        return Promise.reject(new Error('File not found'));
      }),
      write: vi.fn().mockImplementation((path, content) => {
        fileStorage.set(path, content);
        return Promise.resolve(true);
      }),
      mkdir: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockImplementation((path) => {
        const prefix = path.endsWith('/') ? path : path + '/';
        const files = [...fileStorage.keys()]
          .filter(k => k.startsWith(prefix))
          .map(k => k.substring(prefix.length).split('/')[0])
          .filter((v, i, a) => a.indexOf(v) === i); // unique
        return Promise.resolve(files);
      })
    };

    mockEventBus = {
      emit: vi.fn().mockImplementation((event, data) => {
        emittedEvents.push({ event, data });
      }),
      on: vi.fn(),
      off: vi.fn()
    };

    mockLLMClient = {
      chat: vi.fn()
    };
  };

  beforeEach(() => {
    createMocks();
    gepaOptimizer = GEPAOptimizerModule.factory({
      LLMClient: mockLLMClient,
      EventBus: mockEventBus,
      Utils: mockUtils,
      VFS: mockVFS
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Module metadata', () => {
    it('should have correct metadata', () => {
      expect(GEPAOptimizerModule.metadata.id).toBe('GEPAOptimizer');
      expect(GEPAOptimizerModule.metadata.type).toBe('capability');
      expect(GEPAOptimizerModule.metadata.async).toBe(true);
      expect(GEPAOptimizerModule.metadata.dependencies).toContain('LLMClient');
      expect(GEPAOptimizerModule.metadata.dependencies).toContain('VFS');
    });
  });

  describe('evolve() - basic evolution', () => {
    it('should run evolution with successful evaluations', async () => {
      // Mock LLM to return expected outputs
      mockLLMClient.chat.mockResolvedValue({
        content: 'expected output',
        usage: { total_tokens: 50 }
      });

      const taskSet = [
        { id: 'task1', input: 'test input 1', expected: 'expected output' }
      ];

      const result = await gepaOptimizer.api.evolve(
        'You are a helpful assistant.',
        taskSet,
        {
          evaluationModel: { id: 'test-model' },
          reflectionModel: { id: 'test-model' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      expect(result.frontier).toBeDefined();
      expect(result.generations).toBe(1);
      expect(result.bestOverall).toBeDefined();
      expect(result.bestOverall.scores.accuracy).toBeGreaterThan(0);
    });

    it('should emit lifecycle events', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'output', usage: {} });

      await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ input: 'test', expected: 'output' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      const eventTypes = emittedEvents.map(e => e.event);
      expect(eventTypes).toContain('gepa:started');
      expect(eventTypes).toContain('gepa:evaluated');
      expect(eventTypes).toContain('gepa:reflected');
      expect(eventTypes).toContain('gepa:generation-complete');
    });

    it('should throw on missing evaluationModel', async () => {
      await expect(
        gepaOptimizer.api.evolve('prompt', [{ input: 'x' }], {})
      ).rejects.toThrow('evaluationModel');
    });

    it('should throw on empty taskSet', async () => {
      await expect(
        gepaOptimizer.api.evolve('prompt', [], { evaluationModel: { id: 'x' } })
      ).rejects.toThrow('empty');
    });
  });

  describe('Reflection on failures', () => {
    it('should generate reflections for failed evaluations', async () => {
      let callCount = 0;
      mockLLMClient.chat.mockImplementation(async () => {
        callCount++;
        // First calls are evaluations (return wrong output)
        if (callCount <= 2) {
          return { content: 'wrong output', usage: {} };
        }
        // Later calls are reflections
        return {
          content: JSON.stringify({
            rootCause: 'Prompt lacks specificity',
            modifications: [
              { type: 'add', target: 'end', content: 'Be specific.', rationale: 'Improves accuracy' }
            ]
          })
        };
      });

      const result = await gepaOptimizer.api.evolve(
        'Vague prompt',
        [{ input: 'test', expected: 'correct output' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      // Reflections should have been generated
      const reflectedEvent = emittedEvents.find(e => e.event === 'gepa:reflected');
      expect(reflectedEvent).toBeDefined();
    });
  });

  describe('Pareto selection', () => {
    it('should select candidates based on multi-objective dominance', async () => {
      // Create population with varied scores
      let evalCount = 0;
      mockLLMClient.chat.mockImplementation(async () => {
        evalCount++;
        // Minimal delay to vary efficiency scores slightly
        await new Promise(r => setTimeout(r, 1));
        return { content: evalCount % 2 === 0 ? 'expected' : 'wrong', usage: {} };
      });

      const result = await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ input: 'x', expected: 'expected' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          eliteCount: 1,
          evaluationBatchSize: 1
        }
      );

      // Frontier should contain non-dominated solutions
      expect(result.frontier.length).toBeGreaterThan(0);
      expect(result.frontier.length).toBeLessThanOrEqual(2);
    });
  });

  describe('VFS checkpoints', () => {
    it('should save checkpoint after each generation', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: {} });

      await gepaOptimizer.api.evolve(
        'Prompt',
        [{ input: 'x', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          checkpointPath: '/.memory/gepa/',
          evaluationBatchSize: 1
        }
      );

      // Should have saved gen_0.json
      expect(fileStorage.has('/.memory/gepa/gen_0.json')).toBe(true);

      const checkpoint = JSON.parse(fileStorage.get('/.memory/gepa/gen_0.json'));
      expect(checkpoint.generation).toBe(0);
      expect(checkpoint.population).toBeDefined();
      expect(checkpoint.frontier).toBeDefined();
    });
  });

  describe('Unsupported target types', () => {
    it('should throw for unsupported targetType', async () => {
      await expect(
        gepaOptimizer.api.evolve(
          'kernel',
          [{ input: 'x' }],
          {
            evaluationModel: { id: 'test' },
            targetType: 'wgsl',
            populationSize: 2,
            maxGenerations: 1
          }
        )
      ).rejects.toThrow('Unsupported target type');
    });
  });

  describe('getStatus()', () => {
    it('should return current evolution status', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'x', usage: {} });

      await gepaOptimizer.api.evolve(
        'Prompt',
        [{ input: 'x', expected: 'x' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      const status = gepaOptimizer.api.getStatus();
      expect(status.generation).toBe(0); // 0-indexed, after 1 generation
      expect(status.populationSize).toBeGreaterThanOrEqual(1); // May be less due to selection
      expect(status.frontierSize).toBeGreaterThan(0);
    });
  });

  describe('Checkpoint resume', () => {
    it('should load checkpoint from VFS', async () => {
      // Create a checkpoint file
      const checkpoint = {
        generation: 2,
        timestamp: Date.now(),
        population: [
          { id: 'cand_1', content: 'Test prompt', generation: 2, scores: { accuracy: 0.8 }, dominatedBy: 0 }
        ],
        frontier: [
          { id: 'cand_1', content: 'Test prompt', generation: 2, scores: { accuracy: 0.8 }, dominatedBy: 0 }
        ],
        config: {
          populationSize: 2,
          maxGenerations: 3,
          objectives: ['accuracy', 'efficiency', 'robustness']
        }
      };

      fileStorage.set('/.memory/gepa/gen_2.json', JSON.stringify(checkpoint));

      const loaded = await gepaOptimizer.api.loadCheckpoint('/.memory/gepa/');
      expect(loaded).toBeDefined();
      expect(loaded.generation).toBe(2);
      expect(loaded.population.length).toBe(1);
    });

    it('should list available checkpoints', async () => {
      // Create multiple checkpoint files
      for (let i = 0; i < 3; i++) {
        fileStorage.set(`/.memory/gepa/gen_${i}.json`, JSON.stringify({
          generation: i,
          timestamp: Date.now() + i * 1000,
          population: [],
          frontier: []
        }));
      }

      const checkpoints = await gepaOptimizer.api.listCheckpoints('/.memory/gepa/');
      expect(checkpoints.length).toBe(3);
      expect(checkpoints[0].generation).toBe(0);
      expect(checkpoints[2].generation).toBe(2);
    });

    it('should resume evolution from checkpoint', async () => {
      // Create a checkpoint at generation 1 with proper targetType
      const checkpoint = {
        generation: 1,
        timestamp: Date.now(),
        population: [
          { id: 'cand_1', content: 'Test prompt 1', generation: 1, scores: { accuracy: 0.7, efficiency: 0.8, robustness: 0.9, cost: 0.8 }, dominatedBy: 0, targetType: 'prompt' },
          { id: 'cand_2', content: 'Test prompt 2', generation: 1, scores: { accuracy: 0.8, efficiency: 0.7, robustness: 0.85, cost: 0.75 }, dominatedBy: 0, targetType: 'prompt' }
        ],
        frontier: [
          { id: 'cand_2', content: 'Test prompt 2', generation: 1, scores: { accuracy: 0.8, efficiency: 0.7, robustness: 0.85, cost: 0.75 }, dominatedBy: 0, targetType: 'prompt' }
        ],
        config: {
          populationSize: 2,
          maxGenerations: 3,
          objectives: ['accuracy', 'efficiency', 'robustness', 'cost']
        }
      };

      fileStorage.set('/.memory/gepa/gen_1.json', JSON.stringify(checkpoint));

      mockLLMClient.chat.mockResolvedValue({ content: 'output', usage: { total_tokens: 50 } });

      const result = await gepaOptimizer.api.resumeEvolution(
        '/.memory/gepa/',
        [{ input: 'test', expected: 'output' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          evaluationBatchSize: 1
        }
      );

      expect(result.resumed).toBe(true);
      expect(result.resumedFromGeneration).toBe(1);
      expect(result.generations).toBeGreaterThanOrEqual(2);
    });

    it('should return complete message if already at max generations', async () => {
      const checkpoint = {
        generation: 4,
        timestamp: Date.now(),
        population: [{ id: 'c1', content: 'Final prompt', generation: 4, scores: {}, dominatedBy: 0 }],
        frontier: [{ id: 'c1', content: 'Final prompt', generation: 4, scores: {}, dominatedBy: 0 }],
        config: {
          populationSize: 2,
          maxGenerations: 5
        }
      };

      fileStorage.set('/.memory/gepa/gen_4.json', JSON.stringify(checkpoint));

      const result = await gepaOptimizer.api.resumeEvolution(
        '/.memory/gepa/',
        [{ input: 'test' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' }
        }
      );

      expect(result.resumed).toBe(true);
      expect(result.message).toBe('Evolution already complete');
    });
  });

  describe('Error classification', () => {
    it('should classify different error types', async () => {
      let callCount = 0;
      mockLLMClient.chat.mockImplementation(async () => {
        callCount++;
        // Return different outputs to trigger different error types
        const outputs = ['', 'partial match here', '{"invalid": json}', 'completely wrong'];
        return { content: outputs[callCount % outputs.length], usage: {} };
      });

      const result = await gepaOptimizer.api.evolve(
        'Test prompt',
        [
          { input: 'test1', expected: 'partial match here with more text' },
          { input: 'test2', expected: '{"valid": "json"}' },
          { input: 'test3', expected: 'correct output' }
        ],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 3
        }
      );

      // Should complete without error
      expect(result.generations).toBe(1);
    });
  });

  describe('Cost tracking', () => {
    it('should track token usage in scores', async () => {
      mockLLMClient.chat.mockResolvedValue({
        content: 'expected output',
        usage: { total_tokens: 500 }
      });

      const result = await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ input: 'test', expected: 'expected output' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      // Best candidate should have cost score
      expect(result.bestOverall.scores).toHaveProperty('cost');
      expect(result.bestOverall.scores.cost).toBeDefined();
    });
  });

  describe('Enhanced checkpoint data', () => {
    it('should save checkpoint with comprehensive metrics', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: { total_tokens: 100 } });

      await gepaOptimizer.api.evolve(
        'Prompt',
        [{ input: 'x', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          checkpointPath: '/.memory/gepa/',
          evaluationBatchSize: 1
        }
      );

      expect(fileStorage.has('/.memory/gepa/gen_0.json')).toBe(true);

      const checkpoint = JSON.parse(fileStorage.get('/.memory/gepa/gen_0.json'));

      // Verify enhanced checkpoint structure
      expect(checkpoint.metrics).toBeDefined();
      expect(checkpoint.metrics.bestScores).toBeDefined();
      expect(checkpoint.metrics.hypervolume).toBeDefined();
      expect(checkpoint.metrics.avgFitness).toBeDefined();
      expect(checkpoint.metrics.populationDiversity).toBeDefined();

      expect(checkpoint.cacheStats).toBeDefined();
      expect(checkpoint.cacheStats.reflectionCacheSize).toBeDefined();
      expect(checkpoint.cacheStats.evaluationCacheSize).toBeDefined();

      // Verify population has full metadata
      expect(checkpoint.population[0]).toHaveProperty('mutationType');
      expect(checkpoint.population[0]).toHaveProperty('parentIds');
    });

    it('should emit checkpoint saved event', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: {} });

      await gepaOptimizer.api.evolve(
        'Prompt',
        [{ input: 'x', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      const checkpointEvents = emittedEvents.filter(e => e.event === 'gepa:checkpoint:saved');
      expect(checkpointEvents.length).toBeGreaterThan(0);
      expect(checkpointEvents[0].data).toHaveProperty('generation');
      expect(checkpointEvents[0].data).toHaveProperty('frontierSize');
    });
  });

  describe('getStatistics()', () => {
    it('should return detailed statistics after evolution', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: { total_tokens: 50 } });

      await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ input: 'x', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1
        }
      );

      const stats = gepaOptimizer.api.getStatistics();

      expect(stats.generation).toBe(0);
      expect(stats.population.size).toBeGreaterThanOrEqual(1); // May be less due to selection
      expect(stats.population.diversity).toBeGreaterThanOrEqual(0);
      expect(stats.population.avgFitness).toBeGreaterThanOrEqual(0);
      expect(stats.frontier.size).toBeGreaterThan(0);
      expect(stats.frontier.hypervolume).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Evaluation caching', () => {
    it('should cache evaluation results when enabled', async () => {
      let callCount = 0;
      mockLLMClient.chat.mockImplementation(async () => {
        callCount++;
        return { content: 'out', usage: {} };
      });

      // First evolution run
      await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ id: 'task1', input: 'test', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 2,
          evaluationBatchSize: 1,
          cacheEvaluations: true
        }
      );

      const status = gepaOptimizer.api.getStatus();
      expect(status.evaluationCacheSize).toBeGreaterThan(0);
    });
  });

  describe('Reflection depth settings', () => {
    it('should use configured reflection depth', async () => {
      let reflectionPrompts = [];
      mockLLMClient.chat.mockImplementation(async (messages) => {
        if (messages[0]?.content?.includes('prompt engineer')) {
          reflectionPrompts.push(messages[0].content);
        }
        return { content: JSON.stringify({ rootCause: 'test', confidence: 0.8, modifications: [{ type: 'add', content: 'x', rationale: 'y', priority: 'high' }] }) };
      });

      await gepaOptimizer.api.evolve(
        'Bad prompt',
        [{ input: 'test', expected: 'different output' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1,
          reflectionDepth: 'comprehensive'
        }
      );

      // Check that comprehensive depth was used
      const comprehensivePrompt = reflectionPrompts.find(p => p.includes('systematically'));
      expect(comprehensivePrompt).toBeDefined();
    });
  });

  describe('Objective weights', () => {
    it('should apply custom objective weights', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: { total_tokens: 100 } });

      const result = await gepaOptimizer.api.evolve(
        'Test prompt',
        [{ input: 'x', expected: 'out' }],
        {
          evaluationModel: { id: 'test' },
          reflectionModel: { id: 'test' },
          populationSize: 2,
          maxGenerations: 1,
          evaluationBatchSize: 1,
          objectiveWeights: {
            accuracy: 2.0,  // Double weight on accuracy
            efficiency: 0.5,
            robustness: 1.0,
            cost: 0.5
          }
        }
      );

      // Evolution should complete successfully with custom weights
      expect(result.frontier.length).toBeGreaterThan(0);
    });
  });
});
