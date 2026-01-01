/**
 * @fileoverview Unit tests for Observability module
 * Tests mutation stream, decision trace, token tracking, and dashboard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ObservabilityModule from '../../infrastructure/observability.js';

describe('Observability', () => {
  let observability;
  let mockUtils;
  let mockEventBus;
  let mockVFS;

  const createMocks = () => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix = 'id') => `${prefix}_${Date.now()}`),
      trunc: (str, len) => (str?.length > len ? str.slice(0, len) + '...' : str)
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    mockVFS = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue(''),
      write: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([])
    };

    observability = ObservabilityModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      VFS: mockVFS
    });
  };

  beforeEach(() => {
    createMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Mutation Stream', () => {
    it('records mutations with all fields', async () => {
      const entry = await observability.recordMutation('/core/test.js', 'write', 100, 150);

      expect(entry).toBeDefined();
      expect(entry.path).toBe('/core/test.js');
      expect(entry.op).toBe('write');
      expect(entry.beforeBytes).toBe(100);
      expect(entry.afterBytes).toBe(150);
      expect(entry.id).toMatch(/^mut_/);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('emits mutation event to EventBus', async () => {
      await observability.recordMutation('/tools/MyTool.js', 'create', 0, 500);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'observability:mutation',
        expect.objectContaining({
          path: '/tools/MyTool.js',
          op: 'create'
        })
      );
    });

    it('ignores mutations to log directories', async () => {
      const result = await observability.recordMutation('/.logs/mutations/2024-01-01.jsonl', 'write', 0, 100);

      expect(result).toBeNull();
    });

    it('retrieves recent mutations with limit', async () => {
      await observability.recordMutation('/a.js', 'write', 0, 10);
      await observability.recordMutation('/b.js', 'write', 0, 20);
      await observability.recordMutation('/c.js', 'write', 0, 30);

      const mutations = observability.getMutations(2);

      expect(mutations).toHaveLength(2);
      expect(mutations[0].path).toBe('/b.js');
      expect(mutations[1].path).toBe('/c.js');
    });

    it('accepts object-style mutation recording', async () => {
      const entry = await observability.recordMutation({
        path: '/core/agent.js',
        op: 'modify',
        beforeBytes: 1000,
        afterBytes: 1200,
        source: 'tool'
      });

      expect(entry.path).toBe('/core/agent.js');
      expect(entry.op).toBe('modify');
      expect(entry.source).toBe('tool');
    });
  });

  describe('Decision Trace', () => {
    it('records decisions with all fields', async () => {
      const entry = await observability.recordDecision(
        'Complete task X',
        'User asked for feature Y',
        'Need to modify file Z because of constraint W',
        'WriteFile'
      );

      expect(entry).toBeDefined();
      expect(entry.goal).toBe('Complete task X');
      expect(entry.context).toBe('User asked for feature Y');
      expect(entry.reasoning).toContain('Need to modify file Z');
      expect(entry.action).toBe('WriteFile');
      expect(entry.id).toMatch(/^dec_/);
    });

    it('emits decision event to EventBus', async () => {
      await observability.recordDecision('Goal', 'Context', 'Reasoning', 'Action');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'observability:decision',
        expect.objectContaining({
          goal: 'Goal',
          action: 'Action'
        })
      );
    });

    it('persists decisions to VFS JSONL', async () => {
      await observability.recordDecision('Goal', 'Context', 'Reasoning', 'Action');

      expect(mockVFS.write).toHaveBeenCalled();
      const writeCall = mockVFS.write.mock.calls[0];
      expect(writeCall[0]).toMatch(/\/.logs\/decisions\/.*\.jsonl$/);
    });

    it('retrieves recent decisions with limit', async () => {
      await observability.recordDecision('Goal 1', 'Ctx 1', 'R1', 'A1');
      await observability.recordDecision('Goal 2', 'Ctx 2', 'R2', 'A2');
      await observability.recordDecision('Goal 3', 'Ctx 3', 'R3', 'A3');

      const decisions = observability.getDecisions(2);

      expect(decisions).toHaveLength(2);
      expect(decisions[0].goal).toBe('Goal 2');
      expect(decisions[1].goal).toBe('Goal 3');
    });

    it('accepts object-style decision recording', async () => {
      const entry = await observability.recordDecision({
        goal: 'Implement feature',
        context: 'User request',
        reasoning: 'Best approach is X',
        action: 'CreateTool',
        model: 'gpt-4',
        provider: 'openai',
        cycle: 5
      });

      expect(entry.goal).toBe('Implement feature');
      expect(entry.model).toBe('gpt-4');
      expect(entry.cycle).toBe(5);
    });

    it('truncates long context and reasoning', async () => {
      const longString = 'x'.repeat(3000);

      const entry = await observability.recordDecision('Goal', longString, longString, 'Action');

      expect(entry.context.length).toBeLessThanOrEqual(2003); // 2000 + '...'
      expect(entry.reasoning.length).toBeLessThanOrEqual(2003);
    });
  });

  describe('Token Tracking', () => {
    it('records token usage', () => {
      observability.recordTokens({
        model: 'gpt-4',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50
      });

      const usage = observability.getTokenUsage();

      expect(usage.session.input).toBe(100);
      expect(usage.session.output).toBe(50);
      expect(usage.session.total).toBe(150);
      expect(usage.byModel['gpt-4']).toBeDefined();
      expect(usage.byModel['gpt-4'].calls).toBe(1);
    });

    it('accumulates tokens across calls', () => {
      observability.recordTokens({ model: 'gpt-4', inputTokens: 100, outputTokens: 50 });
      observability.recordTokens({ model: 'gpt-4', inputTokens: 200, outputTokens: 100 });

      const usage = observability.getTokenUsage();

      expect(usage.session.total).toBe(450);
      expect(usage.byModel['gpt-4'].calls).toBe(2);
    });

    it('tracks tokens by model', () => {
      observability.recordTokens({ model: 'gpt-4', inputTokens: 100, outputTokens: 50 });
      observability.recordTokens({ model: 'claude-3-sonnet', inputTokens: 80, outputTokens: 40 });

      const usage = observability.getTokenUsage();

      expect(Object.keys(usage.byModel)).toHaveLength(2);
      expect(usage.byModel['gpt-4'].total).toBe(150);
      expect(usage.byModel['claude-3-sonnet'].total).toBe(120);
    });

    it('estimates cost per model', () => {
      const cost = observability.estimateCost('gpt-4', 1000, 500);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBe((1000 / 1000) * 0.03 + (500 / 1000) * 0.06);
    });

    it('emits token event to EventBus', () => {
      observability.recordTokens({ model: 'gpt-4', inputTokens: 100, outputTokens: 50 });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'observability:tokens',
        expect.objectContaining({
          session: expect.any(Object),
          latest: expect.objectContaining({ model: 'gpt-4' })
        })
      );
    });
  });

  describe('Arena Results & Success Rate', () => {
    it('records arena results', () => {
      const result = observability.recordArenaResult({
        passed: true,
        passRate: 100,
        task: 'Fix bug',
        level: 'L1',
        competitorCount: 3
      });

      expect(result.id).toMatch(/^arena_/);
      expect(result.passed).toBe(true);
      expect(result.passRate).toBe(100);
    });

    it('calculates success rate over window', () => {
      // 3 passed, 2 failed
      observability.recordArenaResult({ passed: true });
      observability.recordArenaResult({ passed: true });
      observability.recordArenaResult({ passed: false });
      observability.recordArenaResult({ passed: true });
      observability.recordArenaResult({ passed: false });

      const rate = observability.getSuccessRate(5);

      expect(rate.count).toBe(5);
      expect(rate.passed).toBe(3);
      expect(rate.failed).toBe(2);
      expect(rate.rate).toBe(60);
    });

    it('retrieves recent arena results', () => {
      observability.recordArenaResult({ passed: true, task: 'Task 1' });
      observability.recordArenaResult({ passed: false, task: 'Task 2' });

      const results = observability.getArenaResults(10);

      expect(results).toHaveLength(2);
    });
  });

  describe('L3 Substrate Changes', () => {
    it('identifies substrate paths', () => {
      expect(observability.isSubstrateChange('/core/agent-loop.js')).toBe(true);
      expect(observability.isSubstrateChange('/infrastructure/event-bus.js')).toBe(true);
      expect(observability.isSubstrateChange('/tools/MyTool.js')).toBe(false);
      expect(observability.isSubstrateChange('/ui/dashboard.js')).toBe(false);
    });

    it('records substrate changes with persistence', async () => {
      const entry = await observability.recordSubstrateChange({
        path: '/core/llm-client.js',
        op: 'write',
        passed: true,
        passRate: 100,
        rolledBack: false,
        reason: 'verified'
      });

      expect(entry.path).toBe('/core/llm-client.js');
      expect(entry.passed).toBe(true);
      expect(mockVFS.write).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'observability:substrate_change',
        expect.any(Object)
      );
    });
  });

  describe('Dashboard', () => {
    it('returns aggregated dashboard data', async () => {
      // Add some data
      await observability.recordMutation('/test.js', 'write', 0, 100);
      await observability.recordDecision('Goal', 'Ctx', 'Reason', 'Action');
      observability.recordTokens({ model: 'gpt-4', inputTokens: 100, outputTokens: 50 });
      observability.recordArenaResult({ passed: true });

      const dashboard = observability.getDashboard();

      expect(dashboard.tokens).toBeDefined();
      expect(dashboard.tokens.session.total).toBe(150);
      expect(dashboard.mutations.total).toBe(1);
      expect(dashboard.decisions.total).toBe(1);
      expect(dashboard.arena.total).toBe(1);
    });

    it('includes recent items in dashboard', async () => {
      await observability.recordMutation('/a.js', 'write', 0, 10);
      await observability.recordMutation('/b.js', 'write', 0, 20);

      const dashboard = observability.getDashboard();

      expect(dashboard.mutations.recent).toHaveLength(2);
    });
  });

  describe('Event Bus Wiring', () => {
    it('initializes and wires EventBus listeners', async () => {
      await observability.init();

      // Check that event listeners were registered
      expect(mockEventBus.on).toHaveBeenCalledWith('vfs:file_changed', expect.any(Function), 'Observability');
      expect(mockEventBus.on).toHaveBeenCalledWith('agent:decision', expect.any(Function), 'Observability');
      expect(mockEventBus.on).toHaveBeenCalledWith('llm:complete', expect.any(Function), 'Observability');
      expect(mockEventBus.on).toHaveBeenCalledWith('arena:complete', expect.any(Function), 'Observability');
    });
  });
});
