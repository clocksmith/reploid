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
      exists: vi.fn().mockImplementation((path) => Promise.resolve(fileStorage.has(path))),
      read: vi.fn().mockImplementation((path) => {
        if (fileStorage.has(path)) return Promise.resolve(fileStorage.get(path));
        return Promise.reject(new Error('File not found'));
      }),
      write: vi.fn().mockImplementation((path, content) => {
        fileStorage.set(path, content);
        return Promise.resolve(true);
      }),
      mkdir: vi.fn().mockResolvedValue(true)
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
      expect(status.populationSize).toBe(2);
      expect(status.frontierSize).toBeGreaterThan(0);
    });
  });
});
