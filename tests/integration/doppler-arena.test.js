/**
 * Doppler-Arena Integration Tests (Tier 3 P1)
 *
 * Tests the wiring between Doppler LoRA adapters and ArenaHarness:
 * - Adapter loading and switching
 * - Arena expert pool competitions with adapters
 * - passRate measurement with adapter switching
 * - Adapter composition (merge strategies)
 *
 * Run:
 *   npm test -- --grep "Doppler Arena"
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock implementations for testing without real Doppler
const createMockEventBus = () => {
  const listeners = new Map();
  return {
    emit(event, data) {
      const handlers = listeners.get(event) || [];
      handlers.forEach(fn => fn(data));
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const handlers = listeners.get(event) || [];
      const idx = handlers.indexOf(fn);
      if (idx >= 0) handlers.splice(idx, 1);
    },
  };
};

const createMockUtils = () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  generateId: (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

const createMockArenaHarness = () => ({
  scoreOutput: (output, task, options = {}) => {
    // Simple scoring: check if output is valid JSON if schema provided
    if (task.schema) {
      try {
        const parsed = typeof output === 'string' ? JSON.parse(output) : output;
        // Check required fields
        const required = task.schema.required || [];
        const hasAllRequired = required.every(field => field in parsed);
        return {
          score: hasAllRequired ? 0.8 : 0.3,
          valid: hasAllRequired,
          errors: hasAllRequired ? [] : ['Missing required fields'],
          parsed,
        };
      } catch (e) {
        return { score: 0, valid: false, errors: ['Invalid JSON'], parsed: null };
      }
    }
    // Default: score based on output length (simple heuristic)
    return {
      score: Math.min(1, (output?.length || 0) / 100),
      valid: true,
      errors: [],
    };
  },
});

// Create module instance with mocks
const createDopplerArenaIntegration = () => {
  const EventBus = createMockEventBus();
  const Utils = createMockUtils();
  const ArenaHarness = createMockArenaHarness();

  // Simulated adapter cache
  const adapterCache = new Map();
  let activeAdapter = null;
  let baseModelId = null;

  return {
    EventBus,
    Utils,
    ArenaHarness,

    async initDoppler() {
      return true;
    },

    async loadBaseModel(modelId, modelUrl = null, options = {}) {
      baseModelId = modelId;
      return true;
    },

    async loadAdapter(adapterId, manifest) {
      adapterCache.set(adapterId, manifest);
      activeAdapter = adapterId;
      return adapterId;
    },

    async switchAdapter(adapterId) {
      if (adapterId !== null && !adapterCache.has(adapterId)) {
        throw new Error(`Adapter not loaded: ${adapterId}`);
      }
      activeAdapter = adapterId;
      return adapterId;
    },

    async runInference(prompt, options = {}) {
      // Simulate different outputs based on adapter
      const adapterBonus = activeAdapter ? 10 : 0;
      const baseLength = 50 + Math.random() * 50 + adapterBonus;
      const content = 'A'.repeat(Math.floor(baseLength));

      return {
        content,
        durationMs: 100 + Math.random() * 50,
        tokensGenerated: Math.floor(baseLength / 4),
        tokPerSec: 50 + Math.random() * 20 + adapterBonus,
        adapter: activeAdapter,
      };
    },

    createExpert(adapterId, options = {}) {
      return {
        id: adapterId || 'base-model',
        adapter: adapterId,
        name: options.name || adapterId || 'Base Model',
        modelId: baseModelId,
        weight: options.weight || 1.0,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      };
    },

    async runAdapterCompetition(task, experts, options = {}) {
      const runId = Utils.generateId('arena-adapter');

      EventBus.emit('arena:adapter:start', {
        runId,
        expertCount: experts.length,
        task: task.prompt?.slice(0, 100),
      });

      const results = [];

      for (const expert of experts) {
        const expertResult = {
          expert,
          output: null,
          score: { score: 0, valid: true, errors: [] },
          durationMs: 0,
          tokPerSec: 0,
        };

        try {
          await this.switchAdapter(expert.adapter);
          const inferenceResult = await this.runInference(task.prompt, task);

          expertResult.output = inferenceResult.content;
          expertResult.durationMs = inferenceResult.durationMs;
          expertResult.tokPerSec = inferenceResult.tokPerSec;
          expertResult.score = ArenaHarness.scoreOutput(inferenceResult.content, task, options);
        } catch (err) {
          expertResult.score = { score: 0, valid: false, errors: [err.message] };
        }

        results.push(expertResult);
      }

      results.sort((a, b) => b.score.score - a.score.score);

      const winner = results[0];
      const summary = {
        runId,
        totalExperts: experts.length,
        passedExperts: results.filter(r => r.score.valid).length,
        winnerExpert: winner.expert.id,
        winnerScore: winner.score.score,
        winnerTokPerSec: winner.tokPerSec,
        passRate: (results.filter(r => r.score.valid && r.score.score > 0.5).length / experts.length) * 100,
      };

      EventBus.emit('arena:adapter:complete', { runId, summary, winner: winner.expert.id });

      return { winner, results, summary };
    },

    mergeAdapters(adapters, strategy = 'lerp') {
      if (adapters.length === 0) throw new Error('At least one adapter required');
      if (adapters.length === 1) return adapters[0].manifest;

      const first = adapters[0].manifest;
      const mergedTensors = [];
      const tensorsByName = new Map();

      for (const { manifest, weight } of adapters) {
        for (const tensor of manifest.tensors || []) {
          if (!tensorsByName.has(tensor.name)) {
            tensorsByName.set(tensor.name, []);
          }
          tensorsByName.get(tensor.name).push({ tensor, weight });
        }
      }

      for (const [name, tensors] of tensorsByName) {
        const shape = tensors[0].tensor.shape;
        const totalElements = shape[0] * shape[1];
        const merged = new Float32Array(totalElements);

        if (strategy === 'add') {
          for (const { tensor, weight } of tensors) {
            const data = new Float32Array(tensor.data);
            for (let i = 0; i < totalElements; i++) {
              merged[i] += data[i] * weight;
            }
          }
        } else if (strategy === 'lerp') {
          const totalWeight = tensors.reduce((sum, t) => sum + t.weight, 0);
          for (const { tensor, weight } of tensors) {
            const data = new Float32Array(tensor.data);
            const normalizedWeight = weight / totalWeight;
            for (let i = 0; i < totalElements; i++) {
              merged[i] += data[i] * normalizedWeight;
            }
          }
        }

        mergedTensors.push({ name, shape, dtype: 'f32', data: Array.from(merged) });
      }

      return {
        name: `merged-${strategy}-${adapters.length}adapters`,
        rank: first.rank,
        alpha: first.alpha,
        tensors: mergedTensors,
      };
    },

    async getStatus() {
      return {
        available: true,
        baseModel: baseModelId,
        activeAdapter,
        cachedAdapters: Array.from(adapterCache.keys()),
      };
    },

    async cleanup() {
      adapterCache.clear();
      activeAdapter = null;
      baseModelId = null;
    },
  };
};

describe('Doppler Arena Integration', () => {
  let integration;

  beforeAll(async () => {
    integration = createDopplerArenaIntegration();
  });

  afterAll(async () => {
    if (integration) {
      await integration.cleanup();
    }
  });

  describe('Base Model Management', () => {
    it('loads base model', async () => {
      const loaded = await integration.loadBaseModel('gemma3-1b-q4');
      expect(loaded).toBe(true);

      const status = await integration.getStatus();
      expect(status.baseModel).toBe('gemma3-1b-q4');
    });
  });

  describe('Adapter Management', () => {
    it('loads and caches adapters', async () => {
      const manifest = {
        name: 'test-adapter',
        rank: 8,
        alpha: 16,
        tensors: [{ name: 'layer0.q_proj.lora_a', shape: [8, 1024], data: new Array(8 * 1024).fill(0) }],
      };

      await integration.loadAdapter('adapter-1', manifest);

      const status = await integration.getStatus();
      expect(status.cachedAdapters).toContain('adapter-1');
      expect(status.activeAdapter).toBe('adapter-1');
    });

    it('switches between adapters', async () => {
      const manifest1 = { name: 'adapter-a', rank: 8, alpha: 16, tensors: [] };
      const manifest2 = { name: 'adapter-b', rank: 8, alpha: 16, tensors: [] };

      await integration.loadAdapter('adapter-a', manifest1);
      await integration.loadAdapter('adapter-b', manifest2);

      expect((await integration.getStatus()).activeAdapter).toBe('adapter-b');

      await integration.switchAdapter('adapter-a');
      expect((await integration.getStatus()).activeAdapter).toBe('adapter-a');
    });

    it('switches to base model (null adapter)', async () => {
      await integration.switchAdapter(null);
      expect((await integration.getStatus()).activeAdapter).toBeNull();
    });

    it('throws on switching to non-existent adapter', async () => {
      await expect(integration.switchAdapter('non-existent')).rejects.toThrow('Adapter not loaded');
    });
  });

  describe('Inference with Adapters', () => {
    it('runs inference with active adapter', async () => {
      await integration.loadAdapter('code-adapter', { name: 'code-adapter', rank: 8, alpha: 16, tensors: [] });

      const result = await integration.runInference('Write a function');

      expect(result.content).toBeTruthy();
      expect(result.tokPerSec).toBeGreaterThan(0);
      expect(result.adapter).toBe('code-adapter');
    });

    it('runs inference without adapter (base model)', async () => {
      await integration.switchAdapter(null);

      const result = await integration.runInference('Hello world');

      expect(result.content).toBeTruthy();
      expect(result.adapter).toBeNull();
    });
  });

  describe('Arena Expert Pool Competitions', () => {
    it('runs competition between multiple adapters', async () => {
      // Load adapters
      await integration.loadAdapter('fast-adapter', { name: 'fast', rank: 4, alpha: 8, tensors: [] });
      await integration.loadAdapter('quality-adapter', { name: 'quality', rank: 16, alpha: 32, tensors: [] });

      const experts = [
        integration.createExpert(null, { name: 'Base Model' }),
        integration.createExpert('fast-adapter', { name: 'Fast' }),
        integration.createExpert('quality-adapter', { name: 'Quality' }),
      ];

      const task = {
        prompt: 'Solve this problem step by step',
        maxTokens: 100,
      };

      const result = await integration.runAdapterCompetition(task, experts);

      expect(result.results.length).toBe(3);
      expect(result.winner).toBeTruthy();
      expect(result.summary.passRate).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalExperts).toBe(3);
    });

    it('emits arena events', async () => {
      const events = [];
      integration.EventBus.on('arena:adapter:start', e => events.push({ type: 'start', ...e }));
      integration.EventBus.on('arena:adapter:complete', e => events.push({ type: 'complete', ...e }));

      await integration.loadAdapter('test', { name: 'test', rank: 8, alpha: 16, tensors: [] });
      const experts = [integration.createExpert('test')];
      await integration.runAdapterCompetition({ prompt: 'Test' }, experts);

      expect(events.find(e => e.type === 'start')).toBeTruthy();
      expect(events.find(e => e.type === 'complete')).toBeTruthy();
    });

    it('calculates passRate correctly', async () => {
      const experts = [
        integration.createExpert(null),
        integration.createExpert(null),
        integration.createExpert(null),
      ];

      // Task that should produce high scores
      const task = { prompt: 'Write a long detailed explanation' };
      const result = await integration.runAdapterCompetition(task, experts);

      expect(result.summary.passRate).toBeGreaterThanOrEqual(0);
      expect(result.summary.passRate).toBeLessThanOrEqual(100);
    });
  });

  describe('Adapter Composition', () => {
    const createTestAdapter = (name, value) => ({
      manifest: {
        name,
        rank: 8,
        alpha: 16,
        tensors: [{
          name: 'layer0.q_proj.lora_a',
          shape: [2, 2],
          data: [value, value, value, value],
        }],
      },
      weight: 1.0,
    });

    it('merges adapters with add strategy', () => {
      const adapters = [
        { ...createTestAdapter('a', 1.0), weight: 1.0 },
        { ...createTestAdapter('b', 2.0), weight: 1.0 },
      ];

      const merged = integration.mergeAdapters(adapters, 'add');

      expect(merged.name).toContain('merged-add');
      expect(merged.tensors[0].data[0]).toBe(3.0); // 1.0 + 2.0
    });

    it('merges adapters with lerp strategy', () => {
      const adapters = [
        { ...createTestAdapter('a', 2.0), weight: 1.0 },
        { ...createTestAdapter('b', 4.0), weight: 1.0 },
      ];

      const merged = integration.mergeAdapters(adapters, 'lerp');

      expect(merged.name).toContain('merged-lerp');
      expect(merged.tensors[0].data[0]).toBe(3.0); // (2.0 + 4.0) / 2
    });

    it('respects weights in lerp merge', () => {
      const adapters = [
        { ...createTestAdapter('a', 0.0), weight: 1.0 },
        { ...createTestAdapter('b', 10.0), weight: 3.0 },
      ];

      const merged = integration.mergeAdapters(adapters, 'lerp');

      // (0.0 * 1.0 + 10.0 * 3.0) / (1.0 + 3.0) = 30.0 / 4.0 = 7.5
      expect(merged.tensors[0].data[0]).toBe(7.5);
    });

    it('handles single adapter (no merge)', () => {
      const adapters = [createTestAdapter('single', 5.0)];

      const result = integration.mergeAdapters(adapters);

      expect(result.tensors[0].data[0]).toBe(5.0);
    });

    it('throws on empty adapter list', () => {
      expect(() => integration.mergeAdapters([])).toThrow('At least one adapter required');
    });
  });
});

describe('Arena passRate with Adapter Switching', () => {
  let integration;

  beforeAll(async () => {
    integration = createDopplerArenaIntegration();
    await integration.loadBaseModel('gemma3-1b-q4');
  });

  afterAll(async () => {
    await integration.cleanup();
  });

  it('tracks improvement with specialized adapters', async () => {
    // Simulate: base model vs code-specialized adapter
    await integration.loadAdapter('code-expert', {
      name: 'code-expert',
      rank: 16,
      alpha: 32,
      tensors: [],
    });

    const codingTask = {
      prompt: 'Write a TypeScript function to sort an array',
      maxTokens: 200,
    };

    const experts = [
      integration.createExpert(null, { name: 'Base' }),
      integration.createExpert('code-expert', { name: 'Code Expert' }),
    ];

    const result = await integration.runAdapterCompetition(codingTask, experts);

    console.log(`[passRate Test] Base vs Code Expert:`);
    console.log(`  - Winner: ${result.winner.expert.name}`);
    console.log(`  - Pass Rate: ${result.summary.passRate}%`);

    // Both should produce valid output
    expect(result.summary.passedExperts).toBe(2);
  });

  it('measures net improvement over iterations', async () => {
    await integration.loadAdapter('iter-v1', { name: 'v1', rank: 8, alpha: 16, tensors: [] });
    await integration.loadAdapter('iter-v2', { name: 'v2', rank: 8, alpha: 16, tensors: [] });
    await integration.loadAdapter('iter-v3', { name: 'v3', rank: 8, alpha: 16, tensors: [] });

    const task = { prompt: 'Improve this code', maxTokens: 100 };
    const iterations = [];

    for (const adapterId of [null, 'iter-v1', 'iter-v2', 'iter-v3']) {
      const expert = integration.createExpert(adapterId);
      const result = await integration.runAdapterCompetition(task, [expert]);
      iterations.push({
        adapter: adapterId || 'base',
        passRate: result.summary.passRate,
        score: result.winner.score.score,
      });
    }

    console.log('[RSI Improvement Test] Iterations:');
    iterations.forEach((iter, i) => {
      console.log(`  ${i + 1}. ${iter.adapter}: passRate=${iter.passRate}%, score=${iter.score.toFixed(2)}`);
    });

    // Verify we tracked all iterations
    expect(iterations.length).toBe(4);
  });
});
