/**
 * @fileoverview Unit tests for GEPA Engine components
 * Tests EvaluationEngine, ReflectionEngine, and NSGAEngine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GEPAOptimizerModule from '../../capabilities/cognition/gepa-optimizer.js';

describe('GEPA Engines - Unit Tests', () => {
  let gepaOptimizer;
  let mockLLMClient;
  let mockEventBus;
  let mockUtils;
  let mockVFS;
  let fileStorage;
  let idCounter;
  let EvaluationEngine;
  let ReflectionEngine;
  let NSGAEngine;

  const createMocks = () => {
    fileStorage = new Map();
    idCounter = 0;

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
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue('{}'),
      write: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(true),
      readdir: vi.fn().mockResolvedValue([])
    };

    mockEventBus = {
      emit: vi.fn(),
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

    // Extract engines from the factory result
    EvaluationEngine = gepaOptimizer.engines.EvaluationEngine;
    ReflectionEngine = gepaOptimizer.engines.ReflectionEngine;
    NSGAEngine = gepaOptimizer.engines.NSGAEngine;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('EvaluationEngine', () => {
    describe('computeScores()', () => {
      it('should compute accuracy from success count', () => {
        const traces = [
          { success: true, latencyMs: 100, tokenCount: 50, errorType: null },
          { success: true, latencyMs: 150, tokenCount: 60, errorType: null },
          { success: false, latencyMs: 200, tokenCount: 70, errorType: 'mismatch' }
        ];

        const scores = EvaluationEngine.computeScores(traces, {});

        expect(scores.accuracy).toBeCloseTo(2 / 3, 2);
      });

      it('should compute efficiency from latency', () => {
        const traces = [
          { success: true, latencyMs: 1000, tokenCount: 50 },
          { success: true, latencyMs: 2000, tokenCount: 60 }
        ];

        const scores = EvaluationEngine.computeScores(traces, {});

        // avgLatency = 1500ms, efficiency = 1 - (1500/10000) = 0.85
        expect(scores.efficiency).toBeCloseTo(0.85, 2);
      });

      it('should compute robustness from execution errors', () => {
        const traces = [
          { success: true, latencyMs: 100, errorType: null },
          { success: false, latencyMs: 100, errorType: 'execution_error' },
          { success: false, latencyMs: 100, errorType: 'mismatch' }
        ];

        const scores = EvaluationEngine.computeScores(traces, {});

        // 1 execution error out of 3, robustness = 1 - (1/3) = 0.667
        expect(scores.robustness).toBeCloseTo(2 / 3, 2);
      });

      it('should compute cost from token usage', () => {
        const traces = [
          { success: true, tokenCount: 300 },
          { success: true, tokenCount: 400 }
        ];

        const scores = EvaluationEngine.computeScores(traces, {});

        // totalTokens = 700, cost = 1 - (700 / (2 * 1000)) = 0.65
        expect(scores.cost).toBeCloseTo(0.65, 2);
      });
    });

    describe('computeMetrics()', () => {
      it('should compute detailed metrics from traces', () => {
        const traces = [
          { success: true, latencyMs: 100, tokenCount: 50, errorType: null },
          { success: false, latencyMs: 200, tokenCount: 60, errorType: 'mismatch' },
          { success: false, latencyMs: 150, tokenCount: 55, errorType: 'mismatch' }
        ];

        const metrics = EvaluationEngine.computeMetrics(traces);

        expect(metrics.totalTokens).toBe(165);
        expect(metrics.avgLatency).toBeCloseTo(150, 0);
        expect(metrics.minLatency).toBe(100);
        expect(metrics.maxLatency).toBe(200);
        expect(metrics.successRate).toBeCloseTo(1 / 3, 2);
        expect(metrics.errorTypeCounts.mismatch).toBe(2);
      });

      it('should track cache hit rate', () => {
        const traces = [
          { success: true, fromCache: true },
          { success: true, fromCache: true },
          { success: true, fromCache: false }
        ];

        const metrics = EvaluationEngine.computeMetrics(traces);

        expect(metrics.cacheHitRate).toBeCloseTo(2 / 3, 2);
      });
    });

    describe('countErrorTypes()', () => {
      it('should count error types correctly', () => {
        const failedTraces = [
          { errorType: 'mismatch' },
          { errorType: 'mismatch' },
          { errorType: 'format_error' },
          { errorType: 'empty_response' }
        ];

        const counts = EvaluationEngine.countErrorTypes(failedTraces);

        expect(counts.mismatch).toBe(2);
        expect(counts.format_error).toBe(1);
        expect(counts.empty_response).toBe(1);
      });

      it('should handle unknown error types', () => {
        const failedTraces = [
          { errorType: null },
          { errorType: undefined }
        ];

        const counts = EvaluationEngine.countErrorTypes(failedTraces);

        expect(counts.unknown).toBe(2);
      });
    });
  });

  describe('ReflectionEngine', () => {
    describe('groupFailuresByType()', () => {
      it('should group failures by error type', () => {
        const evaluationResults = [
          {
            candidate: { id: 'c1', content: 'prompt1' },
            traces: [
              { success: false, errorType: 'mismatch', input: 'test1' },
              { success: false, errorType: 'format_error', input: 'test2' }
            ]
          },
          {
            candidate: { id: 'c2', content: 'prompt2' },
            traces: [
              { success: true },
              { success: false, errorType: 'mismatch', input: 'test3' }
            ]
          }
        ];

        const groups = ReflectionEngine.groupFailuresByType(evaluationResults);

        expect(groups.mismatch.length).toBe(2);
        expect(groups.format_error.length).toBe(1);
      });
    });

    describe('validateReflection()', () => {
      it('should validate valid reflection structure', () => {
        const reflection = {
          rootCause: 'Prompt lacks specificity',
          confidence: 0.8,
          modifications: [
            { type: 'add', content: 'Be specific', rationale: 'test' }
          ]
        };

        expect(ReflectionEngine.validateReflection(reflection)).toBe(true);
      });

      it('should reject reflection without rootCause', () => {
        const reflection = {
          modifications: [{ type: 'add', content: 'test' }]
        };

        expect(ReflectionEngine.validateReflection(reflection)).toBe(false);
      });

      it('should reject reflection with empty modifications', () => {
        const reflection = {
          rootCause: 'Some cause',
          modifications: []
        };

        expect(ReflectionEngine.validateReflection(reflection)).toBe(false);
      });

      it('should reject modification without type or content', () => {
        const reflection = {
          rootCause: 'Some cause',
          modifications: [{ target: 'end' }]
        };

        expect(ReflectionEngine.validateReflection(reflection)).toBe(false);
      });
    });

    describe('getErrorGuidance()', () => {
      it('should return specific guidance for known error types', () => {
        const guidance = ReflectionEngine.getErrorGuidance('empty_response');
        expect(guidance).toContain('no output');
      });

      it('should return generic guidance for unknown types', () => {
        const guidance = ReflectionEngine.getErrorGuidance('completely_unknown_type');
        expect(guidance).toContain('holistically');
      });
    });

    describe('getReflectionSystemPrompt()', () => {
      it('should return basic prompt for basic depth', () => {
        const prompt = ReflectionEngine.getReflectionSystemPrompt({ reflectionDepth: 'basic' });
        expect(prompt.length).toBeLessThan(100);
      });

      it('should return detailed prompt for detailed depth', () => {
        const prompt = ReflectionEngine.getReflectionSystemPrompt({ reflectionDepth: 'detailed' });
        expect(prompt).toContain('expert');
      });

      it('should return comprehensive prompt for comprehensive depth', () => {
        const prompt = ReflectionEngine.getReflectionSystemPrompt({ reflectionDepth: 'comprehensive' });
        expect(prompt).toContain('systematically');
        expect(prompt).toContain('model limitations');
      });
    });
  });

  describe('NSGAEngine', () => {
    describe('checkDominance()', () => {
      it('should detect when A dominates B', () => {
        const a = { scores: { accuracy: 0.9, efficiency: 0.8 } };
        const b = { scores: { accuracy: 0.7, efficiency: 0.6 } };

        const result = NSGAEngine.checkDominance(a, b, ['accuracy', 'efficiency']);

        expect(result).toBe(1); // A dominates
      });

      it('should detect when B dominates A', () => {
        const a = { scores: { accuracy: 0.5, efficiency: 0.5 } };
        const b = { scores: { accuracy: 0.9, efficiency: 0.9 } };

        const result = NSGAEngine.checkDominance(a, b, ['accuracy', 'efficiency']);

        expect(result).toBe(-1); // B dominates
      });

      it('should detect non-dominance (Pareto optimal)', () => {
        const a = { scores: { accuracy: 0.9, efficiency: 0.5 } }; // Better accuracy
        const b = { scores: { accuracy: 0.5, efficiency: 0.9 } }; // Better efficiency

        const result = NSGAEngine.checkDominance(a, b, ['accuracy', 'efficiency']);

        expect(result).toBe(0); // Neither dominates
      });

      it('should apply weights in dominance check', () => {
        const a = { scores: { accuracy: 0.8, efficiency: 0.6 } };
        const b = { scores: { accuracy: 0.7, efficiency: 0.7 } };
        const weights = { accuracy: 2.0, efficiency: 1.0 }; // accuracy weighted 2x

        // With weights: A = (0.8*2, 0.6*1), B = (0.7*2, 0.7*1)
        // A is better in weighted accuracy, worse in efficiency
        const result = NSGAEngine.checkDominance(a, b, ['accuracy', 'efficiency'], weights);

        expect(result).toBe(0); // Neither dominates with these weights
      });
    });

    describe('calculateCrowdingDistance()', () => {
      it('should assign infinite distance to boundary solutions', () => {
        const front = [
          { scores: { accuracy: 0.5, efficiency: 0.9 } },
          { scores: { accuracy: 0.7, efficiency: 0.7 } },
          { scores: { accuracy: 0.9, efficiency: 0.5 } }
        ];

        NSGAEngine.calculateCrowdingDistance(front, ['accuracy', 'efficiency']);

        // First and last in sorted order should have Infinity
        const infiniteCount = front.filter(c => c.crowdingDistance === Infinity).length;
        expect(infiniteCount).toBeGreaterThanOrEqual(2);
      });

      it('should handle small fronts', () => {
        const front = [
          { scores: { accuracy: 0.5 } },
          { scores: { accuracy: 0.9 } }
        ];

        NSGAEngine.calculateCrowdingDistance(front, ['accuracy']);

        // Both should have Infinity for a 2-element front
        expect(front[0].crowdingDistance).toBe(Infinity);
        expect(front[1].crowdingDistance).toBe(Infinity);
      });
    });

    describe('select()', () => {
      it('should select top candidates by Pareto rank', () => {
        const candidates = [
          { id: 'c1', scores: { accuracy: 0.9, efficiency: 0.9 } }, // Rank 0
          { id: 'c2', scores: { accuracy: 0.8, efficiency: 0.7 } }, // Rank 1
          { id: 'c3', scores: { accuracy: 0.7, efficiency: 0.8 } }, // Rank 1
          { id: 'c4', scores: { accuracy: 0.5, efficiency: 0.5 } }  // Rank 2
        ];

        const selected = NSGAEngine.select(candidates, ['accuracy', 'efficiency'], 2);

        expect(selected.length).toBe(2);
        expect(selected[0].id).toBe('c1'); // Best candidate
      });

      it('should use crowding distance for tie-breaking', () => {
        // Three non-dominated candidates, select 2
        const candidates = [
          { id: 'c1', scores: { accuracy: 0.9, efficiency: 0.1 } },
          { id: 'c2', scores: { accuracy: 0.5, efficiency: 0.5 } },
          { id: 'c3', scores: { accuracy: 0.1, efficiency: 0.9 } }
        ];

        const selected = NSGAEngine.select(candidates, ['accuracy', 'efficiency'], 2);

        expect(selected.length).toBe(2);
        // Boundary solutions (c1 and c3) should be preferred due to infinite crowding distance
        const selectedIds = selected.map(c => c.id);
        expect(selectedIds).toContain('c1');
        expect(selectedIds).toContain('c3');
      });

      it('should assign ranks to candidates', () => {
        const candidates = [
          { id: 'c1', scores: { accuracy: 0.9, efficiency: 0.9 } },
          { id: 'c2', scores: { accuracy: 0.5, efficiency: 0.5 } }
        ];

        NSGAEngine.select(candidates, ['accuracy', 'efficiency'], 2);

        expect(candidates[0].rank).toBe(0);
        expect(candidates[1].rank).toBe(1);
      });
    });

    describe('computeCompositeFitness()', () => {
      it('should compute weighted average of scores', () => {
        const candidate = { scores: { accuracy: 0.8, efficiency: 0.6 } };
        const weights = { accuracy: 2.0, efficiency: 1.0 };

        const fitness = NSGAEngine.computeCompositeFitness(
          candidate,
          ['accuracy', 'efficiency'],
          weights
        );

        // (0.8*2 + 0.6*1) / (2+1) = 2.2/3 = 0.733
        expect(fitness).toBeCloseTo(0.733, 2);
      });

      it('should use default weight of 1 for unspecified objectives', () => {
        const candidate = { scores: { accuracy: 0.8, efficiency: 0.6 } };

        const fitness = NSGAEngine.computeCompositeFitness(
          candidate,
          ['accuracy', 'efficiency'],
          {}
        );

        // (0.8*1 + 0.6*1) / (1+1) = 0.7
        expect(fitness).toBeCloseTo(0.7, 2);
      });
    });

    describe('checkConvergence()', () => {
      it('should return false when improvement exceeds threshold', () => {
        const current = { accuracy: 0.9, efficiency: 0.8 };
        const previous = { accuracy: 0.7, efficiency: 0.7 };

        const converged = NSGAEngine.checkConvergence(
          current, previous, ['accuracy', 'efficiency'], 0.05
        );

        expect(converged).toBe(false);
      });

      it('should return true when no significant improvement', () => {
        const current = { accuracy: 0.91, efficiency: 0.81 };
        const previous = { accuracy: 0.90, efficiency: 0.80 };

        const converged = NSGAEngine.checkConvergence(
          current, previous, ['accuracy', 'efficiency'], 0.05
        );

        expect(converged).toBe(true);
      });

      it('should return false when no previous best exists', () => {
        const current = { accuracy: 0.9 };

        const converged = NSGAEngine.checkConvergence(
          current, null, ['accuracy'], 0.05
        );

        expect(converged).toBe(false);
      });
    });

    describe('computeHypervolume()', () => {
      it('should compute hypervolume from frontier', () => {
        const front = [
          { scores: { accuracy: 0.8, efficiency: 0.6 } },
          { scores: { accuracy: 0.6, efficiency: 0.8 } }
        ];

        const hv = NSGAEngine.computeHypervolume(front, ['accuracy', 'efficiency']);

        // Sum of (accuracy * efficiency) for each point
        // 0.8*0.6 + 0.6*0.8 = 0.48 + 0.48 = 0.96
        expect(hv).toBeCloseTo(0.96, 2);
      });

      it('should return 0 for empty frontier', () => {
        const hv = NSGAEngine.computeHypervolume([], ['accuracy']);
        expect(hv).toBe(0);
      });
    });
  });

  describe('API Integration', () => {
    describe('getStatus()', () => {
      it('should return initial status', () => {
        const status = gepaOptimizer.api.getStatus();

        expect(status.generation).toBe(0);
        expect(status.populationSize).toBe(0);
        expect(status.frontierSize).toBe(0);
        expect(status.reflectionCount).toBe(0);
        expect(status.evaluationCacheSize).toBe(0);
      });
    });

    describe('getStatistics()', () => {
      it('should return detailed statistics', () => {
        const stats = gepaOptimizer.api.getStatistics();

        expect(stats).toHaveProperty('generation');
        expect(stats).toHaveProperty('population');
        expect(stats).toHaveProperty('frontier');
        expect(stats).toHaveProperty('caches');
        expect(stats).toHaveProperty('convergence');
      });
    });

    describe('clearCaches()', () => {
      it('should clear all caches', () => {
        // Run a quick evolution to populate caches
        mockLLMClient.chat.mockResolvedValue({ content: 'out', usage: {} });

        gepaOptimizer.api.clearCaches();

        const status = gepaOptimizer.api.getStatus();
        expect(status.evaluationCacheSize).toBe(0);
        expect(status.reflectionCount).toBe(0);
      });
    });
  });
});
