/**
 * @fileoverview Integration tests for ArenaHarness
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ArenaHarnessModule from '../../testing/arena/arena-harness.js';
import ArenaMetricsModule from '../../testing/arena/arena-metrics.js';

describe('ArenaHarness - Integration Tests', () => {
  let arenaHarness;
  let mockUtils;
  let mockEventBus;
  let mockVFSSandbox;
  let mockArenaCompetitor;
  let mockVerificationManager;
  let arenaMetrics;

  const createMocks = () => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix = 'id') => `${prefix}_test`),
      trunc: (str, len) => (str?.length > len ? str.slice(0, len) : str)
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    mockVFSSandbox = {
      createSnapshot: vi.fn().mockResolvedValue({ files: { '/core/a.js': 'const a = 1;' }, timestamp: 1 }),
      restoreSnapshot: vi.fn().mockResolvedValue(true),
      applyChanges: vi.fn().mockResolvedValue(true)
    };

    mockArenaCompetitor = {
      createCompetitor: vi.fn().mockImplementation((config) => ({
        propose: vi.fn().mockResolvedValue({
          competitorName: config.name,
          solution: config.solution || 'file: /core/a.js',
          executionMs: config.executionMs ?? 50,
          tokenCount: config.tokenCount ?? 10,
          model: config.modelConfig?.id || 'm1',
          provider: config.modelConfig?.provider || 'test'
        })
      }))
    };

    mockVerificationManager = {
      verifyProposal: vi.fn().mockResolvedValue({ passed: true, warnings: [] })
    };

    arenaMetrics = ArenaMetricsModule.factory({ Utils: mockUtils });

    arenaHarness = ArenaHarnessModule.factory({
      VFSSandbox: mockVFSSandbox,
      ArenaCompetitor: mockArenaCompetitor,
      ArenaMetrics: arenaMetrics,
      VerificationManager: mockVerificationManager,
      EventBus: mockEventBus,
      Utils: mockUtils
    });
  };

  beforeEach(() => {
    createMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs a single competitor and passes verification', async () => {
    const result = await arenaHarness.runCompetition({
      task: 'Fix issue',
      context: 'Context',
      competitors: [{ name: 'alpha', modelConfig: { id: 'm1' } }],
      parseChanges: () => ({ '/core/a.js': 'const a = 2;' })
    });

    expect(result.summary.passed).toBe(1);
    expect(result.results[0].status).toBe('PASS');
    expect(result.winner).toBe('alpha');
  });

  it('marks failures when verification fails', async () => {
    mockVerificationManager.verifyProposal.mockResolvedValueOnce({
      passed: false,
      errors: ['blocked']
    });

    const result = await arenaHarness.runCompetition({
      task: 'Bad change',
      context: 'Context',
      competitors: [{ name: 'beta', modelConfig: { id: 'm2' } }],
      parseChanges: () => ({ '/core/b.js': 'const b = 2;' })
    });

    expect(result.summary.passed).toBe(0);
    expect(result.results[0].status).toBe('FAIL');
    expect(result.winner).toBe(null);
  });

  it('ranks multiple competitors by execution time', async () => {
    const result = await arenaHarness.runCompetition({
      task: 'Optimize',
      context: 'Context',
      competitors: [
        { name: 'fast', modelConfig: { id: 'm1' }, executionMs: 20 },
        { name: 'slow', modelConfig: { id: 'm2' }, executionMs: 80 }
      ],
      parseChanges: () => ({ '/core/c.js': 'const c = 3;' })
    });

    expect(result.results[0].competitorName).toBe('fast');
    expect(result.summary.fastestPassing).toBe('fast');
  });

  it('flags proposal timeouts as errors', async () => {
    vi.useFakeTimers();

    mockArenaCompetitor.createCompetitor.mockImplementationOnce((config) => ({
      propose: () => new Promise(() => {})
    }));

    const promise = arenaHarness.runCompetition({
      task: 'Timeout case',
      context: 'Context',
      competitors: [{ name: 'timeout', modelConfig: { id: 'm3' } }],
      parseChanges: () => ({ '/core/d.js': 'const d = 4;' }),
      options: { timeout: 10 }
    });

    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;

    expect(result.results[0].status).toBe('ERROR');
    expect(result.results[0].errors[0]).toMatch(/timeout/i);
  });

  it('restores VFS snapshot between competitors', async () => {
    await arenaHarness.runCompetition({
      task: 'Isolation check',
      context: 'Context',
      competitors: [
        { name: 'one', modelConfig: { id: 'm1' } },
        { name: 'two', modelConfig: { id: 'm2' } }
      ],
      parseChanges: () => ({ '/core/e.js': 'const e = 5;' })
    });

    expect(mockVFSSandbox.restoreSnapshot).toHaveBeenCalledTimes(3);
    expect(mockVFSSandbox.applyChanges).toHaveBeenCalledTimes(2);
  });
});
