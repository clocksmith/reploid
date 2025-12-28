/**
 * @fileoverview Integration tests for ReplayEngine
 * Tests session loading, re-execution, checkpointing, and comparison
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReplayEngineModule from '../../infrastructure/replay-engine.js';

describe('ReplayEngine - Integration Tests', () => {
  let replayEngine;
  let mockUtils;
  let mockEventBus;
  let mockVFS;
  let mockAuditLogger;
  let mockVFSSandbox;
  let mockToolRunner;
  let mockLLMClient;
  let emittedEvents;

  const createMocks = () => {
    emittedEvents = [];

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    };

    mockEventBus = {
      emit: vi.fn().mockImplementation((event, data) => {
        emittedEvents.push({ event, data });
      }),
      on: vi.fn()
    };

    mockVFS = {
      read: vi.fn(),
      write: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false)
    };

    mockAuditLogger = {
      getEntries: vi.fn().mockResolvedValue([])
    };

    mockVFSSandbox = {
      createSnapshot: vi.fn().mockResolvedValue({
        files: { '/test.txt': 'content' },
        timestamp: Date.now()
      }),
      restoreSnapshot: vi.fn().mockResolvedValue()
    };

    mockToolRunner = {
      run: vi.fn().mockResolvedValue('tool result')
    };

    mockLLMClient = {
      chat: vi.fn().mockResolvedValue({ content: 'LLM response', toolCalls: [] })
    };
  };

  beforeEach(() => {
    createMocks();
    replayEngine = ReplayEngineModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      VFS: mockVFS,
      AuditLogger: mockAuditLogger,
      VFSSandbox: mockVFSSandbox,
      ToolRunner: mockToolRunner,
      LLMClient: mockLLMClient
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    replayEngine.clear();
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ReplayEngineModule.metadata.id).toBe('ReplayEngine');
      expect(ReplayEngineModule.metadata.version).toBe('2.0.0');
      expect(ReplayEngineModule.metadata.type).toBe('infrastructure');
    });
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      const result = await replayEngine.init();
      expect(result).toBe(true);
      expect(mockUtils.logger.info).toHaveBeenCalledWith('[ReplayEngine] Initialized (v2.0 with re-execution)');
    });
  });

  // =========================================================================
  // Timeline Playback (v1.0 features)
  // =========================================================================

  describe('loadRun', () => {
    it('should load timeline events from run data', () => {
      const runData = {
        vfs: {
          '/.logs/timeline/2024-01-01.jsonl': JSON.stringify({ ts: 1000, type: 'test', payload: {} }) + '\n'
        },
        state: { totalCycles: 5 }
      };

      const { events, metadata } = replayEngine.loadRun(runData);

      expect(events).toHaveLength(1);
      expect(metadata.eventCount).toBe(1);
      expect(metadata.totalCycles).toBe(5);
    });

    it('should throw for invalid run data', () => {
      expect(() => replayEngine.loadRun({})).toThrow('Invalid run data: missing vfs');
      expect(() => replayEngine.loadRun(null)).toThrow();
    });

    it('should emit replay:loaded event', () => {
      const runData = {
        vfs: { '/.logs/timeline/test.jsonl': '' },
        state: {}
      };

      replayEngine.loadRun(runData);

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:loaded', expect.any(Object));
    });
  });

  describe('playback controls', () => {
    beforeEach(() => {
      const runData = {
        vfs: {
          '/.logs/timeline/test.jsonl':
            JSON.stringify({ ts: 1000, type: 'event1', payload: { data: 1 } }) + '\n' +
            JSON.stringify({ ts: 2000, type: 'event2', payload: { data: 2 } }) + '\n'
        }
      };
      replayEngine.loadRun(runData);
    });

    it('should step through events', () => {
      replayEngine.step();

      expect(mockEventBus.emit).toHaveBeenCalledWith('event1', { data: 1 });
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:event', expect.objectContaining({ type: 'event1' }));
    });

    it('should track playback state', () => {
      const state = replayEngine.getState();

      expect(state.isPlaying).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.currentIndex).toBe(0);
      expect(state.totalEvents).toBe(2);
    });

    it('should set speed', () => {
      replayEngine.setSpeed(5);

      expect(replayEngine.getState().speed).toBe(5);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:speed', { speed: 5 });
    });

    it('should reject invalid speed', () => {
      replayEngine.setSpeed(3); // Invalid

      expect(mockUtils.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid speed'));
    });

    it('should seek to position', () => {
      replayEngine.seek(1);

      expect(replayEngine.getState().currentIndex).toBe(1);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:seek', expect.objectContaining({ index: 1 }));
    });

    it('should stop playback', () => {
      replayEngine.step();
      replayEngine.stop();

      expect(replayEngine.getState().currentIndex).toBe(0);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:stopped');
    });
  });

  // =========================================================================
  // Session Re-execution (v2.0 features)
  // =========================================================================

  describe('loadSession', () => {
    it('should load session from audit logs', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'goal_set', goal: 'Test goal' }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 1', toolCalls: [{ name: 'TestTool', args: {} }] }, ts: '2024-01-01T00:00:01Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'TestTool', result: 'Result 1' }, ts: '2024-01-01T00:00:02Z' }
      ]);

      const session = await replayEngine.loadSession('2024-01-01');

      expect(session.goal).toBe('Test goal');
      expect(session.totalIterations).toBe(1);
      expect(session.llmResponses).toBe(1);
      expect(session.toolResults).toBe(1);
    });

    it('should throw when AuditLogger not available', async () => {
      const engineNoAudit = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS
      });

      await expect(engineNoAudit.loadSession('2024-01-01'))
        .rejects.toThrow('AuditLogger not available');
    });

    it('should throw when no entries found', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([]);

      await expect(replayEngine.loadSession('2024-01-01'))
        .rejects.toThrow('No audit entries found');
    });

    it('should emit session_loaded event', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Test' }, ts: '2024-01-01T00:00:00Z' }
      ]);

      await replayEngine.loadSession('2024-01-01');

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:session_loaded', expect.any(Object));
    });
  });

  describe('loadSessionFromRun', () => {
    it('should load session from exported run with VFS', () => {
      const runData = {
        vfs: {
          '/.logs/timeline/test.jsonl':
            JSON.stringify({ ts: 1000, type: 'agent:history', payload: { type: 'llm_response', content: 'Response', cycle: 1 } }) + '\n' +
            JSON.stringify({ ts: 2000, type: 'agent:history', payload: { type: 'tool_result', tool: 'ReadFile', result: 'file content' } }) + '\n'
        },
        state: { goal: 'Exported goal' }
      };

      const session = replayEngine.loadSessionFromRun(runData);

      expect(session.goal).toBe('Exported goal');
      expect(session.hasVFS).toBe(true);
      expect(session.llmResponses).toBe(1);
      expect(session.toolResults).toBe(1);
    });
  });

  describe('checkpoints', () => {
    it('should create VFS checkpoint', async () => {
      const index = await replayEngine.createCheckpoint();

      expect(index).toBe(0);
      expect(mockVFSSandbox.createSnapshot).toHaveBeenCalled();
    });

    it('should restore checkpoint', async () => {
      await replayEngine.createCheckpoint();
      await replayEngine.restoreCheckpoint(0);

      expect(mockVFSSandbox.restoreSnapshot).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:checkpoint_restored', { index: 0 });
    });

    it('should throw for invalid checkpoint', async () => {
      await expect(replayEngine.restoreCheckpoint(99))
        .rejects.toThrow('Checkpoint 99 not found');
    });

    it('should list checkpoints', async () => {
      await replayEngine.createCheckpoint();
      await replayEngine.createCheckpoint();

      const checkpoints = replayEngine.getCheckpoints();

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].index).toBe(0);
      expect(checkpoints[1].index).toBe(1);
    });
  });

  describe('getMockedResponse', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Mocked content', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should return recorded response', () => {
      const response = replayEngine.getMockedResponse(1);

      expect(response).not.toBeNull();
      expect(response.content).toBe('Mocked content');
    });

    it('should return null for unrecorded iteration', () => {
      const response = replayEngine.getMockedResponse(99);

      expect(response).toBeNull();
    });
  });

  describe('executeIteration', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Recorded response', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should use mocked response when available', async () => {
      const response = await replayEngine.executeIteration(1, [], {});

      expect(response.content).toBe('Recorded response');
      expect(response.mocked).toBe(true);
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
    });

    it('should fall back to live LLM when no recording', async () => {
      const response = await replayEngine.executeIteration(99, [], {});

      expect(response.mocked).toBe(false);
      expect(mockLLMClient.chat).toHaveBeenCalled();
    });
  });

  describe('compareToolResult', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'LLM', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'ReadFile', result: 'expected content' }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should detect matching results', () => {
      const comparison = replayEngine.compareToolResult(1, 'ReadFile', 'expected content');

      expect(comparison.match).toBe(true);
      expect(comparison.diff).toBeNull();
    });

    it('should detect mismatching results', () => {
      const comparison = replayEngine.compareToolResult(1, 'ReadFile', 'different content');

      expect(comparison.match).toBe(false);
      expect(comparison.diff).toContain('Mismatch');
    });

    it('should handle missing recorded result', () => {
      const comparison = replayEngine.compareToolResult(1, 'UnknownTool', 'result');

      expect(comparison.match).toBe(false);
      expect(comparison.diff).toBe('No recorded result');
    });

    it('should emit comparison event', () => {
      replayEngine.compareToolResult(1, 'ReadFile', 'expected content');

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:comparison', expect.any(Object));
    });
  });

  describe('executeSession', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 1', toolCalls: [{ name: 'Tool1', args: {} }] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'Tool1', result: 'tool result' }, ts: '2024-01-01T00:00:01Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 2', toolCalls: [] }, ts: '2024-01-01T00:00:02Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should execute full session', async () => {
      const report = await replayEngine.executeSession();

      expect(report.iterations).toBe(2);
      expect(report.mode).toBe('mocked');
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should compare tool results', async () => {
      const report = await replayEngine.executeSession({ compareResults: true });

      expect(report.toolCalls).toBe(1);
      expect(report.matches + report.mismatches).toBe(1);
    });

    it('should create checkpoints at intervals', async () => {
      await replayEngine.executeSession({ checkpointInterval: 1 });

      const checkpoints = replayEngine.getCheckpoints();
      expect(checkpoints.length).toBeGreaterThan(1);
    });

    it('should emit execution events', async () => {
      await replayEngine.executeSession();

      const startEvent = emittedEvents.find(e => e.event === 'replay:execution_started');
      const completeEvent = emittedEvents.find(e => e.event === 'replay:execution_complete');

      expect(startEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
    });

    it('should call onIteration callback', async () => {
      const onIteration = vi.fn();

      await replayEngine.executeSession({ onIteration });

      expect(onIteration).toHaveBeenCalledTimes(2);
    });

    it('should throw if no session loaded', async () => {
      replayEngine.clear();

      await expect(replayEngine.executeSession())
        .rejects.toThrow('No session loaded');
    });

    it('should throw if already executing', async () => {
      // Start execution but don't await
      const promise = replayEngine.executeSession();

      await expect(replayEngine.executeSession())
        .rejects.toThrow('already in progress');

      await promise;
    });
  });

  describe('abortExecution', () => {
    it('should abort running execution', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R1', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R2', toolCalls: [] }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');

      // Abort after first iteration
      const onIteration = vi.fn().mockImplementation((i) => {
        if (i === 1) replayEngine.abortExecution();
      });

      const report = await replayEngine.executeSession({ onIteration });

      expect(report.iterations).toBeLessThanOrEqual(2);
    });
  });

  describe('getComparisonResults', () => {
    it('should return comparison results from last execution', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R', toolCalls: [{ name: 'T', args: {} }] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'T', result: 'res' }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
      await replayEngine.executeSession({ compareResults: true });

      const results = replayEngine.getComparisonResults();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getExecutionState', () => {
    it('should return current execution state', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R' }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');

      const state = replayEngine.getExecutionState();

      expect(state.isExecuting).toBe(false);
      expect(state.recordedResponses).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all replay state', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R' }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
      await replayEngine.createCheckpoint();

      replayEngine.clear();

      const state = replayEngine.getExecutionState();
      expect(state.recordedResponses).toBe(0);
      expect(state.checkpoints).toBe(0);
    });
  });

  describe('without optional dependencies', () => {
    it('should handle missing VFSSandbox gracefully', async () => {
      const engineNoSandbox = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS,
        AuditLogger: mockAuditLogger
      });

      const index = await engineNoSandbox.createCheckpoint();
      expect(index).toBe(-1);
    });

    it('should throw when restoring without VFSSandbox', async () => {
      const engineNoSandbox = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS,
        AuditLogger: mockAuditLogger
      });

      await expect(engineNoSandbox.restoreCheckpoint(0))
        .rejects.toThrow('VFSSandbox not available');
    });
  });
});
