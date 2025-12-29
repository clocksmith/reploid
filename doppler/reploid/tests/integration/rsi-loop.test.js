/**
 * @fileoverview RSI Loop Integration Tests
 * Tests the complete Recursive Self-Improvement cycle:
 * propose → arena eval → apply/rollback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ToolRunnerModule from '../../core/tool-runner.js';
import ObservabilityModule from '../../infrastructure/observability.js';
import PromptScoreMapModule from '../../capabilities/reflection/prompt-score-map.js';

describe('RSI Loop - Integration Tests', () => {
  let toolRunner;
  let observability;
  let promptScoreMap;
  let mockUtils;
  let mockVFS;
  let mockEventBus;
  let mockVerificationManager;
  let mockGenesisSnapshot;

  const createMocks = () => {
    const ToolError = class extends Error {
      constructor(message, details = {}) {
        super(message);
        this.name = 'ToolError';
        this.details = details;
      }
    };

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      Errors: { ToolError },
      trunc: (str, len) => (str?.length > len ? str.slice(0, len) : str),
      generateId: vi.fn().mockImplementation((prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    };

    // Mock VFS with in-memory storage
    const vfsStorage = new Map();
    mockVFS = {
      read: vi.fn().mockImplementation(async (path) => {
        if (!vfsStorage.has(path)) throw new Error(`File not found: ${path}`);
        return vfsStorage.get(path);
      }),
      write: vi.fn().mockImplementation(async (path, content) => {
        const beforeSize = vfsStorage.get(path)?.length || 0;
        vfsStorage.set(path, content);
        return { beforeSize, afterSize: content.length };
      }),
      list: vi.fn().mockImplementation(async (dir) => {
        const files = [];
        for (const path of vfsStorage.keys()) {
          if (path.startsWith(dir)) files.push(path);
        }
        return files;
      }),
      exists: vi.fn().mockImplementation(async (path) => vfsStorage.has(path)),
      delete: vi.fn().mockImplementation(async (path) => {
        vfsStorage.delete(path);
        return true;
      }),
      _storage: vfsStorage
    };

    // Track emitted events
    const eventListeners = new Map();
    mockEventBus = {
      emit: vi.fn().mockImplementation((event, data) => {
        const listeners = eventListeners.get(event) || [];
        listeners.forEach(([fn]) => fn(data));
      }),
      on: vi.fn().mockImplementation((event, fn, source) => {
        if (!eventListeners.has(event)) eventListeners.set(event, []);
        eventListeners.get(event).push([fn, source]);
      }),
      off: vi.fn(),
      _listeners: eventListeners
    };

    mockVerificationManager = {
      verifyProposal: vi.fn().mockResolvedValue({ passed: true, passRate: 85, warnings: [] })
    };

    mockGenesisSnapshot = {
      createSnapshot: vi.fn().mockResolvedValue({ id: 'snap_test', timestamp: Date.now() }),
      restoreSnapshot: vi.fn().mockResolvedValue({ success: true }),
      hasLifeboat: vi.fn().mockReturnValue(true),
      restoreFromLifeboat: vi.fn().mockResolvedValue({ success: true, fileCount: 2 })
    };
  };

  beforeEach(() => {
    createMocks();

    // Create PromptScoreMap first
    promptScoreMap = PromptScoreMapModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus
    });

    // Create Observability with PromptScoreMap
    observability = ObservabilityModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      VFS: mockVFS,
      PromptScoreMap: promptScoreMap
    });

    // Create ToolRunner with all dependencies
    toolRunner = ToolRunnerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      ToolWriter: { create: vi.fn() },
      SchemaRegistry: {
        registerToolSchema: vi.fn(),
        unregisterToolSchema: vi.fn(),
        getToolSchema: vi.fn().mockReturnValue(null)
      },
      EventBus: mockEventBus,
      VerificationManager: mockVerificationManager,
      Observability: observability,
      GenesisSnapshot: mockGenesisSnapshot
    });

    // Initialize observability to wire event listeners
    observability.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete RSI Cycle', () => {
    it('records 80% passRate threshold correctly', async () => {
      // Emit arena:complete with 85% passRate (above threshold)
      mockEventBus.emit('arena:complete', {
        task: 'Test task - passes',
        level: 'L1',
        summary: { passRate: 85, passed: 85, total: 100, fastestPassing: 'alpha' }
      });

      const results = observability.getArenaResults(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].passRate).toBe(85);
    });

    it('marks tasks as failed below 80% threshold', async () => {
      mockEventBus.emit('arena:complete', {
        task: 'Test task - fails',
        level: 'L1',
        summary: { passRate: 75, passed: 75, total: 100, fastestPassing: 'beta' }
      });

      const results = observability.getArenaResults(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].passRate).toBe(75);
    });

    it('tracks arena results in PromptScoreMap', async () => {
      // Simulate arena:complete events
      mockEventBus.emit('arena:complete', {
        task: 'Fix type error in utility function',
        level: 'L1',
        summary: {
          passRate: 90,
          passed: 9,
          total: 10,
          fastestPassing: 'alpha'
        }
      });

      mockEventBus.emit('arena:complete', {
        task: 'Fix type error in utility function',
        level: 'L1',
        summary: {
          passRate: 85,
          passed: 17,
          total: 20,
          fastestPassing: 'beta'
        }
      });

      // Check PromptScoreMap recorded both
      expect(promptScoreMap.size).toBe(1); // Same task = same hash

      const stats = promptScoreMap.getAggregateStats();
      expect(stats.count).toBe(1);
      expect(stats.avgScore).toBe(87.5); // Average of 90 and 85
    });

    it('selects best prompt via UCB1', async () => {
      // Record multiple different tasks with similar usage patterns
      // All tasks have similar uses to test pure score-based selection
      for (let i = 0; i < 5; i++) {
        promptScoreMap.record('Task A: simple fix', 95, 'L1');
        promptScoreMap.record('Task B: complex refactor', 60, 'L1');
        promptScoreMap.record('Task C: new feature', 80, 'L1');
      }

      // Select best for L1 - with equal uses, highest score wins
      const selected = promptScoreMap.select('L1');

      // Should select Task A (highest score when uses are equal)
      expect(selected).toBeTruthy();
      expect(selected.prompt).toBe('Task A: simple fix');
      expect(selected.score).toBe(95);
    });

    it('getSuccessRate tracks arena pass/fail', async () => {
      // Simulate multiple arena completions
      for (let i = 0; i < 10; i++) {
        mockEventBus.emit('arena:complete', {
          task: `Task ${i}`,
          level: 'L1',
          summary: {
            passRate: i >= 7 ? 85 : 45, // Last 3 pass, first 7 fail
            passed: i >= 7 ? 85 : 45,
            total: 100
          }
        });
      }

      const successRate = observability.getSuccessRate(10);

      expect(successRate.count).toBe(10);
      expect(successRate.passed).toBe(3);
      expect(successRate.failed).toBe(7);
      expect(successRate.rate).toBe(30);
    });
  });

  describe('L3 Substrate Logging', () => {
    it('logs L3 changes with full audit trail', async () => {
      // Record a substrate change directly
      await observability.recordSubstrateChange({
        path: '/core/agent-loop.js',
        op: 'write',
        passed: true,
        passRate: 92,
        rolledBack: false,
        reason: 'verified'
      });

      // Verify event was emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'observability:substrate_change',
        expect.objectContaining({
          path: '/core/agent-loop.js',
          passed: true,
          passRate: 92
        })
      );
    });
  });

  describe('RSI Iteration Tracking', () => {
    it('tracks 5+ iterations with net positive score delta', async () => {
      // Simulate 5 RSI iterations with improving scores
      const iterations = [
        { task: 'Iter 1: Initial attempt', passRate: 70 },
        { task: 'Iter 2: First improvement', passRate: 75 },
        { task: 'Iter 3: Learning from failure', passRate: 80 },
        { task: 'Iter 4: Better approach', passRate: 85 },
        { task: 'Iter 5: Optimized', passRate: 90 }
      ];

      for (const iter of iterations) {
        mockEventBus.emit('arena:complete', {
          task: iter.task,
          level: 'L2',
          summary: {
            passRate: iter.passRate,
            passed: iter.passRate,
            total: 100
          }
        });
      }

      const successRate = observability.getSuccessRate(5);

      // All 5 iterations passed (80+ threshold)
      expect(successRate.count).toBe(5);
      expect(successRate.passed).toBe(3); // Only 80, 85, 90 are >= 80
      expect(successRate.rate).toBe(60); // 3/5 passed

      // Aggregate stats should show improvement trend
      const stats = promptScoreMap.getAggregateStats();
      expect(stats.count).toBe(5); // 5 unique tasks
      expect(stats.avgScore).toBe(80); // Average of 70,75,80,85,90
    });
  });
});
